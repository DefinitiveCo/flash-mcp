// Solana signing + on-chain sends for the Flash order flow.
//
// The core of a Solana order is an Ed25519 signature over the UTF-8
// `orderMessage` the quote returns — that (and deriving the address) needs only
// tweetnacl + bs58, which are tiny and safe to import eagerly.
//
// @solana/web3.js is heavy and its dependency tree (rpc-websockets → uuid) is
// fragile under some installers, so it is imported lazily and ONLY for the
// optional on-chain steps: sending delegate/wrap instructions and co-signing a
// sponsored VersionedTransaction. Server startup, the EVM path, and Solana
// address/message signing never touch it.

import bs58 from "bs58";
import nacl from "tweetnacl";
import { resolveRpc } from "../chains.js";
import type { SvmInstruction } from "../types.js";

interface KeyMaterial {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 64 bytes (seed || pubkey), as tweetnacl/solana expect
}

function keyMaterialFromSecret(raw: string): KeyMaterial {
  const trimmed = raw.trim();
  let secret: Uint8Array;
  if (trimmed.startsWith("[")) {
    secret = Uint8Array.from(JSON.parse(trimmed) as number[]);
  } else {
    secret = bs58.decode(trimmed);
  }
  if (secret.length === 64) {
    return nacl.sign.keyPair.fromSecretKey(secret);
  }
  if (secret.length === 32) {
    return nacl.sign.keyPair.fromSeed(secret);
  }
  throw new Error("Solana secret must be a base58 32/64-byte key or a JSON byte array.");
}

/** Derive the Solana address from a secret. Pure tweetnacl/bs58 — no web3.js. */
export function svmAddressFromSecret(raw: string): string {
  return bs58.encode(keyMaterialFromSecret(raw).publicKey);
}

export class SvmSigner {
  private key: KeyMaterial;
  private rpcOverride?: string;

  constructor(secret: string, rpcOverride?: string) {
    this.key = keyMaterialFromSecret(secret);
    this.rpcOverride = rpcOverride;
  }

  get address(): string {
    return bs58.encode(this.key.publicKey);
  }

  /** Ed25519 signature over the UTF-8 message, returned base58 (Flash convention). */
  signMessageBase58(message: string): string {
    const sig = nacl.sign.detached(new TextEncoder().encode(message), this.key.secretKey);
    return bs58.encode(sig);
  }

  // ---- web3.js-backed on-chain steps (lazy) ----

  private async web3() {
    return import("@solana/web3.js");
  }

  private async keypair() {
    const web3 = await this.web3();
    return web3.Keypair.fromSecretKey(this.key.secretKey);
  }

  /** Build a legacy tx from instructions, sign, send, and confirm. */
  async sendInstructions(instructions: SvmInstruction[], label: string): Promise<{ signature: string; label: string }> {
    const web3 = await this.web3();
    const keypair = await this.keypair();
    const conn = new web3.Connection(resolveRpc("solana", this.rpcOverride), "confirmed");

    const tx = new web3.Transaction();
    for (const ix of instructions) {
      tx.add(
        new web3.TransactionInstruction({
          programId: new web3.PublicKey(ix.programId),
          keys: ix.accounts.map((a) => ({
            pubkey: new web3.PublicKey(a.pubkey),
            isSigner: a.isSigner,
            isWritable: a.isWritable,
          })),
          data: Buffer.from(bs58.decode(ix.data)),
        }),
      );
    }
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);
    const signature = await conn.sendRawTransaction(tx.serialize());
    const result = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (result.value.err) {
      throw new Error(`${label} transaction ${signature} failed: ${JSON.stringify(result.value.err)}`);
    }
    return { signature, label };
  }

  /** Co-sign a base64 sponsored VersionedTransaction and return it base64-encoded. */
  async signSponsoredTxBase64(base64Tx: string): Promise<string> {
    const web3 = await this.web3();
    const keypair = await this.keypair();
    const tx = web3.VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
    tx.sign([keypair]);
    return Buffer.from(tx.serialize()).toString("base64");
  }
}
