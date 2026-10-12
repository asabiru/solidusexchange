import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { contractQuotePair, contractQuotePairs, quotePriceScale } from "../shared/quote.js";
import { ApiError, api } from "./api.js";
import { locales, translate } from "./i18n.js";
import { tradeLiquidityBadge, tradeSideBadge } from "./trades.js";

const sheetSource = readFileSync(new URL("../../src/app/TradesSheet.tsx", import.meta.url), "utf8");
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

describe("trades sheet", () => {
  it("requests the fill history through /bff/trades", async () => {
    let requested = "";
    const restore = stubFetch((path) => {
      requested = path;
      return jsonResponse({ mode: "test", kyc: "verified", trades: [] });
    });
    try {
      const view = await api.trades();
      assert.equal(requested, "/bff/trades");
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
    } finally {
      restore();
    }
  });

  it("surfaces the unavailable upstream as an ApiError the sheet maps to the load-failed state", async () => {
    const restore = stubFetch(() => jsonResponse({ error: "trades_unavailable" }, { status: 503 }));
    try {
      await assert.rejects(
        () => api.trades(),
        (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "trades_unavailable"
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

  it("maps only declared sides and liquidities to badges (fail-closed)", () => {
    assert.deepEqual(tradeSideBadge("buy"), { label: "trades.buy", tone: "success" });
    assert.deepEqual(tradeSideBadge("sell"), { label: "trades.sell", tone: "risk" });
    assert.equal(tradeSideBadge("hold"), undefined);
    assert.equal(tradeSideBadge(""), undefined);
    assert.equal(tradeSideBadge("__proto__"), undefined);
    assert.deepEqual(tradeLiquidityBadge("maker"), { label: "trades.maker", tone: "muted" });
    assert.deepEqual(tradeLiquidityBadge("taker"), { label: "trades.taker", tone: "warning" });
    assert.equal(tradeLiquidityBadge("self"), undefined);
    assert.equal(tradeLiquidityBadge(""), undefined);
  });

  it("resolves the sheet's strings in every locale", () => {
    const keys = [
      "trades.title",
      "trades.entryDetail",
      "trades.listTitle",
      "trades.listLabel",
      "trades.empty",
      "trades.gated",
      "trades.loadFailed",
      "trades.note",
      "trades.detailTitle",
      "trades.back",
      "trades.buy",
      "trades.sell",
      "trades.side",
      "trades.price",
      "trades.quantity",
      "trades.quoteAmount",
      "trades.total",
      "trades.liquidity",
      "trades.maker",
      "trades.taker",
      "trades.orderId",
      "trades.executedAt"
    ] as const;
    for (const locale of locales) {
      for (const key of keys) {
        assert.notEqual(translate(locale, key), key, `${locale}:${key}`);
      }
    }
  });

  it("renders the list rows from the served view without fabricating fills", () => {
    assert.ok(sheetSource.includes("api.trades()"));
    assert.ok(sheetSource.includes("arrayOf<TradeView>(view?.trades)"));
    assert.ok(sheetSource.includes("aria-label={t(\"trades.listLabel\")}"));
    // Quantity at the pair's baseScale, price at the fixed contract priceScale.
    assert.ok(sheetSource.includes("formattedLeg(trade.quantity, pairDef?.baseScale, format.decimal)"));
    assert.ok(sheetSource.includes("formattedLeg(trade.price, quotePriceScale, format.decimal)"));
    // Side and liquidity render through the fail-closed badge maps with a raw-text fallback.
    assert.ok(sheetSource.includes("tradeSideBadge(trade.side)"));
    assert.ok(sheetSource.includes("tradeLiquidityBadge(trade.liquidity)"));
    assert.ok(sheetSource.includes("pill--${sideBadge?.tone"));
    assert.ok(sheetSource.includes("pill--${liquidityBadge?.tone"));
    assert.ok(sheetSource.includes("format.epochMs(trade.executedAt)"));
  });

  it("opens the fill detail from a row like the markets sheet drills into depth", () => {
    assert.ok(sheetSource.includes('mode.kind === "detail"'));
    assert.ok(sheetSource.includes('onClick={() => show({ kind: "detail", trade })}'));
    // The detail reuses the fetched row — there is no member read /bff/trades/{id}.
    assert.ok(sheetSource.includes("<TradeDetail trade={mode.trade}"));
    assert.ok(sheetSource.includes("contractQuotePair(trade.pair)"));
    for (const key of [
      "trades.side",
      "trades.price",
      "trades.quantity",
      "trades.quoteAmount",
      "common.fee",
      "trades.total",
      "trades.liquidity",
      "trades.executedAt",
      "trades.orderId",
      "trades.back"
    ]) {
      assert.ok(sheetSource.includes(`t("${key}")`), key);
    }
    assert.ok(sheetSource.includes('className="cta cta--ghost"'));
  });

  it("covers the empty, gated and load-failed states like the sibling sheets", () => {
    assert.ok(sheetSource.includes('view.kyc !== "verified"'));
    assert.ok(sheetSource.includes('t("trades.gated")'));
    assert.ok(sheetSource.includes('t("trades.empty")'));
    assert.ok(sheetSource.includes('t("trades.loadFailed")'));
    assert.ok(sheetSource.includes('t("common.loading")'));
    assert.ok(sheetSource.includes('t("trades.note")'));
    // The list only renders when the subject is not gated — the gated view holds no rows.
    assert.ok(sheetSource.includes("!gated && trades.length > 0"));
  });

  it("wires the sheet into navigation, the sheet host and the home list", () => {
    assert.ok(navigationSource.includes('{ kind: "trades" }'));
    assert.ok(sheetsSource.includes('case "trades":'));
    assert.ok(sheetsSource.includes("TradesSheet"));
    assert.ok(homeSource.includes('{ kind: "trades" }'));
    assert.ok(homeSource.includes('t("trades.title")'));
    assert.ok(homeSource.includes('t("trades.entryDetail")'));
    assert.ok(apiSource.includes('trades: () => call<TradesView>("/bff/trades")'));
  });

  it("keeps the shared pair table the single source for app and BFF", () => {
    assert.ok(sheetSource.includes('from "../shared/quote"'));
    assert.ok(serverQuotesSource.includes('from "../shared/quote.js"'));
    assert.ok(serverQuotesSource.includes("contractQuotePair"));
  });
});
