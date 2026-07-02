// Human-readable formatting for tool output. Each tool returns a short markdown
// summary as text content; raw API JSON is appended for agents that want it.

import type { FlashFill, FlashGetOrderResponse, FlashOrder, QuoteResponse } from "./types.js";

export function fmtUsd(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function quoteSummary(q: QuoteResponse): string {
  const spend = `${q.from.amount} (${fmtUsd(q.from.notional)})`;
  const recv = `${q.to.amount} (${fmtUsd(q.to.notional)})`;
  const lines = [
    `**Quote ${q.quoteId}** — ${q.side} ${q.orderType}`,
    `- Spend: ${spend}`,
    `- Receive: ${recv}`,
    `- Est. fees: ${fmtUsd(q.fees.estimatedFeeNotional)}`,
  ];
  if (q.wrap) lines.push(`- Native wrap required (${q.wrap.nativeAsset} → ${q.wrap.wrappedAsset})`);
  return lines.join("\n");
}

export function orderLine(o: FlashOrder): string {
  const f = o.filled;
  const filled = f.targetAmount ? ` filled ${f.targetAmount} ${o.targetAsset.ticker}` : "";
  return `- \`${o.orderId}\` ${o.side} ${o.orderType} ${o.targetAsset.ticker}/${o.contraAsset.ticker} — ${o.status}${filled}`;
}

export function orderDetail(res: FlashGetOrderResponse): string {
  const o = res.order;
  const f = o.filled;
  const lines = [
    `**Order ${o.orderId}** — ${o.side} ${o.orderType} ${o.targetAsset.ticker}/${o.contraAsset.ticker}`,
    `- Status: ${o.status}${o.closeReason ? ` (${o.closeReason})` : ""}`,
    `- Funder: ${o.funderAddress}`,
    `- Qty: ${o.qty}`,
  ];
  if (f.targetAmount || f.contraAmount) {
    lines.push(
      `- Filled: ${f.targetAmount ?? "—"} ${o.targetAsset.ticker} for ${f.contraAmount ?? "—"} ${o.contraAsset.ticker}` +
        (f.averageNotionalPrice ? ` @ ${fmtUsd(f.averageNotionalPrice)}` : ""),
    );
  }
  if (o.limitNotionalPrice) lines.push(`- Limit price: ${fmtUsd(o.limitNotionalPrice)}`);
  if (o.trigger) lines.push(`- Trigger: ${o.trigger.triggerType} @ ${fmtUsd(o.trigger.notionalPrice)}`);
  lines.push(`- Placed: ${o.placedAt}${o.closedAt ? ` · Closed: ${o.closedAt}` : ""}`);
  if (res.fills.length) {
    lines.push(`- Fills (${res.fills.length}):`);
    for (const fill of res.fills) lines.push(`  - ${fillLine(fill)}`);
  }
  return lines.join("\n");
}

function fillLine(f: FlashFill): string {
  const venues = f.venues?.length ? ` via ${f.venues.join(", ")}` : "";
  return `${f.targetAmount} for ${f.contraAmount} @ ${f.fillPrice} (${fmtUsd(f.notional)}, fee ${fmtUsd(f.feeNotional)})${venues} [tx ${f.transactionId}]`;
}

/** Wrap a markdown summary + raw JSON into MCP text content. */
export function result(summary: string, raw?: unknown): { content: { type: "text"; text: string }[] } {
  const text = raw === undefined ? summary : `${summary}\n\n<details><summary>raw</summary>\n\n\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\`\n</details>`;
  return { content: [{ type: "text", text }] };
}
