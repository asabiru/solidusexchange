import { createHash } from "node:crypto";
import { type AssetCode, assets, isAssetCode } from "../shared/assets.js";
import type { KycStatus, QuotePair, QuotePreview, QuoteRounding, QuoteSide, QuotesView, QuoteView } from "../shared/api.js";
import { divideRounded, fromUnits, toUnits, DecimalError } from "../shared/decimal.js";

export const priceScale = 8;
export const spreadBps = 50;
export const feeBps = 30;

const priceUnit = 10n ** BigInt(priceScale);
const bpsUnit = 10_000n;

export const midPricesRub: Readonly<Record<AssetCode, bigint>> = Object.freeze({
  RUB: priceUnit,
  USDT: 9_240_000_000n,
  TON: 28_510_000_000n
});

export type QuoteErrorCode = "invalid_pair" | "invalid_amount" | "amount_too_small" | "quote_unavailable";
export type QuoteUnavailableReason = "provider_outage" | "stale_price" | "invalid_quote";

export class QuoteError extends Error {
  constructor(readonly code: QuoteErrorCode, readonly reason?: QuoteUnavailableReason) {
    super(code);
    this.name = "QuoteError";
  }
}

export interface QuoteInput {
  from: string;
  to: string;
  amount: string;
}

export interface QuoteContext {
  nowMs: number;
  ttlSeconds: number;
  available?: string;
  kycRequired: boolean;
}

function bidRub(asset: AssetCode): bigint {
  if (asset === "RUB") return priceUnit;
  return (midPricesRub[asset] * (bpsUnit - BigInt(spreadBps))) / bpsUnit;
}

function askRub(asset: AssetCode): bigint {
  if (asset === "RUB") return priceUnit;
  return divideRounded(midPricesRub[asset] * (bpsUnit + BigInt(spreadBps)), bpsUnit, "up");
}

export function valueInRub(asset: AssetCode, amount: string): string {
  const scale = assets[asset].scale;
  const units = toUnits(amount, scale);
  const rubUnits = divideRounded(
    units * midPricesRub[asset],
    10n ** BigInt(scale + priceScale - assets.RUB.scale),
    "half-up"
  );
  return fromUnits(rubUnits, assets.RUB.scale);
}

