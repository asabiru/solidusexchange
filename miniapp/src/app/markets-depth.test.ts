import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { MarketDepthView, MarketLevelView, MarketView } from "../shared/api.js";
import { ApiError, api } from "./api.js";
import { depthTruncated, marketDepthOf, marketsViewOf } from "./markets-depth.js";
import { servedRowsLimit } from "./served-views.js";

const sheetSource = readFileSync(new URL("../../src/app/MarketsSheet.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../../src/app/screens/HomeScreen.tsx", import.meta.url), "utf8");
const sheetsSource = readFileSync(new URL("../../src/app/sheets.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../src/app/api.ts", import.meta.url), "utf8");

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

describe("market depth panel", () => {
  it("requests the member read through the percent-encoded instrument path", async () => {
    let requested = "";
    const restore = stubFetch((path) => {
      requested = path;
      return jsonResponse({
        mode: "test",
        instrument: "USDT/RUB",
        base: "USDT",
        quote: "RUB",
        bids: [],
        asks: [],
        lastTrade: null,
        depthLevels: 0,
        baseScale: 6,
        quoteScale: 2,
        priceScale: 8,
        asOf: 1_775_000_000_000,
        posting: "none"
      });
    });
    try {
      const view = await api.marketDepth("USDT/RUB");
      assert.equal(requested, "/bff/markets/USDT%2FRUB");
      assert.equal(view.instrument, "USDT/RUB");
    } finally {
      restore();
    }
  });

  it("surfaces the member read's 404 as an ApiError the panel maps to not-found", async () => {
    const restore = stubFetch(() => jsonResponse({ error: "not_found" }, { status: 404 }));
    try {
      await assert.rejects(
        () => api.marketDepth("USDT/RUB"),
        (error: unknown) => error instanceof ApiError && error.status === 404
      );
    } finally {
      restore();
    }
  });

  it("flags truncation only when the deeper side outruns the served levels", () => {
    const level = { price: "89.99000000", quantity: "25.000000", orderCount: 1 };
    assert.equal(depthTruncated({ bids: [level], asks: [level], depthLevels: 1 }), false);
    assert.equal(depthTruncated({ bids: [level], asks: [], depthLevels: 16 }), true);
    assert.equal(depthTruncated({ bids: Array(16).fill(level), asks: Array(16).fill(level), depthLevels: 16 }), false);
    assert.equal(depthTruncated({ bids: Array(16).fill(level), asks: Array(16).fill(level), depthLevels: 17 }), true);
    assert.equal(depthTruncated({ bids: [], asks: [], depthLevels: 0 }), false);
  });

  it("renders the ladder tables, last trade, as-of and the truncated hint from the depth view", () => {
    assert.ok(sheetSource.includes("api.marketDepth(instrument)"));
    for (const key of [
      "markets.bids",
      "markets.asks",
      "markets.price",
      "markets.quantity",
      "markets.orders",
      "markets.lastTrade",
      "markets.asOf",
      "markets.sideEmpty"
    ]) {
      assert.ok(sheetSource.includes(`t("${key}")`), key);
    }
    // A refused/absent book surfaces the local not-found copy, not a fabricated ladder.
    assert.ok(sheetSource.includes('"markets.notFound"'));
    // Levels format per the pair's own scales, never through the money helper.
    assert.ok(sheetSource.includes("format.decimal(level.price, { fractionDigits: depth.priceScale })"));
    assert.ok(sheetSource.includes("format.decimal(level.quantity, { fractionDigits: depth.baseScale })"));
    assert.ok(sheetSource.includes('t("markets.truncated", { total: depth.depthLevels })'));
    assert.ok(sheetSource.includes("depthTruncated(depth)"));
    assert.ok(sheetSource.includes("epochMs(depth.asOf)"));
    assert.ok(sheetSource.includes("caught instanceof ApiError && caught.status === 404"));
  });

  it("binds the member read to the requested instrument and the contract view", () => {
    assert.ok(sheetSource.includes("marketDepthOf(value)"));
    assert.ok(sheetSource.includes("adapted.instrument !== instrument"));
  });

  it("renders levels keyed by their index so duplicate server prices cannot collide", () => {
    assert.ok(sheetSource.includes('key={`${level.price}:${index}`}'));
    assert.ok(sheetSource.includes('key={`${market.instrument}:${index}`}'));
  });

  it("drills from the instrument list into the depth panel like the checks sheet does", () => {
    assert.ok(sheetSource.includes("api.markets()"));
    assert.ok(sheetSource.includes("marketsViewOf(view)"));
    assert.ok(sheetSource.includes('mode.kind === "detail"'));
    assert.ok(sheetSource.includes('onClick={() => show({ kind: "detail", instrument: market.instrument })}'));
    assert.ok(sheetSource.includes('aria-label={t("markets.listLabel")}'));
    assert.ok(sheetsSource.includes('case "markets":'));
    assert.ok(sheetsSource.includes("MarketsSheet"));
    assert.ok(homeSource.includes('{ kind: "markets" }'));
    assert.ok(apiSource.includes("marketDepth: (instrument: string) => call<MarketDepthView>"));
  });
});

const level: MarketLevelView = { price: "96.00000000", quantity: "100.000000", orderCount: 2 };

