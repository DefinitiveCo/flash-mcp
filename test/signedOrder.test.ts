import { describe, expect, test } from "bun:test";

import { buildSignedOrderRequest } from "../src/signedOrder.js";
import type { OrderTradeFields } from "../src/types.js";

const evmTrade: OrderTradeFields = {
  targetChain: "base",
  contraChain: "base",
  targetAsset: "0x1111111111111111111111111111111111111111",
  contraAsset: "0x2222222222222222222222222222222222222222",
  side: "buy",
  qty: "12.5",
  orderType: "limit",
  maxSlippage: "0.01",
  maxPriceImpact: "0.02",
  limitNotionalPrice: "100",
  limitCrossPrice: "0.5",
  quickTrade: false,
  flashIntegratorFeeBps: "5",
  startTime: "2026-08-05T00:00:00.000Z",
  twapBucketCount: 0,
  triggers: [{ crossPrice: "0.45", triggerType: "lower" }],
};

const common = {
  funderAddress: "0x3333333333333333333333333333333333333333",
  quoteId: "quote-1",
  userSignature: "0xsigned",
};

describe("buildSignedOrderRequest", () => {
  test.each([
    ["quoteId", { ...common, quoteId: "  " }],
    ["funderAddress", { ...common, funderAddress: "" }],
    ["userSignature", { ...common, userSignature: "\t" }],
  ])("requires non-empty %s", (name, fields) => {
    expect(() =>
      buildSignedOrderRequest(evmTrade, { ...fields, evmOrderTypedData: "typed-order" }),
    ).toThrow(`${name} must be a non-empty string`);
  });

  test("requires and forwards EVM order typed data", () => {
    expect(() => buildSignedOrderRequest(evmTrade, common)).toThrow(
      "evmOrderTypedData is required",
    );

    const request = buildSignedOrderRequest(evmTrade, {
      ...common,
      evmOrderTypedData: "typed-order",
    });
    expect(request.evmOrderTypedData).toBe("typed-order");
  });

  test("requires Permit2 typed data and signature together", () => {
    expect(() =>
      buildSignedOrderRequest(evmTrade, {
        ...common,
        evmOrderTypedData: "typed-order",
        evmPermitTypedData: "typed-permit",
      }),
    ).toThrow("must be provided together");
    expect(() =>
      buildSignedOrderRequest(evmTrade, {
        ...common,
        evmOrderTypedData: "typed-order",
        evmPermitSignature: "permit-signature",
      }),
    ).toThrow("must be provided together");

    expect(
      buildSignedOrderRequest(evmTrade, {
        ...common,
        evmOrderTypedData: "typed-order",
        evmPermitTypedData: "typed-permit",
        evmPermitSignature: "permit-signature",
      }),
    ).toMatchObject({
      evmPermitTypedData: "typed-permit",
      evmPermitSignature: "permit-signature",
    });
  });

  test("rejects fields from the other chain family", () => {
    expect(() =>
      buildSignedOrderRequest(evmTrade, {
        ...common,
        evmOrderTypedData: "typed-order",
        svmNonce: "nonce",
      }),
    ).toThrow("cannot be used for a EVM order");

    expect(() =>
      buildSignedOrderRequest(
        { ...evmTrade, targetChain: "solana", contraChain: "solana" },
        { ...common, evmOrderTypedData: "typed-order" },
      ),
    ).toThrow("cannot be used for a SVM order");
  });

  test("forwards optional SVM fields", () => {
    const request = buildSignedOrderRequest(
      { ...evmTrade, targetChain: "solana", contraChain: "solana" },
      {
        ...common,
        svmNonce: "nonce",
        svmDeadline: "deadline",
        svmSponsoredDelegateTx: "signed-transaction",
      },
    );
    expect(request).toMatchObject({
      svmNonce: "nonce",
      svmDeadline: "deadline",
      svmSponsoredDelegateTx: "signed-transaction",
    });
  });

  test("preserves every normalized trade field", () => {
    const request = buildSignedOrderRequest(evmTrade, {
      ...common,
      evmOrderTypedData: "typed-order",
    });
    for (const [key, value] of Object.entries(evmTrade)) {
      expect(request[key as keyof typeof request]).toEqual(value);
    }
    expect(request).not.toHaveProperty("privateKey");
  });

  test("requires recipient and bridge quote id for cross-chain orders", () => {
    expect(() =>
      buildSignedOrderRequest(evmTrade, {
        ...common,
        bridgeQuoteId: " ",
        evmOrderTypedData: "typed-order",
      }),
    ).toThrow("bridgeQuoteId must be a non-empty string");

    const crossChain = { ...evmTrade, contraChain: "ethereum" };
    expect(() =>
      buildSignedOrderRequest(crossChain, { ...common, evmOrderTypedData: "typed-order" }),
    ).toThrow("recipientAddress is required");

    const withRecipient = { ...crossChain, recipientAddress: "0x4444444444444444444444444444444444444444" };
    expect(() =>
      buildSignedOrderRequest(withRecipient, { ...common, evmOrderTypedData: "typed-order" }),
    ).toThrow("bridgeQuoteId is required");

    expect(
      buildSignedOrderRequest(withRecipient, {
        ...common,
        bridgeQuoteId: "bridge-1",
        evmOrderTypedData: "typed-order",
      }),
    ).toMatchObject({
      recipientAddress: withRecipient.recipientAddress,
      bridgeQuoteId: "bridge-1",
    });
  });

  test("validates and forwards ERC-8021 attribution", () => {
    for (const value of ["", "contains space", "a".repeat(33)]) {
      expect(() =>
        buildSignedOrderRequest(evmTrade, {
          ...common,
          erc8021AttributionCode: value,
          evmOrderTypedData: "typed-order",
        }),
      ).toThrow("erc8021AttributionCode");
    }

    expect(
      buildSignedOrderRequest(evmTrade, {
        ...common,
        erc8021AttributionCode: "acme_builder-1.0",
        evmOrderTypedData: "typed-order",
      }).erc8021AttributionCode,
    ).toBe("acme_builder-1.0");
  });
});
