import { createHash } from "node:crypto";

// Deterministic synthetic quote source. A future liquidity adapter replaces
// it behind `listFor(subject) -> Promise<QuotesView>`; payloads are frozen and
// derived from the subject only, so reads stay reproducible. Every record is
// a test-mode indicative quote mirroring the provider-simulators quote
// adapter (packages/provider-simulators/src/quotes.mjs): the pair set,
// synthetic mid references, spread/fee bps bounds, price scale, ttl bounds,
// status "indicative" and execution "not_supported" are the same, and the
// derived amounts recompute exactly. A quote never grants execution
// authority — posting stays "none" and nothing here is a ledger entry or
// moves money. No I/O.

// Pair set and reference mids mirror the simulator's SYNTHETIC_MID_PRICES;
// asset scales mirror its ASSET_SCALES; prices carry its PRICE_SCALE (8).
export const QUOTE_PAIRS = Object.freeze([
  Object.freeze({ pair: "USDT/RUB", base: "USDT", quote: "RUB", baseScale: 6, quoteScale: 2, referenceMid: "90.00000000" }),
  Object.freeze({ pair: "TON/RUB", base: "TON", quote: "RUB", baseScale: 9, quoteScale: 2, referenceMid: "300.00000000" }),
  Object.freeze({ pair: "TON/USDT", base: "TON", quote: "USDT", baseScale: 9, quoteScale: 6, referenceMid: "3.20000000" })
]);
export const QUOTE_SIDES = Object.freeze(["buy", "sell"]);
const PRICE_SCALE = 8;
const MAX_BPS = 1000;
const MAX_TTL_SECONDS = 300;

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-quotes-v1";
const VIEW_KEYS = Object.freeze(["mode", "quotes"]);
const QUOTE_KEYS = Object.freeze([
  "quote_id",
  "pair",
  "base_asset",
  "quote_asset",
  "side",
  "base_amount",
  "mid_price",
  "price",
  "spread_bps",
  "fee_bps",
  "quote_amount",
  "fee_amount",
  "total_quote_amount",
  "rounding",
  "price_observed_at",
  "issued_at",
  "expires_at",
  "ttl_seconds",
  "status",
  "execution",
  "posting"
]);
const QUOTE_ID_PATTERN = /^qte_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;

/**
 * @typedef {object} QuoteView
 * @property {string} quote_id
 * @property {string} pair
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {string} side
 * @property {string} base_amount
 * @property {string} mid_price
 * @property {string} price
 * @property {number} spread_bps
 * @property {number} fee_bps
 * @property {string} quote_amount
 * @property {string} fee_amount
 * @property {string} total_quote_amount
 * @property {string} rounding
 * @property {string} price_observed_at
 * @property {string} issued_at
 * @property {string} expires_at
 * @property {number} ttl_seconds
 * @property {string} status
 * @property {string} execution
 * @property {string} posting
 */

/**
 * @typedef {object} QuotesView
 * @property {string} mode
 * @property {readonly QuoteView[]} quotes
 */

/**
 * @typedef {object} QuoteDirectory
 * @property {(subject: string) => Promise<QuotesView>} listFor
 */

/**
 * @param {string} subject
 * @param {string} salt
 */
function digest(subject, salt) {
  return createHash("sha256").update(`${SIGNATURE_DOMAIN}\n${subject}\n${salt}`).digest();
}

/**
 * @param {string} subject
 * @param {string} salt
 * @param {bigint} bound
 */
function units(subject, salt, bound) {
  return digest(subject, salt).readBigUInt64BE(0) % bound;
}

/**
 * @param {bigint} value
 * @param {number} scale
 */
function decimal(value, scale) {
  const text = String(value).padStart(scale + 1, "0");
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

/**
 * Non-negative integer division with an explicit rounding mode, mirroring
 * the simulator's divideRounded so derived amounts recompute identically.
 *
 * @param {bigint} numerator
 * @param {bigint} denominator
 * @param {"down" | "up" | "half_even"} mode
 */
function divideRounded(numerator, denominator, mode) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "down") {
    return quotient;
  }
  if (mode === "up") {
    return quotient + 1n;
  }
  const twice = remainder * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) {
    return quotient + 1n;
  }
  return quotient;
}