export function simulateQuote(input: QuoteInput, context: QuoteContext): QuotePreview {
  if (!isAssetCode(input.from) || !isAssetCode(input.to) || input.from === input.to) {
    throw new QuoteError("invalid_pair");
  }
  const from = input.from;
  const to = input.to;
  const fromScale = assets[from].scale;
  const toScale = assets[to].scale;
  let amountUnits: bigint;
  try {
    amountUnits = toUnits(input.amount, fromScale);
  } catch (error) {
    if (error instanceof DecimalError) throw new QuoteError("invalid_amount");
    throw error;
  }
  if (amountUnits <= 0n) throw new QuoteError("invalid_amount");

  const feeUnits = divideRounded(amountUnits * BigInt(feeBps), bpsUnit, "up");
  const netUnits = amountUnits - feeUnits;
  const bid = bidRub(from);
  const ask = askRub(to);
  const outUnits = netUnits <= 0n
    ? 0n
    : divideRounded(
      netUnits * bid * 10n ** BigInt(toScale),
      ask * 10n ** BigInt(fromScale),
      "down"
    );
  if (outUnits <= 0n) throw new QuoteError("amount_too_small");

  const rate = from === "RUB"
    ? { base: to, quote: from, value: fromUnits(ask, priceScale) }
    : to === "RUB"
      ? { base: from, quote: to, value: fromUnits(bid, priceScale) }
      : { base: from, quote: to, value: fromUnits(divideRounded(bid * priceUnit, ask, "down"), priceScale) };

  const amountIn = fromUnits(amountUnits, fromScale);
  const issuedAt = context.nowMs;
  const id = `Q-${createHash("sha256")
    .update(`${from}|${to}|${amountIn}|${issuedAt}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase()}`;
  const insufficientBalance = context.available === undefined
    ? false
    : amountUnits > toUnits(context.available, fromScale);

  return Object.freeze({
    id,
    from,
    to,
    amountIn,
    fee: fromUnits(feeUnits, fromScale),
    feeAsset: from,
    feeBps,
    spreadBps,
    netIn: fromUnits(netUnits, fromScale),
    amountOut: fromUnits(outUnits, toScale),
    total: amountIn,
    rate: Object.freeze(rate),
    issuedAt,
    expiresAt: issuedAt + context.ttlSeconds * 1_000,
    ttlSeconds: context.ttlSeconds,
    serverTime: context.nowMs,
    insufficientBalance,
    kycRequired: context.kycRequired,
    executable: false,
    executionUnavailableReason: "dev_test_version"
  });
}

export const quoteIdPattern = /^qte_[0-9a-f]{24}$/;
export const quotePriceScale = 8;
export const quoteMaxBps = 1_000;
export const quoteMaxTtlSeconds = 300;
export const quoteSides: readonly QuoteSide[] = Object.freeze(["buy", "sell"]);

export function isQuoteSide(value: unknown): value is QuoteSide {
  return value === "buy" || value === "sell";
}

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

export function quoteRoundingFor(side: QuoteSide): QuoteRounding {
  return side === "buy" ? "up" : "down";
}

/**
 * Simulator-faithful derived amounts — the side-adjusted price, the quote-leg
 * units, the (always customer-unfriendly rounded) fee and the payable or
 * receivable total — mirroring the upstream contract validator's computeAmounts
 * so a strict parse fails closed on amounts that do not recompute exactly.
 */
export function contractQuoteAmounts(
  pairDef: ContractQuotePair,
  side: QuoteSide,
  baseAmountUnits: bigint,
  midUnits: bigint,
  spreadBps: number,
  feeBps: number
): { price: bigint; quoteUnits: bigint; fee: bigint; total: bigint } {
  const buy = side === "buy";
  const price = buy
    ? divideRounded(midUnits * BigInt(20_000 + spreadBps), 20_000n, "up")
    : divideRounded(midUnits * BigInt(20_000 - spreadBps), 20_000n, "down");
  const quoteUnits = divideRounded(
    baseAmountUnits * price * 10n ** BigInt(pairDef.quoteScale),
    10n ** BigInt(pairDef.baseScale + quotePriceScale),
    buy ? "up" : "down"
  );
  const fee = divideRounded(quoteUnits * BigInt(feeBps), 10_000n, "up");
  const total = buy ? quoteUnits + fee : quoteUnits - fee;
  return { price, quoteUnits, fee, total };
}

/** The customer-api quotes contract entry shape (snake_case field names). */
export interface ContractQuote {
  quote_id: string;
  pair: QuotePair;
  base_asset: AssetCode;
  quote_asset: AssetCode;
  side: QuoteSide;
  base_amount: string;
  mid_price: string;
  price: string;
  spread_bps: number;
  fee_bps: number;
  quote_amount: string;
  fee_amount: string;
  total_quote_amount: string;
  rounding: QuoteRounding;
  price_observed_at: string;
  issued_at: string;
  expires_at: string;
  ttl_seconds: number;
  status: "indicative";
  execution: "not_supported";
  posting: "none";
}

/**
 * Adapts validated customer-api quote entries into the app's quotes view:
 * quote_id becomes id, base_asset/quote_asset become base/quote, the snake_case
 * amount and bps fields go camelCase and the ISO timestamps parse to
 * milliseconds. The app keeps its own kyc flag — the contract view has no
 * session-state counterpart.
 */
export function contractQuotesView(quotes: readonly ContractQuote[], kyc: KycStatus): QuotesView {
  return {
    mode: "test",
    kyc,
    quotes: quotes.map((quote) => ({
      id: quote.quote_id,
      pair: quote.pair,
      base: quote.base_asset,
      quote: quote.quote_asset,
      side: quote.side,
      baseAmount: quote.base_amount,
      midPrice: quote.mid_price,
      price: quote.price,
      spreadBps: quote.spread_bps,
      feeBps: quote.fee_bps,
      quoteAmount: quote.quote_amount,
      feeAmount: quote.fee_amount,
      totalQuoteAmount: quote.total_quote_amount,
      rounding: quote.rounding,
      priceObservedAt: Date.parse(quote.price_observed_at),
      issuedAt: Date.parse(quote.issued_at),
      expiresAt: Date.parse(quote.expires_at),
      ttlSeconds: quote.ttl_seconds,
      status: quote.status,
      execution: quote.execution,
      posting: quote.posting
    }))
  };
}

const syntheticQuotes: readonly QuoteView[] = Object.freeze([
  Object.freeze({
    id: "qte_a1b2c3d4e5f6a7b8c9d0e1f2",
    pair: "USDT/RUB",
    base: "USDT",
    quote: "RUB",
    side: "sell",
    baseAmount: "25.000000",
    midPrice: "90.00000000",
    price: "89.77500000",
    spreadBps: 50,
    feeBps: 30,
    quoteAmount: "2244.37",
    feeAmount: "6.74",
    totalQuoteAmount: "2237.63",
    rounding: "down",
    priceObservedAt: Date.parse("2026-10-02T14:04:57.000Z"),
    issuedAt: Date.parse("2026-10-02T14:05:00.000Z"),
    expiresAt: Date.parse("2026-10-02T14:05:30.000Z"),
    ttlSeconds: 30,
    status: "indicative",
    execution: "not_supported",
    posting: "none"
  }),
  Object.freeze({
    id: "qte_f1e2d3c4b5a6f7e8d9c0b1a2",
    pair: "TON/USDT",
    base: "TON",
    quote: "USDT",
    side: "buy",
    baseAmount: "2.000000000",
    midPrice: "3.20000000",
    price: "3.21200000",
    spreadBps: 75,
    feeBps: 20,
    quoteAmount: "6.424000",
    feeAmount: "0.012848",
    totalQuoteAmount: "6.436848",
    rounding: "up",
    priceObservedAt: Date.parse("2026-10-07T10:39:55.000Z"),
    issuedAt: Date.parse("2026-10-07T10:40:00.000Z"),
    expiresAt: Date.parse("2026-10-07T10:40:45.000Z"),
    ttlSeconds: 45,
    status: "indicative",
    execution: "not_supported",
    posting: "none"
  })
]);

const quoteListViews: Readonly<Record<KycStatus, QuotesView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", quotes: syntheticQuotes }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", quotes: Object.freeze([]) })
});

/**
 * The local synthetic quotes list: a verified session sees the frozen
 * test-mode indicative-quote observations; a gated session sees the same shape
 * emptied in place (like the wallet's zeroed gated view). Observational only —
 * every entry stays execution "not_supported" and posting "none": nothing here
 * is a ledger entry or moves money.
 */
export function quotesView(kyc: KycStatus): QuotesView {
  return quoteListViews[kyc];
}
