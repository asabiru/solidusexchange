import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { contractQuotePair, contractQuotePairs, quotePriceScale, quoteState } from "../shared/quote.js";
import { ApiError, api } from "./api.js";
import { locales, translate } from "./i18n.js";
import { quoteRoundingBadge, quoteSideBadge, quoteStateBadge, quoteStatusBadge } from "./quotes.js";

const sheetSource = readFileSync(new URL("../../src/app/QuotesSheet.tsx", import.meta.url), "utf8");
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

describe("quotes sheet", () => {
  it("requests the quote collection through /bff/quotes", async () => {
    let requested = "";
    const restore = stubFetch((path) => {
      requested = path;
      return jsonResponse({ mode: "test", kyc: "verified", quotes: [] });
    });
    try {
      const view = await api.quotes();
      assert.equal(requested, "/bff/quotes");
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
    } finally {
      restore();
    }
  });

  it("surfaces the unavailable upstream as an ApiError the sheet maps to the load-failed state", async () => {
    const restore = stubFetch(() => jsonResponse({ error: "quotes_unavailable" }, { status: 503 }));
    try {
      await assert.rejects(
        () => api.quotes(),
        (error: unknown) => error instanceof ApiError && error.status === 503 && error.code === "quotes_unavailable"
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

  it("maps only declared sides, roundings, statuses and timing states to badges (fail-closed)", () => {
    assert.deepEqual(quoteSideBadge("buy"), { label: "quotes.buy", tone: "success" });
    assert.deepEqual(quoteSideBadge("sell"), { label: "quotes.sell", tone: "risk" });
    assert.equal(quoteSideBadge("hold"), undefined);
    assert.equal(quoteSideBadge(""), undefined);
    assert.equal(quoteSideBadge("__proto__"), undefined);
    assert.deepEqual(quoteRoundingBadge("up"), { label: "quotes.roundingUp", tone: "warning" });
    assert.deepEqual(quoteRoundingBadge("down"), { label: "quotes.roundingDown", tone: "muted" });
    assert.equal(quoteRoundingBadge("half-up"), undefined);
    assert.equal(quoteRoundingBadge(""), undefined);
    assert.deepEqual(quoteStatusBadge("indicative"), { label: "quotes.indicative", tone: "muted" });
    assert.equal(quoteStatusBadge("executed"), undefined);
    assert.equal(quoteStatusBadge("expired"), undefined);
    assert.equal(quoteStatusBadge(""), undefined);
    assert.deepEqual(quoteStateBadge("fresh"), { label: "quotes.stateFresh", tone: "success" });
    assert.deepEqual(quoteStateBadge("expiring"), { label: "quotes.stateExpiring", tone: "warning" });
    assert.deepEqual(quoteStateBadge("expired"), { label: "quotes.stateExpired", tone: "muted" });
    assert.equal(quoteStateBadge("executed"), undefined);
    assert.equal(quoteStateBadge(""), undefined);
    // The timing state derives only from the contract timing fields, not a served status.
    assert.equal(quoteState({ issuedAt: 10_000, expiresAt: 40_000 }, 10_000), "fresh");
    assert.equal(quoteState({ issuedAt: 10_000, expiresAt: 40_000 }, 36_000), "expiring");
    assert.equal(quoteState({ issuedAt: 10_000, expiresAt: 40_000 }, 40_000), "expired");
    assert.equal(quoteState({ issuedAt: 10_000, expiresAt: Number.NaN }, 10_000), "expired");
  });

  it("resolves the sheet's strings in every locale", () => {
    const keys = [
      "quotes.title",
      "quotes.entryDetail",
      "quotes.listTitle",
      "quotes.listLabel",
      "quotes.empty",
      "quotes.gated",
      "quotes.loadFailed",
      "quotes.note",
      "quotes.detailTitle",
      "quotes.back",
      "quotes.buy",
      "quotes.sell",
      "quotes.side",
      "quotes.rounding",
      "quotes.roundingUp",
      "quotes.roundingDown",
      "quotes.status",
      "quotes.indicative",
      "quotes.state",
      "quotes.stateFresh",
      "quotes.stateExpiring",
      "quotes.stateExpired",
      "quotes.price",
      "quotes.midPrice",
      "quotes.quantity",
      "quotes.quoteAmount",
      "quotes.total",
      "quotes.spread",
      "quotes.feeRate",
      "quotes.issuedAt",
      "quotes.expiresAt",
      "quotes.observedAt",
      "quotes.quoteId"
    ] as const;
    for (const locale of locales) {
      for (const key of keys) {
        assert.notEqual(translate(locale, key), key, `${locale}:${key}`);
      }
    }
  });

  it("renders the list rows from the served view without fabricating quotes", () => {
    assert.ok(sheetSource.includes("api.quotes()"));
    assert.ok(sheetSource.includes("arrayOf<QuoteView>(view?.quotes)"));
    assert.ok(sheetSource.includes("aria-label={t(\"quotes.listLabel\")}"));
    // Base amount at the pair's baseScale, price at the fixed contract priceScale.
    assert.ok(sheetSource.includes("formattedLeg(quote.baseAmount, pairDef?.baseScale, format.decimal)"));
    assert.ok(sheetSource.includes("formattedLeg(quote.price, quotePriceScale, format.decimal)"));
    // Side and the derived timing state render through the fail-closed badge maps with a raw-text fallback.
    assert.ok(sheetSource.includes("quoteSideBadge(quote.side)"));
    assert.ok(sheetSource.includes("quoteStateBadge(quoteState(quote, nowMs))"));
    assert.ok(sheetSource.includes("pill--${sideBadge?.tone"));
    assert.ok(sheetSource.includes("pill--${stateBadge?.tone"));
    assert.ok(sheetSource.includes("format.epochMs(quote.issuedAt)"));
  });

  it("opens the quote detail from a row like the orders sheet drills into an order", () => {
    assert.ok(sheetSource.includes('mode.kind === "detail"'));
    assert.ok(sheetSource.includes('onClick={() => show({ kind: "detail", quote })}'));
    // The detail reuses the fetched row — the BFF exposes no member read /bff/quotes/{id}.
    assert.ok(sheetSource.includes("<QuoteDetail quote={mode.quote}"));
    assert.ok(sheetSource.includes("contractQuotePair(quote.pair)"));
    for (const key of [
      "quotes.side",
      "quotes.rounding",
      "quotes.status",
      "quotes.state",
      "quotes.price",
      "quotes.midPrice",
      "quotes.quantity",
      "quotes.quoteAmount",
      "common.fee",
      "quotes.total",
      "quotes.spread",
      "quotes.feeRate",
      "quotes.issuedAt",
      "quotes.expiresAt",
      "quotes.observedAt",
      "quotes.quoteId",
      "quotes.back"
    ]) {
      assert.ok(sheetSource.includes(`t("${key}")`), key);
    }
    assert.ok(sheetSource.includes('className="cta cta--ghost"'));
  });

  it("covers the empty, gated and load-failed states like the sibling sheets", () => {
    assert.ok(sheetSource.includes('view.kyc !== "verified"'));
    assert.ok(sheetSource.includes('t("quotes.gated")'));
    assert.ok(sheetSource.includes('t("quotes.empty")'));
    assert.ok(sheetSource.includes('t("quotes.loadFailed")'));
    assert.ok(sheetSource.includes('t("common.loading")'));
    assert.ok(sheetSource.includes('t("quotes.note")'));
    // The list only renders when the subject is not gated — the gated view holds no rows.
    assert.ok(sheetSource.includes("!gated && quotes.length > 0"));
  });

  it("wires the sheet into navigation, the sheet host and the home list", () => {
    assert.ok(navigationSource.includes('{ kind: "quotes" }'));
    assert.ok(sheetsSource.includes('case "quotes":'));
    assert.ok(sheetsSource.includes("QuotesSheet"));
    assert.ok(homeSource.includes('{ kind: "quotes" }'));
    assert.ok(homeSource.includes('t("quotes.title")'));
    assert.ok(homeSource.includes('t("quotes.entryDetail")'));
    assert.ok(apiSource.includes('quotes: () => call<QuotesView>("/bff/quotes")'));
  });

  it("keeps the shared pair table the single source for app and BFF", () => {
    assert.ok(sheetSource.includes('from "../shared/quote"'));
    assert.ok(serverQuotesSource.includes('from "../shared/quote.js"'));
    assert.ok(serverQuotesSource.includes("contractQuotePair"));
  });
});
