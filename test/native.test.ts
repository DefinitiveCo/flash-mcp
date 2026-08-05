import { describe, expect, test } from "bun:test";

import { EVM_NATIVE_SENTINEL, resolveNativeAssets, WSOL_MINT } from "../src/native.js";
import type { QuoteRequest } from "../src/types.js";

const baseQuote: QuoteRequest = {
  targetChain: "base",
  contraChain: "base",
  targetAsset: "0x1111111111111111111111111111111111111111",
  contraAsset: "0x2222222222222222222222222222222222222222",
  side: "buy",
  qty: "1",
  orderType: "market",
};

describe("resolveNativeAssets", () => {
  test.each([
    "ETH",
    "native",
    "0x0000000000000000000000000000000000000000",
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    EVM_NATIVE_SENTINEL,
  ])("normalizes spent EVM native alias %s to the canonical sentinel", (alias) => {
    const resolved = resolveNativeAssets({ ...baseQuote, contraAsset: alias });
    expect(resolved.req.contraAsset).toBe(EVM_NATIVE_SENTINEL);
    expect(resolved).not.toHaveProperty("evmWrap");
  });

  test("normalizes received EVM native to the configured wrapped token", () => {
    const resolved = resolveNativeAssets({ ...baseQuote, targetAsset: "ETH" });
    expect(resolved.req.targetAsset).toBe("0x4200000000000000000000000000000000000006");
    expect(resolved.req.contraAsset).toBe(baseQuote.contraAsset);
  });

  test("leaves non-native assets unchanged", () => {
    const resolved = resolveNativeAssets(baseQuote);
    expect(resolved.req).toEqual(baseQuote);
    expect(resolved.notes).toEqual([]);
  });

  test("preserves Solana native normalization and quote intent", () => {
    const spent = resolveNativeAssets({
      ...baseQuote,
      targetChain: "solana",
      contraChain: "solana",
      contraAsset: "SOL",
    });
    expect(spent.req.contraAsset).toBe(WSOL_MINT);
    expect(spent.req.svmUseNativeSOL).toBe(true);

    const received = resolveNativeAssets({
      ...baseQuote,
      targetChain: "solana",
      contraChain: "solana",
      targetAsset: "SOL",
    });
    expect(received.req.targetAsset).toBe(WSOL_MINT);
    expect(received.req.svmUseNativeSOL).toBeUndefined();
  });
});
