import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadServerConfig } from "./config.js";
import { createLocalQuoteProvider, createSimulatorQuoteProvider, routeQuote } from "./provider-quotes.js";
import { QuoteError } from "./quotes.js";
import { toUnits } from "../shared/decimal.js";

const startMs = 1_790_000_000_000;

function provider(scenario?: "fresh_quote" | "expired_quote" | "stale_price" | "provider_outage") {
  let now = startMs;
  const quotes = createSimulatorQuoteProvider({ seed: "miniapp-test", ttlSeconds: 30, clock: () => now, scenario });
  return {
    quotes,
    advance(ms: number) {
      now += ms;
    },
    now: () => now
  };
}

function context(now: number, overrides: { available?: string; kycRequired?: boolean; subject?: string } = {}) {
  return { nowMs: now, ttlSeconds: 30, kycRequired: false, subject: "tg-0123456789abcdef", ...overrides };
}

async function rejectsWith(promise: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof QuoteError);
    assert.equal(error.code, code);
    assert.equal(error.reason, reason);
    return true;
  });
}

describe("provider simulator quote adapter", () => {
  it("routes asset directions onto provider pairs and sides", () => {
    assert.deepEqual(routeQuote("RUB", "USDT"), { pair: "USDT/RUB", side: "buy" });
    assert.deepEqual(routeQuote("USDT", "RUB"), { pair: "USDT/RUB", side: "sell" });
    assert.deepEqual(routeQuote("RUB", "TON"), { pair: "TON/RUB", side: "buy" });
    assert.deepEqual(routeQuote("TON", "USDT"), { pair: "TON/USDT", side: "sell" });
    assert.deepEqual(routeQuote("USDT", "TON"), { pair: "TON/USDT", side: "buy" });
    assert.equal(routeQuote("RUB", "RUB"), undefined);
  });

  it("maps a RUB spend into a buy quote that never exceeds the entered amount", async () => {
    const { quotes, now } = provider();
    const quote = await quotes.preview({ from: "RUB", to: "USDT", amount: "25000" }, context(now(), { available: "184250.00" }));
    assert.equal(quotes.source, "provider-simulator");
    assert.match(quote.id, /^quote_[0-9a-f]{32}$/);
    assert.equal(quote.from, "RUB");
    assert.equal(quote.to, "USDT");
    assert.ok(toUnits(quote.amountIn, 2) <= toUnits("25000.00", 2));
    assert.ok(toUnits(quote.amountIn, 2) > toUnits("24990.00", 2));
    assert.equal(quote.total, quote.amountIn);
    assert.equal(quote.feeAsset, "RUB");
    assert.equal(toUnits(quote.netIn, 2) + toUnits(quote.fee, 2), toUnits(quote.amountIn, 2));
    assert.match(quote.amountOut, /^[0-9]+\.[0-9]{6}$/);
    assert.deepEqual({ base: quote.rate.base, quote: quote.rate.quote }, { base: "USDT", quote: "RUB" });
    assert.match(quote.rate.value, /^[0-9]+\.[0-9]{8}$/);
    assert.equal(quote.ttlSeconds, 30);
    assert.equal(quote.expiresAt - quote.issuedAt, 30_000);
    assert.equal(quote.serverTime, now());
    assert.equal(quote.insufficientBalance, false);
    assert.equal(quote.executable, false);
    assert.equal(quote.executionUnavailableReason, "dev_test_version");
  });

  it("maps a crypto sell with the fee charged in the received asset", async () => {
    const { quotes, now } = provider();
    const quote = await quotes.preview({ from: "TON", to: "RUB", amount: "2.5" }, context(now(), { available: "1.000000000" }));
    assert.equal(quote.amountIn, "2.500000000");
    assert.equal(quote.netIn, "2.500000000");
    assert.equal(quote.feeAsset, "RUB");
    assert.match(quote.amountOut, /^[0-9]+\.[0-9]{2}$/);
    assert.deepEqual({ base: quote.rate.base, quote: quote.rate.quote }, { base: "TON", quote: "RUB" });
    assert.equal(quote.insufficientBalance, true);
  });

  it("is deterministic per subject and TTL window and re-quotes after expiry", async () => {
    const { quotes, now, advance } = provider();
    const first = await quotes.preview({ from: "USDT", to: "RUB", amount: "100" }, context(now()));
    assert.equal((await quotes.preview({ from: "USDT", to: "RUB", amount: "100.000000" }, context(now()))).id, first.id);
    const other = await quotes.preview({ from: "USDT", to: "RUB", amount: "100" }, context(now(), { subject: "tg-fedcba9876543210" }));
    assert.notEqual(other.id, first.id);
    advance(30_000);
    const next = await quotes.preview({ from: "USDT", to: "RUB", amount: "100" }, context(now()));
    assert.notEqual(next.id, first.id);
    assert.ok(next.issuedAt >= first.expiresAt);
  });

  it("returns an already expired quote so the client shows the expired state", async () => {
    const { quotes, now } = provider("expired_quote");
    const quote = await quotes.preview({ from: "RUB", to: "TON", amount: "1000" }, context(now()));
    assert.ok(quote.expiresAt <= now());
    assert.equal(quote.executable, false);
  });

  it("refuses stale prices and provider outages as quote_unavailable", async () => {
    const stale = provider("stale_price");
    await rejectsWith(stale.quotes.preview({ from: "RUB", to: "USDT", amount: "1000" }, context(stale.now())), "quote_unavailable", "stale_price");
    const outage = provider("provider_outage");
    await rejectsWith(outage.quotes.preview({ from: "RUB", to: "USDT", amount: "1000" }, context(outage.now())), "quote_unavailable", "provider_outage");
  });

  it("rejects invalid pairs and amounts before calling the provider", async () => {
    const { quotes, now } = provider();
    await rejectsWith(quotes.preview({ from: "RUB", to: "RUB", amount: "1" }, context(now())), "invalid_pair");
    await rejectsWith(quotes.preview({ from: "BTC", to: "RUB", amount: "1" }, context(now())), "invalid_pair");
    for (const amount of ["", "0", "1e3", "-1", "1.001", "abc"]) {
      await rejectsWith(quotes.preview({ from: "RUB", to: "USDT", amount }, context(now())), "invalid_amount");
    }
    await rejectsWith(quotes.preview({ from: "RUB", to: "TON", amount: "0.01" }, context(now())), "amount_too_small");
  });

  it("keeps the local simulator as the default quote source", async () => {
    assert.equal(loadServerConfig({}).quoteSource, "local");
    assert.equal(loadServerConfig({ MINIAPP_QUOTE_SOURCE: "provider-simulator" }).quoteSource, "provider-simulator");
    assert.throws(() => loadServerConfig({ MINIAPP_QUOTE_SOURCE: "live" }), /MINIAPP_QUOTE_SOURCE/);
    assert.throws(() => loadServerConfig({ MINIAPP_QUOTE_SCENARIO: "firm_quote" }), /MINIAPP_QUOTE_SCENARIO/);
    assert.throws(() => loadServerConfig({ MINIAPP_QUOTE_SEED: "bad seed" }), /MINIAPP_QUOTE_SEED/);
    const local = createLocalQuoteProvider();
    assert.equal(local.source, "local");
    const quote = await local.preview({ from: "RUB", to: "USDT", amount: "5000" }, context(startMs));
    assert.equal(quote.amountOut, "53.681807");
  });
});