/** @param {string} text */
function parseUnits(text) {
  return BigInt(text.replace(".", ""));
}

/**
 * Simulator-faithful derived amounts: the side-adjusted price, the quote-leg
 * units, the (always customer-unfriendly rounded) fee and the payable or
 * receivable total.
 *
 * @param {{ baseScale: number, quoteScale: number }} pairDef
 * @param {string} side
 * @param {bigint} baseAmount
 * @param {bigint} mid
 * @param {number} spreadBps
 * @param {number} feeBps
 */
function computeAmounts(pairDef, side, baseAmount, mid, spreadBps, feeBps) {
  const buy = side === "buy";
  const price = buy
    ? divideRounded(mid * BigInt(20_000 + spreadBps), 20_000n, "up")
    : divideRounded(mid * BigInt(20_000 - spreadBps), 20_000n, "down");
  const quoteUnits = divideRounded(
    baseAmount * price * 10n ** BigInt(pairDef.quoteScale),
    10n ** BigInt(pairDef.baseScale + PRICE_SCALE),
    buy ? "up" : "down"
  );
  const fee = divideRounded(quoteUnits * BigInt(feeBps), 10_000n, "up");
  const total = buy ? quoteUnits + fee : quoteUnits - fee;
  return { price, quoteUnits, fee, total };
}

/**
 * @param {string} subject
 * @param {number} index
 * @returns {QuoteView}
 */
