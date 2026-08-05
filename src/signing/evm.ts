// EVM signing + on-chain sends for the Flash order flow, built on viem.
//
// Signing the order/permit only needs the private key: the EIP-712 domain
// (including chainId) is carried inside the typed-data payload the quote
// returns. The wallet/public clients are only needed to broadcast the optional
// wrap and approve transactions and to wait for their receipts.

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { getChain, resolveRpc } from "../chains.js";
import type { EvmTx } from "../types.js";

function normalizePrivateKey(raw: string): Hex {
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("EVM private key must be 32 bytes of hex (64 hex chars, optionally 0x-prefixed).");
  }
  return hex as Hex;
}

export function evmAddressFromPrivateKey(raw: string): string {
  return privateKeyToAccount(normalizePrivateKey(raw)).address;
}

export class EvmSigner {
  readonly account: PrivateKeyAccount;
  private wallet: WalletClient;
  private pub: PublicClient;

  constructor(privateKey: string, chainName: string, rpcOverride?: string) {
    const info = getChain(chainName);
    if (info.kind !== "evm" || info.chainId === undefined) {
      throw new Error(`${chainName} is not an EVM chain.`);
    }
    const rpcUrl = resolveRpc(chainName, rpcOverride);
    const chain = defineChain({
      id: info.chainId,
      name: info.id,
      nativeCurrency: { name: info.nativeSymbol, symbol: info.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    this.account = privateKeyToAccount(normalizePrivateKey(privateKey));
    this.wallet = createWalletClient({ account: this.account, chain, transport: http(rpcUrl) });
    this.pub = createPublicClient({ chain, transport: http(rpcUrl) });
  }

  get address(): string {
    return this.account.address;
  }

  /** Sign a Flash EIP-712 typed-data string (order or permit). */
  async signTypedDataString(typedDataString: string): Promise<Hex> {
    const td = JSON.parse(typedDataString);
    // viem rejects the EIP712Domain entry inside `types`; strip it.
    const { EIP712Domain: _ignored, ...types } = td.types ?? {};
    // The quote serializes domain.chainId as a string, but viem only includes
    // chainId in the EIP-712 domain when `typeof chainId === "number"`. A string
    // silently drops chainId from the domain hash, so the signature never matches
    // the on-chain verifier. Coerce it back to a number.
    const domain = { ...td.domain };
    if (domain.chainId !== undefined && domain.chainId !== null) {
      domain.chainId = Number(domain.chainId);
    }
    return this.wallet.signTypedData({
      account: this.account,
      domain,
      types,
      primaryType: td.primaryType,
      message: td.message,
    });
  }

  /** Send a transaction the quote handed us (wrap/approve) and wait for it to mine. */
  async sendAndWait(tx: EvmTx, label: string): Promise<{ hash: Hex; label: string }> {
    const hash = await this.wallet.sendTransaction({
      account: this.account,
      chain: this.wallet.chain,
      to: tx.to as Hex,
      data: tx.data as Hex,
      ...(tx.value ? { value: BigInt(tx.value) } : {}),
    });
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${label} transaction ${hash} reverted on-chain.`);
    }
    return { hash, label };
  }

  /** EIP-191 personal_sign over the cancel message. */
  async signMessage(message: string): Promise<Hex> {
    return this.wallet.signMessage({ account: this.account, message });
  }
}
