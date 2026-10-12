import type { QuotePair } from "./api.js";
import type { AssetCode } from "./assets.js";

export const quoteExpiringThresholdSeconds = 5;

/** Prices in the customer-api exchange contract carry this fixed decimal scale. */
export const quotePriceScale = 8;

/**
 * The customer-api quotes contract pair set with each leg's declared decimal
 * scale (mirrors the upstream QUOTE_PAIRS, which in turn mirror the provider
 * simulator's SYNTHETIC_MID_PRICES and ASSET_SCALES).
 */
export interface ContractQuotePair {
  pair: QuotePair;
  base: AssetCode;
  quote: AssetCode;
  baseScale: number;
  quoteScale: number;
}

export const contractQuotePairs: readonly ContractQuotePair[] = Object.freeze([
  Object.freeze({ pair: "USDT/RUB", base: "USDT", quote: "RUB", baseScale: 6, quoteScale: 2 }),
  Object.freeze({ pair: "TON/RUB", base: "TON", quote: "RUB", baseScale: 9, quoteScale: 2 }),
  Object.freeze({ pair: "TON/USDT", base: "TON", quote: "USDT", baseScale: 9, quoteScale: 6 })
]);

export function contractQuotePair(pair: unknown): ContractQuotePair | undefined {
  return typeof pair === "string" ? contractQuotePairs.find((entry) => entry.pair === pair) : undefined;
}

export interface QuoteTiming {
  issuedAt: number;
  expiresAt: number;
}

export type QuoteState = "fresh" | "expiring" | "expired";

export function isQuoteExpired(quote: QuoteTiming, nowMs: number): boolean {
  // A non-finite expiry can never prove freshness: fail closed as expired.
  return !Number.isFinite(quote.expiresAt) || nowMs >= quote.expiresAt;
}

export function quoteSecondsRemaining(quote: QuoteTiming, nowMs: number): number {
  const remaining = quote.expiresAt - nowMs;
  if (!Number.isFinite(remaining) || isQuoteExpired(quote, nowMs)) return 0;
  return Math.ceil(remaining / 1_000);
}

export function quoteState(quote: QuoteTiming, nowMs: number): QuoteState {
  const remaining = quoteSecondsRemaining(quote, nowMs);
  if (remaining === 0) return "expired";
  return remaining <= quoteExpiringThresholdSeconds ? "expiring" : "fresh";
}

export function formatCountdown(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