const marketRow: MarketView = {
  instrument: "USDT/RUB",
  base: "USDT",
  quote: "RUB",
  bestBid: level,
  bestAsk: { price: "97.00000000", quantity: "80.000000", orderCount: 1 },
  lastTrade: { price: "96.50000000", quantity: "5.000000", executedAt: 1_775_000_000_000 },
  spreadBps: 104,
  baseScale: 6,
  quoteScale: 2,
  priceScale: 8,
  asOf: 1_775_000_000_000,
  posting: "none"
};

const marketsView = { mode: "test", kyc: "verified", markets: [marketRow] } as const;

const depthView: MarketDepthView = {
  mode: "test",
  instrument: "USDT/RUB",
  base: "USDT",
  quote: "RUB",
  bids: [level, { price: "95.50000000", quantity: "40.000000", orderCount: 1 }],
  asks: [{ price: "97.00000000", quantity: "80.000000", orderCount: 1 }],
  lastTrade: marketRow.lastTrade,
  depthLevels: 3,
  baseScale: 6,
  quoteScale: 2,
  priceScale: 8,
  asOf: 1_775_000_000_000,
  posting: "none"
};

describe("markets served-view adapters", () => {
  it("adapts a valid markets view and a valid depth view", () => {
    const view = marketsViewOf(marketsView);
    assert.equal(view?.kyc, "verified");
    assert.equal(view?.rows.length, 1);
    assert.equal(view?.total, 1);
    const depth = marketDepthOf(depthView);
    assert.equal(depth?.instrument, "USDT/RUB");
    assert.equal(depth?.bids.length, 2);
    assert.equal(depth?.depthLevels, 3);
  });

  it("fails closed on malformed markets views and rows (exact keys)", () => {
    for (const corrupt of [
      { ...marketsView, extra: true },
      { mode: "test", kyc: "verified" },
      { ...marketsView, mode: "live" },
      { ...marketsView, kyc: "unknown" },
      { ...marketsView, markets: "nope" },
      { ...marketsView, markets: [null] },
      { ...marketsView, markets: [{ ...marketRow, extra: 1 }] },
      { ...marketsView, markets: [{ ...marketRow, instrument: "BTC/USD" }] },
      { ...marketsView, markets: [{ ...marketRow, base: "TON" }] },
      { ...marketsView, markets: [{ ...marketRow, quote: "USDT" }] },
      { ...marketsView, markets: [{ ...marketRow, priceScale: 9 }] },
      { ...marketsView, markets: [{ ...marketRow, priceScale: 1e9 }] },
      { ...marketsView, markets: [{ ...marketRow, priceScale: -1 }] },
      { ...marketsView, markets: [{ ...marketRow, priceScale: "8" }] },
      { ...marketsView, markets: [{ ...marketRow, baseScale: 9 }] },
      { ...marketsView, markets: [{ ...marketRow, bestBid: { ...level, price: "abc" } }] },
      { ...marketsView, markets: [{ ...marketRow, bestBid: { ...level, price: "96.000000000" } }] },
      { ...marketsView, markets: [{ ...marketRow, bestBid: { ...level, orderCount: "2" } }] },
      { ...marketsView, markets: [{ ...marketRow, bestBid: { ...level, orderCount: -1 } }] },
      { ...marketsView, markets: [{ ...marketRow, bestBid: { ...level, quantity: "100.0000000" } }] },
      { ...marketsView, markets: [{ ...marketRow, bestAsk: "nope" }] },
      { ...marketsView, markets: [{ ...marketRow, lastTrade: { ...marketRow.lastTrade, executedAt: "now" } }] },
      { ...marketsView, markets: [{ ...marketRow, spreadBps: "104" }] },
      { ...marketsView, markets: [{ ...marketRow, asOf: Number.NaN }] },
      { ...marketsView, markets: [{ ...marketRow, posting: "signed" }] }
    ]) {
      assert.equal(marketsViewOf(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("fails closed on malformed depth views and levels (exact keys)", () => {
    for (const corrupt of [
      { ...depthView, extra: true },
      { ...depthView, mode: "live" },
      { ...depthView, instrument: "BTC/USD" },
      { ...depthView, base: "TON" },
      { ...depthView, priceScale: "8" },
      { ...depthView, priceScale: 1e9 },
      { ...depthView, bids: "nope" },
      { ...depthView, bids: [null] },
      { ...depthView, bids: [{ ...level, extra: 1 }] },
      { ...depthView, bids: [{ ...level, price: "abc" }] },
      { ...depthView, bids: [{ ...level, orderCount: 1.5 }] },
      { ...depthView, asks: [{ ...level, quantity: "80.0000000" }] },
      { ...depthView, lastTrade: { ...depthView.lastTrade, executedAt: "now" } },
      { ...depthView, depthLevels: Number.NaN },
      { ...depthView, depthLevels: -1 },
      { ...depthView, depthLevels: "3" },
      { ...depthView, asOf: "2026-10-10" },
      { ...depthView, posting: "signed" }
    ]) {
      assert.equal(marketDepthOf(corrupt), undefined, JSON.stringify(corrupt).slice(0, 120));
    }
  });

  it("bounds the rendered ladder and rows to the shared served limit", () => {
    const many = Array.from({ length: servedRowsLimit + 10 }, (_, index) => ({
      ...level,
      price: `${90 + index}.00000000`
    }));
    const depth = marketDepthOf({ ...depthView, bids: many, depthLevels: many.length });
    assert.equal(depth?.bids.length, servedRowsLimit);
  });
});
