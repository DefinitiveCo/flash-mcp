import { describe, expect, test } from "bun:test";

import { FlashClient } from "../src/flashClient.js";
import { submitSignedOrder } from "../src/orderFlow.js";
import type {
  FlashGetOrderResponse,
  FlashListOrdersResponse,
  FlashOrder,
  SubmitOrderRequest,
  SubmitOrderResponse,
} from "../src/types.js";

const submitRequest: SubmitOrderRequest = {
  targetChain: "base",
  contraChain: "base",
  targetAsset: "0x1111111111111111111111111111111111111111",
  contraAsset: "0x2222222222222222222222222222222222222222",
  side: "buy",
  qty: "5",
  orderType: "market",
  funderAddress: "0x3333333333333333333333333333333333333333",
  quoteId: "quote-1",
  userSignature: "0xsigned",
  evmOrderTypedData: "typed-order",
};

function order(overrides: Partial<FlashOrder> = {}): FlashOrder {
  return {
    orderId: "order-1",
    orderType: submitRequest.orderType,
    side: submitRequest.side,
    status: "ORDER_STATUS_PENDING",
    closeReason: null,
    funderAddress: submitRequest.funderAddress,
    targetAsset: {
      id: "target",
      name: "Target",
      address: submitRequest.targetAsset,
      ticker: "TGT",
      chain: { id: "base", name: "Base", namespace: "eip155" },
    },
    contraAsset: {
      id: "contra",
      name: "Contra",
      address: submitRequest.contraAsset,
      ticker: "CTR",
      chain: { id: "base", name: "Base", namespace: "eip155" },
    },
    qty: submitRequest.qty,
    filled: {
      targetAmount: null,
      contraAmount: null,
      averagePrice: null,
      averageNotionalPrice: null,
    },
    limitNotionalPrice: null,
    trigger: null,
    brackets: null,
    maxPriceImpact: null,
    twapBucketCount: null,
    placedAt: "2026-08-05T00:00:00.000Z",
    acceptedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function orderResponse(overrides: Partial<FlashOrder> = {}): FlashGetOrderResponse {
  return { order: order(overrides), fills: [] };
}

class FakeFlashClient extends FlashClient {
  submitCalls = 0;
  listCalls = 0;
  getCalls = 0;
  submitResult: SubmitOrderResponse | Error = { orderId: "order-1" };
  listedOrders: FlashOrder[] = [];
  currentOrder = orderResponse();
  listHook?: (call: number) => FlashOrder[];

  constructor() {
    super("fake-key", "https://invalid.example");
  }

  override async submitOrder(_request: SubmitOrderRequest): Promise<SubmitOrderResponse> {
    this.submitCalls++;
    if (this.submitResult instanceof Error) throw this.submitResult;
    return this.submitResult;
  }

  override async listOrders(_params: {
    funderAddress: string;
    pageSize?: number;
  }): Promise<FlashListOrdersResponse> {
    this.listCalls++;
    return { orders: this.listHook?.(this.listCalls) ?? this.listedOrders };
  }

  override async getOrder(_orderId: string): Promise<FlashGetOrderResponse> {
    this.getCalls++;
    return this.currentOrder;
  }
}

describe("submitSignedOrder", () => {
  test("submits successfully", async () => {
    const client = new FakeFlashClient();
    const result = await submitSignedOrder(client, submitRequest);

    expect(result.orderId).toBe("order-1");
    expect(result.steps).toEqual(["Submitted order order-1"]);
    expect(client.submitCalls).toBe(1);
  });

  test("recovers an immediately visible matching order after an ambiguous error", async () => {
    const client = new FakeFlashClient();
    client.submitResult = new Error("response dropped");
    client.listHook = (call) => (call === 1 ? [] : [order({ orderId: "recovered-order" })]);

    const result = await submitSignedOrder(client, submitRequest);

    expect(result.orderId).toBe("recovered-order");
    expect(client.submitCalls).toBe(1);
    expect(client.listCalls).toBe(2);
    expect(result.steps.join("\n")).toContain("Do NOT retry");
  });

  test("returns immediately when market polling sees a terminal order", async () => {
    const client = new FakeFlashClient();
    client.currentOrder = orderResponse({ status: "ORDER_STATUS_FILLED" });

    const result = await submitSignedOrder(client, submitRequest, { waitForFill: true });

    expect(result.finalOrder?.order.status).toBe("ORDER_STATUS_FILLED");
    expect(client.getCalls).toBe(1);
    expect(result.steps).toContain("Order reached ORDER_STATUS_FILLED");
  });

  test("does not poll resting orders", async () => {
    const client = new FakeFlashClient();
    const result = await submitSignedOrder(
      client,
      { ...submitRequest, orderType: "limit" },
      { waitForFill: true },
    );

    expect(result.finalOrder).toBeUndefined();
    expect(client.getCalls).toBe(0);
  });
});
