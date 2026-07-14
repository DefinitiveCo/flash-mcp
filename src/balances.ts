// Read-only wallet balance lookups over the per-chain RPCs from chains.ts.
// No Flash API involvement — pure on-chain reads, safe without any credentials.

import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, erc20Abi, formatUnits, http, isAddress } from "viem";

import { getChain, resolveRpc } from "./chains.js";

export interface TokenBalance {
  /** ERC-20 address / SPL mint, or "native" for the gas asset. */
  token: string;
  symbol: string;
  /** Human units. */
  balance: string;
  /** Base units. */
  raw: string;
  decimals: number;
}

// SPL token program ids — lets us enumerate a wallet's token accounts without
// needing @solana/spl-token as a dependency.
const SPL_TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SPL_TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export async function fetchBalances(
  chainName: string,
  address: string,
  tokens?: string[],
  rpcOverride?: string,
): Promise<TokenBalance[]> {
  const chain = getChain(chainName);
  const rpc = resolveRpc(chainName, rpcOverride);
  return chain.kind === "svm"
    ? svmBalances(rpc, address, tokens)
    : evmBalances(rpc, chain.nativeSymbol, address, tokens);
}

async function evmBalances(
  rpc: string,
  nativeSymbol: string,
  address: string,
  tokens: string[] = [],
): Promise<TokenBalance[]> {
  if (!isAddress(address)) throw new Error(`"${address}" is not a valid EVM address`);
  const client = createPublicClient({ transport: http(rpc) });

  const native = client.getBalance({ address }).then(
    (wei): TokenBalance => ({
      token: "native",
      symbol: nativeSymbol,
      balance: formatUnits(wei, 18),
      raw: wei.toString(),
      decimals: 18,
    }),
  );

  const erc20s = tokens.map(async (token): Promise<TokenBalance> => {
    if (!isAddress(token)) throw new Error(`"${token}" is not a valid ERC-20 address`);
    const contract = { address: token, abi: erc20Abi } as const;
    const [raw, decimals, symbol] = await Promise.all([
      client.readContract({ ...contract, functionName: "balanceOf", args: [address] }),
      client.readContract({ ...contract, functionName: "decimals" }),
      client.readContract({ ...contract, functionName: "symbol" }).catch(() => token.slice(0, 8)),
    ]);
    return { token, symbol, balance: formatUnits(raw, decimals), raw: raw.toString(), decimals };
  });

  return Promise.all([native, ...erc20s]);
}

async function svmBalances(rpc: string, address: string, tokens?: string[]): Promise<TokenBalance[]> {
  const connection = new Connection(rpc, "confirmed");
  const owner = new PublicKey(address);

  const lamports = await connection.getBalance(owner);
  const out: TokenBalance[] = [
    {
      token: "native",
      symbol: "SOL",
      balance: formatUnits(BigInt(lamports), 9),
      raw: String(lamports),
      decimals: 9,
    },
  ];

  // One call per token program returns every SPL balance the wallet holds; the
  // optional `tokens` list then just filters by mint.
  const accounts = (
    await Promise.all(
      [SPL_TOKEN_PROGRAM, SPL_TOKEN_2022_PROGRAM].map((programId) =>
        connection.getParsedTokenAccountsByOwner(owner, { programId }),
      ),
    )
  ).flatMap((res) => res.value);

  const wanted = tokens ? new Set(tokens) : null;
  for (const { account } of accounts) {
    const info = account.data.parsed?.info;
    const mint: string | undefined = info?.mint;
    const amount = info?.tokenAmount;
    if (!mint || !amount) continue;
    if (wanted && !wanted.has(mint)) continue;
    if (!wanted && amount.amount === "0") continue; // skip empty accounts when listing everything
    out.push({
      token: mint,
      symbol: mint.slice(0, 8),
      balance: amount.uiAmountString ?? String(amount.uiAmount ?? amount.amount),
      raw: amount.amount,
      decimals: amount.decimals,
    });
  }

  if (wanted) {
    for (const mint of wanted) {
      if (!out.some((b) => b.token === mint)) {
        out.push({ token: mint, symbol: mint.slice(0, 8), balance: "0", raw: "0", decimals: 0 });
      }
    }
  }

  return out;
}
