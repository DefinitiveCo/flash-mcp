// Native gas assets aren't tradable on Flash directly. The API only accepts
// ERC-20 / SPL contract addresses, and it will reject a native-asset reference
// outright — yet users (and agents) routinely try to trade "ETH", the zero
// address, or the 0xEeee… native sentinel. Wrapping the native asset into its
// ERC-20 form is a required pre-trade step.
//
// This module transparently rewrites a native-asset reference to the chain's
// canonical wrapped-native token BEFORE the request reaches the API, so the
// caller never has to know Flash can't price the raw gas asset:
//
//   • On the SPENT side, quoting against wrapped-native makes the API return a
//     wrap transaction, which the order flow already executes (orderFlow.ts).
//     On Solana it also flips on `svmUseNativeSOL`, telling the API to wrap the
//     full spend into wSOL.
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
const EVM_NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
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
  if (chain.kind === "evm") return a === ZERO_ADDRESS || a === EVM_NATIVE_SENTINEL;
  return a === SVM_SYSTEM_PROGRAM.toLowerCase(); // "sol" already covered by nativeSymbol
}

/**
 * A pre-trade wrap the client must perform itself. Flash's EVM quote path does
 * not wrap native gas assets (it treats the spent token as a plain ERC-20 and
 * fails if the wrapped balance is short), so when the caller spends the native
 * asset the order flow deposits it into wrapped-native before quoting/signing.
 */
export interface EvmWrapDirective {
  chainId: string;
  wrapped: { symbol: string; address: string };
  /** Amount being spent, in native decimal units (== the trade qty). */
  amount: string;
}

export interface NativeResolution {
  req: QuoteRequest;
  /** Human-readable notes for every substitution made; empty when none. */
  notes: string[];
  /** Set when the spent asset is native on an EVM chain and must be wrapped client-side. */
  evmWrap?: EvmWrapDirective;
}

/**
 * Rewrite any native-asset reference in a trade to the chain's wrapped-native
 * token so Flash can price it, returning the adjusted request plus notes
 * describing each substitution. The spent asset (contra on buys, target on
 * sells) is the one that triggers a pre-trade wrap. Throws a clear error when a
 * chain has no verified wrapped-native token, rather than trading the wrong one.
 */
export function resolveNativeAssets(req: QuoteRequest): NativeResolution {
  const out: QuoteRequest = { ...req };
  const notes: string[] = [];
  let evmWrap: EvmWrapDirective | undefined;
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

    // EVM
    const wrapped = chain.wrappedNative;
    if (!wrapped) {
      throw new Error(
        `Can't auto-trade native ${chain.nativeSymbol} on ${chainId}: Flash trades token contracts only and no ` +
          `verified wrapped-${chain.nativeSymbol} address is configured for this chain. Pass the wrapped-` +
          `${chain.nativeSymbol} token address as ${side}Asset instead.`,
      );
    }
    setAsset(wrapped.address);
    if (isSpent) {
      evmWrap = { chainId, wrapped, amount: req.qty };
      notes.push(
        `Spending native ${chain.nativeSymbol}: it will be wrapped into ${wrapped.symbol} (\`${wrapped.address}\`) ` +
          `first, via a one-time on-chain deposit, then traded. Keep a little native ${chain.nativeSymbol} for gas.`,
      );
    } else {
      notes.push(
        `Receiving wrapped ${chain.nativeSymbol} — Flash delivers ${wrapped.symbol} (\`${wrapped.address}\`), not native ` +
          `${chain.nativeSymbol}. Unwrap it separately if you need native ${chain.nativeSymbol}.`,
      );
    }
  }

  return { req: out, notes, ...(evmWrap ? { evmWrap } : {}) };
}
