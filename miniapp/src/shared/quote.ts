export const quoteExpiringThresholdSeconds = 5;

export interface QuoteTiming {
  issuedAt: number;
  expiresAt: number;
}

export type QuoteState = "fresh" | "expiring" | "expired";

export function isQuoteExpired(quote: QuoteTiming, nowMs: number): boolean {
  return nowMs >= quote.expiresAt;
}

export function quoteSecondsRemaining(quote: QuoteTiming, nowMs: number): number {
  if (isQuoteExpired(quote, nowMs)) return 0;
  return Math.ceil((quote.expiresAt - nowMs) / 1_000);
}

export function quoteState(quote: QuoteTiming, nowMs: number): QuoteState {
  const remaining = quoteSecondsRemaining(quote, nowMs);
  if (remaining === 0) return "expired";
  return remaining <= quoteExpiringThresholdSeconds ? "expiring" : "fresh";
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