function buildQuote(subject, index) {
  const pairDef = QUOTE_PAIRS[Number(units(subject, `pair:${index}`, BigInt(QUOTE_PAIRS.length)))];
  const side = QUOTE_SIDES[Number(units(subject, `side:${index}`, BigInt(QUOTE_SIDES.length)))];
  const spreadBps = 25 + Number(units(subject, `spread:${index}`, 51n));
  const feeBps = 15 + Number(units(subject, `fee:${index}`, 31n));
  const ttlSeconds = 15 + Number(units(subject, `ttl:${index}`, 106n));
  // The mid is the synthetic reference jittered ±25 bps like the simulator.
  const jitterBps = Number(units(subject, `jitter:${index}`, 51n)) - 25;
  const reference = parseUnits(pairDef.referenceMid);
  const mid = divideRounded(reference * BigInt(10_000 + jitterBps), 10_000n, "half_even");
  const whole = 10n + units(subject, `base:${index}`, 9_990n);
  const fraction = units(subject, `fraction:${index}`, 10n ** BigInt(pairDef.baseScale));
  const baseAmount = whole * 10n ** BigInt(pairDef.baseScale) + fraction;
  const { price, quoteUnits, fee, total } = computeAmounts(pairDef, side, baseAmount, mid, spreadBps, feeBps);
  const issuedMs = BASE_MS + index * STEP_MS + Number(units(subject, `issued:${index}`, BigInt(STEP_MS)));
  const observedMs = issuedMs - (2 + Number(units(subject, `observed:${index}`, 29n))) * 1_000;
  const expiresMs = issuedMs + ttlSeconds * 1_000;
  return Object.freeze({
    quote_id: `qte_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    pair: pairDef.pair,
    base_asset: pairDef.base,
    quote_asset: pairDef.quote,
    side,
    base_amount: decimal(baseAmount, pairDef.baseScale),
    mid_price: decimal(mid, PRICE_SCALE),
    price: decimal(price, PRICE_SCALE),
    spread_bps: spreadBps,
    fee_bps: feeBps,
    quote_amount: decimal(quoteUnits, pairDef.quoteScale),
    fee_amount: decimal(fee, pairDef.quoteScale),
    total_quote_amount: decimal(total, pairDef.quoteScale),
    rounding: side === "buy" ? "up" : "down",
    price_observed_at: new Date(observedMs).toISOString(),
    issued_at: new Date(issuedMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
    ttl_seconds: ttlSeconds,
    status: "indicative",
    execution: "not_supported",
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {QuotesView}
 */
function buildQuotesView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const quotes = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildQuote(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", quotes });
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/**
 * Canonical non-negative decimal string with exactly `scale` fraction digits.
 *
 * @param {unknown} value
 * @param {number} scale
 */
function isScaledDecimal(value, scale) {
  return (
    typeof value === "string" &&
    new RegExp(`^(0|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u").test(value)
  );
}

/** @param {unknown} quote */
function validQuote(quote) {
  if (quote === null || typeof quote !== "object" || Array.isArray(quote)) {
    return false;
  }
  const candidate = /** @type {QuoteView} */ (quote);
  if (JSON.stringify(Object.keys(quote).sort()) !== JSON.stringify([...QUOTE_KEYS].sort())) {
    return false;
  }
  const pairDef = QUOTE_PAIRS.find((entry) => entry.pair === candidate.pair);
  if (
    pairDef === undefined ||
    candidate.base_asset !== pairDef.base ||
    candidate.quote_asset !== pairDef.quote
  ) {
    return false;
  }
  const buy = candidate.side === "buy";
  if (!QUOTE_SIDES.includes(candidate.side)) {
    return false;
  }
  if (
    candidate.rounding !== (buy ? "up" : "down") ||
    candidate.status !== "indicative" ||
    candidate.execution !== "not_supported" ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  if (
    !Number.isSafeInteger(candidate.spread_bps) ||
    !Number.isSafeInteger(candidate.fee_bps) ||
    candidate.spread_bps < 0 ||
    candidate.spread_bps > MAX_BPS ||
    candidate.fee_bps < 0 ||
    candidate.fee_bps > MAX_BPS ||
    !Number.isSafeInteger(candidate.ttl_seconds) ||
    candidate.ttl_seconds < 1 ||
    candidate.ttl_seconds > MAX_TTL_SECONDS
  ) {
    return false;
  }
  if (
    !QUOTE_ID_PATTERN.test(candidate.quote_id) ||
    !isScaledDecimal(candidate.base_amount, pairDef.baseScale) ||
    !isScaledDecimal(candidate.mid_price, PRICE_SCALE) ||
    !isScaledDecimal(candidate.price, PRICE_SCALE) ||
    !isScaledDecimal(candidate.quote_amount, pairDef.quoteScale) ||
    !isScaledDecimal(candidate.fee_amount, pairDef.quoteScale) ||
    !isScaledDecimal(candidate.total_quote_amount, pairDef.quoteScale)
  ) {
    return false;
  }
  if (
    !isIsoTimestamp(candidate.price_observed_at) ||
    !isIsoTimestamp(candidate.issued_at) ||
    !isIsoTimestamp(candidate.expires_at)
  ) {
    return false;
  }
  const issued = Date.parse(candidate.issued_at);
  const expires = Date.parse(candidate.expires_at);
  const observed = Date.parse(candidate.price_observed_at);
  if (expires - issued !== candidate.ttl_seconds * 1_000 || observed > issued) {
    return false;
  }
  // Fail closed unless every derived amount recomputes exactly like the
  // simulator's signed quote validation requires.
  const recomputed = computeAmounts(
    pairDef,
    candidate.side,
    parseUnits(candidate.base_amount),
    parseUnits(candidate.mid_price),
    candidate.spread_bps,
    candidate.fee_bps
  );
  return (
    decimal(recomputed.price, PRICE_SCALE) === candidate.price &&
    decimal(recomputed.quoteUnits, pairDef.quoteScale) === candidate.quote_amount &&
    decimal(recomputed.fee, pairDef.quoteScale) === candidate.fee_amount &&
    decimal(recomputed.total, pairDef.quoteScale) === candidate.total_quote_amount &&
    recomputed.quoteUnits > 0n &&
    recomputed.total > 0n
  );
}

/** @param {unknown} view */
export function validQuotesView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {QuotesView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.quotes)) {
    return false;
  }
  return candidate.quotes.every(validQuote);
}

/** @returns {QuoteDirectory} */
export function createSyntheticQuoteDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildQuotesView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
