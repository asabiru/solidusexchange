import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCountdown,
  isQuoteExpired,
  quoteExpiringThresholdSeconds,
  quoteSecondsRemaining,
  quoteState
} from "./quote.js";

const issuedAt = 1_790_000_000_000;
const quote = { issuedAt, expiresAt: issuedAt + 30_000 };

describe("quote TTL helpers", () => {
  it("counts remaining whole seconds, rounding partial seconds up", () => {
    assert.equal(quoteSecondsRemaining(quote, issuedAt), 30);
    assert.equal(quoteSecondsRemaining(quote, issuedAt + 1), 30);
    assert.equal(quoteSecondsRemaining(quote, issuedAt + 1_000), 29);
    assert.equal(quoteSecondsRemaining(quote, issuedAt + 29_001), 1);
  });

  it("expires exactly at expiresAt and stays expired", () => {
    assert.equal(isQuoteExpired(quote, issuedAt + 29_999), false);
    assert.equal(isQuoteExpired(quote, issuedAt + 30_000), true);
    assert.equal(isQuoteExpired(quote, issuedAt + 90_000), true);
    assert.equal(quoteSecondsRemaining(quote, issuedAt + 30_000), 0);
    assert.equal(quoteSecondsRemaining(quote, issuedAt + 90_000), 0);
  });

  it("moves from fresh to expiring to expired", () => {
    assert.equal(quoteState(quote, issuedAt), "fresh");
    const expiringAt = quote.expiresAt - quoteExpiringThresholdSeconds * 1_000;
    assert.equal(quoteState(quote, expiringAt - 1), "fresh");
    assert.equal(quoteState(quote, expiringAt), "expiring");
    assert.equal(quoteState(quote, quote.expiresAt - 1), "expiring");
    assert.equal(quoteState(quote, quote.expiresAt), "expired");
  });

  it("formats the countdown as mm:ss", () => {
    assert.equal(formatCountdown(30), "00:30");
    assert.equal(formatCountdown(9), "00:09");
    assert.equal(formatCountdown(75), "01:15");
    assert.equal(formatCountdown(0), "00:00");
    assert.equal(formatCountdown(-4), "00:00");
  });
});
