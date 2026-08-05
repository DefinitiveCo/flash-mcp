// Native gas assets need an explicit quote intent so Flash can price against the
// wrapped token and return the preparation action required before submit.
//
// This module transparently rewrites a native-asset reference to the chain's
// canonical form BEFORE the request reaches the API:
//
//   • On an EVM SPENT side, the canonical 0xEeee… sentinel asks /quote to price
//     against wrapped-native and return wrap.evmTx. On Solana, wSOL plus
//     `svmUseNativeSOL` asks for the corresponding wrap instructions.
//   • On the RECEIVED side, no wrap is needed — but Flash delivers the wrapped
//     token, not the raw gas asset, so we note that the user receives WETH/wSOL
//     and must unwrap separately if they want native.
//
// Every substitution is surfaced to the user as a note; nothing happens silently.

import { getChain } from "./chains.js";
import type { QuoteRequest } from "./types.js";

// Widely-used placeholders passed in place of a contract address to mean
// "the chain's native gas asset".
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
// 0xEeee…eEEeE — the native-asset sentinel popularized by 1inch / 0x.
export const EVM_NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
// Solana system program id, sometimes used as a stand-in for native SOL.
const SVM_SYSTEM_PROGRAM = "11111111111111111111111111111111";
// Canonical wrapped-SOL mint. `svmUseNativeSOL` wraps native SOL into this.
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * True when `asset` names the chain's native gas asset rather than a tradable
 * token contract — a sentinel address, the literal "native", or the chain's
 * native symbol (e.g. "ETH", "SOL"). Assets are otherwise contract addresses,
 * so a bare symbol can only mean the native asset.
 */
export function isNativeAsset(asset: string, chainId: string): boolean {
  const a = asset.trim().toLowerCase();
  if (!a) return false;
  const chain = getChain(chainId);
  if (a === "native" || a === chain.nativeSymbol.toLowerCase()) return true;
  if (chain.kind === "evm") return a === ZERO_ADDRESS || a === EVM_NATIVE_SENTINEL.toLowerCase();
  return a === SVM_SYSTEM_PROGRAM.toLowerCase(); // "sol" already covered by nativeSymbol
}

export interface NativeResolution {
  req: QuoteRequest;
  /** Human-readable notes for every substitution made; empty when none. */
  notes: string[];
}

/**
 * Normalize native-asset references so Flash can quote them, returning the
 * adjusted request plus notes describing each substitution. A spent EVM asset
 * becomes the canonical sentinel so the quote returns wrap.evmTx; a received
 * EVM asset becomes the configured wrapped token. Solana uses wSOL and the
 * quote-only native intent flag.
 */
export function resolveNativeAssets(req: QuoteRequest): NativeResolution {
  const out: QuoteRequest = { ...req };
  const notes: string[] = [];
  const spentSide = req.side === "buy" ? "contra" : "target";

  for (const side of ["target", "contra"] as const) {
    const chainId = side === "target" ? req.targetChain : req.contraChain;
    const asset = side === "target" ? req.targetAsset : req.contraAsset;
    if (!isNativeAsset(asset, chainId)) continue;

    const chain = getChain(chainId);
    const isSpent = side === spentSide;
    const setAsset = (addr: string) => {
      if (side === "target") out.targetAsset = addr;
      else out.contraAsset = addr;
    };

    if (chain.kind === "svm") {
      setAsset(WSOL_MINT);
      if (isSpent) {
        out.svmUseNativeSOL = true;
        notes.push(
          `Spending native ${chain.nativeSymbol}: it will be wrapped into wSOL (\`${WSOL_MINT}\`) before the trade.`,
        );
      } else {
        notes.push(
          `Receiving wrapped ${chain.nativeSymbol} (wSOL, \`${WSOL_MINT}\`) — Flash cannot deliver native ${chain.nativeSymbol}; unwrap it separately if you need native ${chain.nativeSymbol}.`,
        );
      }
      continue;
    }

    // EVM spent-native intent must reach /quote as the canonical sentinel. The
    // response supplies both the wrapped asset and the exact wrap transaction.
    if (isSpent) {
      setAsset(EVM_NATIVE_SENTINEL);
      notes.push(
        `Spending native ${chain.nativeSymbol}: the quote will include the wrap transaction to execute before signing and submitting.`,
      );
      continue;
    }

    // Received native is delivered as wrapped-native, so a verified address is
    // still required on the destination chain.
    const wrapped = chain.wrappedNative;
    if (!wrapped) {
      throw new Error(
        `Can't auto-trade native ${chain.nativeSymbol} on ${chainId}: Flash trades token contracts only and no ` +
          `verified wrapped-${chain.nativeSymbol} address is configured for this chain. Pass the wrapped-` +
          `${chain.nativeSymbol} token address as ${side}Asset instead.`,
      );
    }
    setAsset(wrapped.address);
    notes.push(
      `Receiving wrapped ${chain.nativeSymbol} — Flash delivers ${wrapped.symbol} (\`${wrapped.address}\`), not native ` +
        `${chain.nativeSymbol}. Unwrap it separately if you need native ${chain.nativeSymbol}.`,
    );
  }

  return { req: out, notes };
}
