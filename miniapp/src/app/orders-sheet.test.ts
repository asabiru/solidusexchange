import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { contractQuotePair, contractQuotePairs, quotePriceScale } from "../shared/quote.js";
import { ApiError, api } from "./api.js";
import { locales, translate } from "./i18n.js";
import { orderSideBadge, orderStatusBadge, orderTypeBadge } from "./orders.js";

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
    assert.ok(sheetSource.includes("arrayOf<ExchangeOrderView>(view?.orders)"));
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
    assert.ok(sheetSource.includes('view.kyc !== "verified"'));
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
});
