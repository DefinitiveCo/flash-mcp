// Thin typed client for the Definitive Flash API.

import type {
  CancelOrderRequest,
  FlashGetOrderResponse,
  FlashListOrdersResponse,
  FlashOrderStatus,
  QuoteRequest,
  QuoteResponse,
  SubmitOrderRequest,
  SubmitOrderResponse,
} from "./types.js";

export const FLASH_BASE_URL = "https://flash.definitive.fi/v1";

/** Public docs dev key — used only when the trader has not configured their own. */
export const PUBLIC_DEV_KEY = "dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b";

export class FlashApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "FlashApiError";
  }
}

export class FlashClient {
  constructor(
    private apiKey: string,
    private baseUrl: string = FLASH_BASE_URL,
  ) {}

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-definitive-api-key": this.apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const err = (parsed as { error?: { code?: string; message?: string; details?: unknown } })?.error;
      throw new FlashApiError(
        res.status,
        err?.code,
        err?.message ?? `${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`,
        err?.details,
      );
    }
    return parsed as T;
  }

  quote(req: QuoteRequest): Promise<QuoteResponse> {
    return this.request<QuoteResponse>("/quote", "POST", req);
  }

  submitOrder(req: SubmitOrderRequest): Promise<SubmitOrderResponse> {
    return this.request<SubmitOrderResponse>("/order", "POST", req);
  }

  getOrder(orderId: string): Promise<FlashGetOrderResponse> {
    return this.request<FlashGetOrderResponse>(`/orders/${encodeURIComponent(orderId)}`, "GET");
  }

  listOrders(params: {
    funderAddress: string;
    statuses?: FlashOrderStatus[];
    pageSize?: number;
  }): Promise<FlashListOrdersResponse> {
    const qs = new URLSearchParams({ funderAddress: params.funderAddress });
    if (params.statuses?.length) qs.set("statuses", params.statuses.join(","));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    return this.request<FlashListOrdersResponse>(`/orders?${qs.toString()}`, "GET");
  }

  cancelOrder(orderId: string, req: CancelOrderRequest): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(`/orders/${encodeURIComponent(orderId)}/cancel`, "POST", req);
  }
}
