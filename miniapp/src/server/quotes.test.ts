import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isQuoteExpired, quoteSecondsRemaining } from "../shared/quote.js";
import { feeBps, QuoteError, simulateQuote, spreadBps, valueInRub } from "./quotes.js";

const nowMs = 1_790_000_000_000;
const context = { nowMs, ttlSeconds: 30, kycRequired: false };

function quoteError(code: string) {
  return (error: unknown) => error instanceof QuoteError && error.code === code;
}

describe("deterministic quote simulator", () => {
  it("prices a RUB to USDT purchase with fee, spread and exact strings", () => {
    const quote = simulateQuote({ from: "RUB", to: "USDT", amount: "5000" }, context);
    assert.equal(quote.amountIn, "5000.00");
    assert.equal(quote.fee, "15.00");
    assert.equal(quote.feeAsset, "RUB");
    assert.equal(quote.netIn, "4985.00");
    assert.deepEqual(quote.rate, { base: "USDT", quote: "RUB", value: "92.86200000" });
    assert.equal(quote.amountOut, "53.681807");
    assert.equal(quote.total, "5000.00");
    assert.equal(quote.feeBps, feeBps);
    assert.equal(quote.spreadBps, spreadBps);
    for (const value of [quote.amountIn, quote.fee, quote.amountOut, quote.rate.value]) {
      assert.equal(typeof value, "string");
    }
  });

  it("prices a sale to RUB at the bid side", () => {
    const quote = simulateQuote({ from: "USDT", to: "RUB", amount: "100" }, context);
    assert.equal(quote.fee, "0.300000");
    assert.deepEqual(quote.rate, { base: "USDT", quote: "RUB", value: "91.93800000" });
    assert.equal(quote.amountOut, "9166.21");
  });

  it("prices crypto-to-crypto pairs through the RUB cross", () => {
    const quote = simulateQuote({ from: "USDT", to: "TON", amount: "50" }, context);
    assert.equal(quote.rate.base, "USDT");
    assert.equal(quote.rate.quote, "TON");
    assert.equal(quote.amountOut, "15.995467419");
  });

  it("is deterministic for the same input and clock", () => {
    const first = simulateQuote({ from: "RUB", to: "TON", amount: "25000.50" }, context);
    const second = simulateQuote({ from: "RUB", to: "TON", amount: "25000.5" }, context);
    assert.deepEqual(first, second);
    const later = simulateQuote({ from: "RUB", to: "TON", amount: "25000.5" }, { ...context, nowMs: nowMs + 1 });
    assert.notEqual(later.id, first.id);
    assert.equal(later.amountOut, first.amountOut);
  });

  it("issues quotes that expire after the configured TTL", () => {
    const quote = simulateQuote({ from: "RUB", to: "USDT", amount: "1000" }, context);
    assert.equal(quote.issuedAt, nowMs);
    assert.equal(quote.serverTime, nowMs);
    assert.equal(quote.expiresAt, nowMs + 30_000);
    assert.equal(quoteSecondsRemaining(quote, nowMs + 12_500), 18);
    assert.equal(isQuoteExpired(quote, nowMs + 29_999), false);
    assert.equal(isQuoteExpired(quote, nowMs + 30_000), true);
    const short = simulateQuote({ from: "RUB", to: "USDT", amount: "1000" }, { ...context, ttlSeconds: 10 });
    assert.equal(short.expiresAt - short.issuedAt, 10_000);
  });

  it("is never executable and flags balance and KYC preconditions", () => {
    const quote = simulateQuote(
      { from: "RUB", to: "USDT", amount: "90000" },
      { ...context, available: "84200.00", kycRequired: true }
    );
    assert.equal(quote.executable, false);
    assert.equal(quote.executionUnavailableReason, "dev_test_version");
    assert.equal(quote.insufficientBalance, true);
    assert.equal(quote.kycRequired, true);
    const covered = simulateQuote({ from: "RUB", to: "USDT", amount: "84200" }, { ...context, available: "84200.00" });
    assert.equal(covered.insufficientBalance, false);
    assert.ok(Object.isFrozen(quote));
  });

  it("rejects invalid pairs and amounts", () => {
    assert.throws(() => simulateQuote({ from: "RUB", to: "RUB", amount: "1" }, context), quoteError("invalid_pair"));
    assert.throws(() => simulateQuote({ from: "BTC", to: "RUB", amount: "1" }, context), quoteError("invalid_pair"));
    for (const amount of ["", "0", "0.00", "-5", "1e3", "1.001", "abc", "1,5"]) {
      assert.throws(() => simulateQuote({ from: "RUB", to: "USDT", amount }, context), quoteError("invalid_amount"), amount);
    }
    assert.throws(() => simulateQuote({ from: "RUB", to: "TON", amount: "0.01" }, context), quoteError("amount_too_small"));
  });

  it("values balances in RUB with half-up rounding", () => {
    assert.equal(valueInRub("RUB", "84200.00"), "84200.00");
    assert.equal(valueInRub("USDT", "482.180000"), "44553.43");
    assert.equal(valueInRub("TON", "0.000000001"), "0.00");
  });
});
