import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ExchangeOrderView } from "../shared/api.js";
import { contractQuotePair, contractQuotePairs, quotePriceScale } from "../shared/quote.js";
import { ApiError, api } from "./api.js";
import { locales, translate } from "./i18n.js";
import { orderSideBadge, ordersHistory, orderStatusBadge, orderTypeBadge } from "./orders.js";
import { servedRowsLimit } from "./served-views.js";

const sheetSource = readFileSync(new URL("../../src/app/OrdersSheet.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../../src/app/screens/HomeScreen.tsx", import.meta.url), "utf8");
const sheetsSource = readFileSync(new URL("../../src/app/sheets.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../../src/app/navigation.ts", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../src/app/api.ts", import.meta.url), "utf8");
const serverQuotesSource = readFileSync(new URL("../../src/server/quotes.ts", import.meta.url), "utf8");

function stubFetch(handler: (path: string) => Response | Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

describe("orders sheet", () => {
  it("requests the exchange-order list through /bff/exchange-orders", async () => {
    let requested = "";
    const restore = stubFetch((path) => {
      requested = path;
      return jsonResponse({ mode: "test", kyc: "verified", orders: [] });
    });
    try {
      const view = await api.exchangeOrders();
      assert.equal(requested, "/bff/exchange-orders");
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
    } finally {
      restore();
    }
  });

  it("surfaces the unavailable upstream as an ApiError the sheet maps to the load-failed state", async () => {
    const restore = stubFetch(() => jsonResponse({ error: "exchange_orders_unavailable" }, { status: 503 }));
    try {
      await assert.rejects(
        () => api.exchangeOrders(),
        (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "exchange_orders_unavailable"
      );
    } finally {
      restore();
    }
  });

  it("maps every declared pair to its contract scales and refuses foreign pairs", () => {
    assert.equal(contractQuotePairs.length, 3);
    assert.equal(quotePriceScale, 8);
    for (const pair of ["USDT/RUB", "TON/RUB", "TON/USDT"] as const) {
      const def = contractQuotePair(pair);
      assert.ok(def, pair);
      assert.equal(def.pair, pair);
      assert.ok(def.baseScale > 0 && def.quoteScale > 0, pair);
    }
    assert.equal(contractQuotePair("BTC/USD"), undefined);
    assert.equal(contractQuotePair(""), undefined);
    assert.equal(contractQuotePair(undefined), undefined);
    assert.equal(contractQuotePair(42), undefined);
  });

  it("maps only declared sides, order types and statuses to badges (fail-closed)", () => {
    assert.deepEqual(orderSideBadge("buy"), { label: "orders.buy", tone: "success" });
    assert.deepEqual(orderSideBadge("sell"), { label: "orders.sell", tone: "risk" });
    assert.equal(orderSideBadge("hold"), undefined);
    assert.equal(orderSideBadge(""), undefined);
    assert.equal(orderSideBadge("__proto__"), undefined);
    assert.deepEqual(orderTypeBadge("market"), { label: "orders.market", tone: "warning" });
    assert.deepEqual(orderTypeBadge("limit"), { label: "orders.limit", tone: "muted" });
    assert.equal(orderTypeBadge("stop"), undefined);
    assert.equal(orderTypeBadge(""), undefined);
    assert.deepEqual(orderStatusBadge("open"), { label: "orders.open", tone: "success" });
    assert.deepEqual(orderStatusBadge("cancelled"), { label: "orders.cancelled", tone: "muted" });
    assert.deepEqual(orderStatusBadge("expired"), { label: "orders.expired", tone: "warning" });
    assert.deepEqual(orderStatusBadge("rejected"), { label: "orders.rejected", tone: "risk" });
    assert.equal(orderStatusBadge("filled"), undefined);
    assert.equal(orderStatusBadge("partially_filled"), undefined);
    assert.equal(orderStatusBadge(""), undefined);
  });

  it("resolves the sheet's strings in every locale", () => {
    const keys = [
      "orders.title",
      "orders.entryDetail",
      "orders.listTitle",
      "orders.listLabel",
      "orders.empty",
      "orders.gated",
      "orders.loadFailed",
      "orders.note",
      "orders.detailTitle",
      "orders.back",
      "orders.buy",
      "orders.sell",
      "orders.side",
      "orders.orderType",
      "orders.market",
      "orders.limit",
      "orders.status",
      "orders.open",
      "orders.cancelled",
      "orders.expired",
      "orders.rejected",
      "orders.price",
      "orders.quantity",
      "orders.quoteAmount",
      "orders.total",
      "orders.orderId",
      "orders.placedAt",
      "orders.updatedAt"
    ] as const;
    for (const locale of locales) {
      for (const key of keys) {
        assert.notEqual(translate(locale, key), key, `${locale}:${key}`);
      }
    }
  });

  it("renders the list rows from the served view without fabricating orders", () => {
    assert.ok(sheetSource.includes("api.exchangeOrders()"));
    assert.ok(sheetSource.includes("ordersHistory(view)"));
    assert.ok(sheetSource.includes("aria-label={t(\"orders.listLabel\")}"));
    // Quantity at the pair's baseScale, price at the fixed contract priceScale.
    assert.ok(sheetSource.includes("formattedLeg(order.baseAmount, pairDef?.baseScale, format.decimal)"));
    assert.ok(sheetSource.includes("formattedLeg(order.price, quotePriceScale, format.decimal)"));
    // Side and status render through the fail-closed badge maps with a raw-text fallback.
    assert.ok(sheetSource.includes("orderSideBadge(order.side)"));
    assert.ok(sheetSource.includes("orderStatusBadge(order.status)"));
    assert.ok(sheetSource.includes("pill--${sideBadge?.tone"));
    assert.ok(sheetSource.includes("pill--${statusBadge?.tone"));
    assert.ok(sheetSource.includes("format.epochMs(order.createdAt)"));
  });

  it("opens the order detail from a row like the trades sheet drills into a fill", () => {
    assert.ok(sheetSource.includes('mode.kind === "detail"'));
    assert.ok(sheetSource.includes('onClick={() => show({ kind: "detail", order })}'));
    // The detail reuses the fetched row — the BFF exposes no member read /bff/exchange-orders/{id}.
    assert.ok(sheetSource.includes("<OrderDetail order={mode.order}"));
    assert.ok(sheetSource.includes("contractQuotePair(order.pair)"));
    for (const key of [
      "orders.side",
      "orders.orderType",
      "orders.status",
      "orders.price",
      "orders.quantity",
      "orders.quoteAmount",
      "common.fee",
      "orders.total",
      "orders.placedAt",
      "orders.updatedAt",
      "orders.orderId",
      "orders.back"
    ]) {
      assert.ok(sheetSource.includes(`t("${key}")`), key);
    }
    assert.ok(sheetSource.includes('className="cta cta--ghost"'));
  });

  it("covers the empty, gated and load-failed states like the sibling sheets", () => {
    assert.ok(sheetSource.includes('history.kyc !== "verified"'));
    assert.ok(sheetSource.includes('t("orders.gated")'));
    assert.ok(sheetSource.includes('t("orders.empty")'));
    assert.ok(sheetSource.includes('t("orders.loadFailed")'));
    assert.ok(sheetSource.includes('t("common.loading")'));
    assert.ok(sheetSource.includes('t("orders.note")'));
    // The list only renders when the subject is not gated — the gated view holds no rows.
    assert.ok(sheetSource.includes("!gated && orders.length > 0"));
  });

  it("wires the sheet into navigation, the sheet host and the home list", () => {
    assert.ok(navigationSource.includes('{ kind: "orders" }'));
    assert.ok(sheetsSource.includes('case "orders":'));
    assert.ok(sheetsSource.includes("OrdersSheet"));
    assert.ok(homeSource.includes('{ kind: "orders" }'));
    assert.ok(homeSource.includes('t("orders.title")'));
    assert.ok(homeSource.includes('t("orders.entryDetail")'));
    assert.ok(apiSource.includes('exchangeOrders: () => call<ExchangeOrdersView>("/bff/exchange-orders")'));
  });

  it("keeps the shared pair table the single source for app and BFF", () => {
    assert.ok(sheetSource.includes('from "../shared/quote"'));
    assert.ok(serverQuotesSource.includes('from "../shared/quote.js"'));
    assert.ok(serverQuotesSource.includes("contractQuotePair"));
  });

  it("surfaces served-history truncation instead of silently dropping rows", () => {
    assert.ok(sheetSource.includes('t("common.truncated"'));
  });
});

const orderRow: ExchangeOrderView = {
  id: "ord_a1b2c3d4e5f6a7b8c9d0e1f2",
  pair: "TON/RUB",
  base: "TON",
  quote: "RUB",
  side: "sell",
  orderType: "limit",
  baseAmount: "10.000000000",
  price: "450.00000000",
  quoteAmount: "4500.00",
  feeBps: 25,
  feeAmount: "11.25",
  totalQuoteAmount: "4511.25",
  status: "open",
  createdAt: Date.parse("2026-10-10T09:00:00.000Z"),
  updatedAt: Date.parse("2026-10-10T09:05:00.000Z"),
  execution: "not_supported",
  posting: "none"
};

const ordersView = { mode: "test", kyc: "verified", orders: [orderRow] } as const;

describe("ordersHistory served-view adapter", () => {
  it("adapts a valid orders view, keeping the kyc flag, rows and pre-truncation total", () => {
    const history = ordersHistory(ordersView);
    assert.equal(history?.kyc, "verified");
    assert.equal(history?.rows.length, 1);
    assert.equal(history?.total, 1);
    assert.equal(history?.rows[0]?.id, orderRow.id);
    const gated = ordersHistory({ mode: "test", kyc: "kyc-gated", orders: [] });
    assert.equal(gated?.kyc, "kyc-gated");
    assert.equal(gated?.rows.length, 0);
  });

  it("fails closed on malformed orders views and rows (exact keys)", () => {
    for (const corrupt of [
      { ...ordersView, extra: true },
      { mode: "test", kyc: "verified" },
      { ...ordersView, mode: "live" },
      { ...ordersView, kyc: "unknown" },
      { ...ordersView, orders: "nope" },
      { ...ordersView, orders: [null] },
      { ...ordersView, orders: [{ ...orderRow, extra: 1 }] },
      { ...ordersView, orders: [{ ...orderRow, id: "ord_uppercaseAAAAAAAAAAAAAAAAAAAAAA" }] },
      { ...ordersView, orders: [{ ...orderRow, id: "trd_b2c3d4e5f6a7b8c9d0e1f2a3" }] },
      { ...ordersView, orders: [{ ...orderRow, pair: "BTC/USD" }] },
      { ...ordersView, orders: [{ ...orderRow, base: "USDT" }] },
      { ...ordersView, orders: [{ ...orderRow, side: "hold" }] },
      { ...ordersView, orders: [{ ...orderRow, orderType: "stop" }] },
      { ...ordersView, orders: [{ ...orderRow, status: "filled" }] },
      { ...ordersView, orders: [{ ...orderRow, baseAmount: "10.0000000000" }] },
      { ...ordersView, orders: [{ ...orderRow, price: "450.000000000" }] },
      { ...ordersView, orders: [{ ...orderRow, quoteAmount: "abc" }] },
      { ...ordersView, orders: [{ ...orderRow, feeBps: "25" }] },
      { ...ordersView, orders: [{ ...orderRow, createdAt: "2026-10-10" }] },
      { ...ordersView, orders: [{ ...orderRow, updatedAt: Number.NaN }] },
      { ...ordersView, orders: [{ ...orderRow, execution: "supported" }] },
      { ...ordersView, orders: [{ ...orderRow, posting: "signed" }] }
    ]) {
      assert.equal(ordersHistory(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("bounds the rendered history and reports the pre-truncation total", () => {
    const many = Array.from({ length: servedRowsLimit + 10 }, (_, index) => ({
      ...orderRow,
      id: `ord_${String(index).padStart(24, "0")}`
    }));
    const history = ordersHistory({ mode: "test", kyc: "verified", orders: many });
    assert.equal(history?.rows.length, servedRowsLimit);
    assert.equal(history?.total, servedRowsLimit + 10);
  });
});
