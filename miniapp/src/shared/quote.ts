export const quoteExpiringThresholdSeconds = 5;

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
