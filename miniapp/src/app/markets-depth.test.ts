import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ApiError, api } from "./api.js";
import { depthTruncated } from "./markets-depth.js";

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

  it("drills from the instrument list into the depth panel like the checks sheet does", () => {
    assert.ok(sheetSource.includes("api.markets()"));
    assert.ok(sheetSource.includes('mode.kind === "detail"'));
    assert.ok(sheetSource.includes('onClick={() => show({ kind: "detail", instrument: market.instrument })}'));
    assert.ok(sheetSource.includes('aria-label={t("markets.listLabel")}'));
    assert.ok(sheetsSource.includes('case "markets":'));
    assert.ok(sheetsSource.includes("MarketsSheet"));
    assert.ok(homeSource.includes('{ kind: "markets" }'));
    assert.ok(apiSource.includes("marketDepth: (instrument: string) => call<MarketDepthView>"));
  });
});
