import { createHash } from "node:crypto";

// Deterministic synthetic exchange-order source. A future exchange adapter
// replaces it behind `listFor(subject) -> Promise<ExchangeOrdersView>`;
// payloads are frozen and derived from the subject only, so reads stay
// reproducible. Every record is a test-mode order observation mirroring the
// provider-simulators quote adapter's market model
// (packages/provider-simulators/src/quotes.mjs): the pair set, asset scales,
// price scale, side semantics and fee bounds are the same, and the derived
// quote/fee/total amounts recompute exactly like a quote accepted at the
// order's price. An order never grants execution or settlement authority —
// execution stays "not_supported", posting stays "none" and nothing here is
// a ledger entry or moves money. No I/O.

// Pair set and reference mids mirror the simulator's SYNTHETIC_MID_PRICES;
// asset scales mirror its ASSET_SCALES; prices carry its PRICE_SCALE (8).
export const ORDER_PAIRS = Object.freeze([
  Object.freeze({ pair: "USDT/RUB", base: "USDT", quote: "RUB", baseScale: 6, quoteScale: 2, referenceMid: "90.00000000" }),
  Object.freeze({ pair: "TON/RUB", base: "TON", quote: "RUB", baseScale: 9, quoteScale: 2, referenceMid: "300.00000000" }),
  Object.freeze({ pair: "TON/USDT", base: "TON", quote: "USDT", baseScale: 9, quoteScale: 6, referenceMid: "3.20000000" })
]);
export const ORDER_SIDES = Object.freeze(["buy", "sell"]);
export const ORDER_TYPES = Object.freeze(["market", "limit"]);
// Every status is a non-executed state: the synthetic book never fills an
// order (execution stays "not_supported"), so a resting order stays open or
// ends cancelled, expired or rejected — "filled"/"partially_filled" would
// imply a ledger effect that posting "none" forbids.
export const ORDER_STATUSES = Object.freeze(["open", "cancelled", "expired", "rejected"]);
const PRICE_SCALE = 8;
const MAX_BPS = 1000;

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-exchange-orders-v1";
const VIEW_KEYS = Object.freeze(["mode", "orders"]);
const ORDER_KEYS = Object.freeze([
  "order_id",
  "pair",
  "base_asset",
  "quote_asset",
  "side",
  "order_type",
  "base_amount",
  "price",
  "quote_amount",
  "fee_bps",
  "fee_amount",
  "total_quote_amount",
  "status",
  "created_at",
  "updated_at",
  "execution",
  "posting"
]);
const ORDER_ID_PATTERN = /^ord_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;

/**
 * @typedef {object} ExchangeOrderView
 * @property {string} order_id
 * @property {string} pair
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {string} side
 * @property {string} order_type
 * @property {string} base_amount
 * @property {string} price
 * @property {string} quote_amount
 * @property {number} fee_bps
 * @property {string} fee_amount
 * @property {string} total_quote_amount
 * @property {string} status
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} execution
 * @property {string} posting
 */

/**
 * @typedef {object} ExchangeOrdersView
 * @property {string} mode
 * @property {readonly ExchangeOrderView[]} orders
 */

/**
 * @typedef {object} ExchangeOrderDirectory
 * @property {(subject: string) => Promise<ExchangeOrdersView>} listFor
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
 * Simulator-faithful derived amounts for an order priced at `price`: the
 * quote-leg units, the (always customer-unfriendly rounded) fee and the
 * payable or receivable total — identical to the quote adapter's arithmetic
 * once the rate is fixed.
 *
 * @param {{ baseScale: number, quoteScale: number }} pairDef
 * @param {string} side
 * @param {bigint} baseAmount
 * @param {bigint} price
 * @param {number} feeBps
 */
function computeAmounts(pairDef, side, baseAmount, price, feeBps) {
  const buy = side === "buy";
  const quoteUnits = divideRounded(
    baseAmount * price * 10n ** BigInt(pairDef.quoteScale),
    10n ** BigInt(pairDef.baseScale + PRICE_SCALE),
    buy ? "up" : "down"
  );
  const fee = divideRounded(quoteUnits * BigInt(feeBps), 10_000n, "up");
  const total = buy ? quoteUnits + fee : quoteUnits - fee;
  return { quoteUnits, fee, total };
}

/**
 * @param {string} subject
 * @param {number} index
 * @returns {ExchangeOrderView}
 */
function buildOrder(subject, index) {
  const pairDef = ORDER_PAIRS[Number(units(subject, `pair:${index}`, BigInt(ORDER_PAIRS.length)))];
  const side = ORDER_SIDES[Number(units(subject, `side:${index}`, BigInt(ORDER_SIDES.length)))];
  const orderType = ORDER_TYPES[Number(units(subject, `type:${index}`, BigInt(ORDER_TYPES.length)))];
  const status = ORDER_STATUSES[Number(units(subject, `status:${index}`, BigInt(ORDER_STATUSES.length)))];
  const feeBps = 15 + Number(units(subject, `fee:${index}`, 31n));
  // The order's price is the synthetic reference mid jittered ±75 bps like
  // the simulator's quote mids: for a market order it is the fixed
  // execution estimate, for a limit order the customer's limit.
  const offsetBps = Number(units(subject, `offset:${index}`, 151n)) - 75;
  const direction = (orderType === "market") === (side === "buy") ? 1 : -1;
  const reference = parseUnits(pairDef.referenceMid);
  const price = divideRounded(
    reference * BigInt(10_000 + direction * offsetBps),
    10_000n,
    "half_even"
  );
  const whole = 10n + units(subject, `base:${index}`, 9_990n);
  const fraction = units(subject, `fraction:${index}`, 10n ** BigInt(pairDef.baseScale));
  const baseAmount = whole * 10n ** BigInt(pairDef.baseScale) + fraction;
  const { quoteUnits, fee, total } = computeAmounts(pairDef, side, baseAmount, price, feeBps);
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  // A resting open order has never changed; a terminal order carries its
  // transition timestamp (within a day of creation like the other reads).
  const updatedMs =
    status === "open"
      ? createdMs
      : createdMs + (10 + Number(units(subject, `updated:${index}`, 281n))) * 1_000;
  return Object.freeze({
    order_id: `ord_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    pair: pairDef.pair,
    base_asset: pairDef.base,
    quote_asset: pairDef.quote,
    side,
    order_type: orderType,
    base_amount: decimal(baseAmount, pairDef.baseScale),
    price: decimal(price, PRICE_SCALE),
    quote_amount: decimal(quoteUnits, pairDef.quoteScale),
    fee_bps: feeBps,
    fee_amount: decimal(fee, pairDef.quoteScale),
    total_quote_amount: decimal(total, pairDef.quoteScale),
    status,
    created_at: new Date(createdMs).toISOString(),
    updated_at: new Date(updatedMs).toISOString(),
    execution: "not_supported",
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {ExchangeOrdersView}
 */
function buildOrdersView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const orders = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildOrder(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", orders });
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

/** @param {unknown} order */
function validOrder(order) {
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    return false;
  }
  const candidate = /** @type {ExchangeOrderView} */ (order);
  if (JSON.stringify(Object.keys(order).sort()) !== JSON.stringify([...ORDER_KEYS].sort())) {
    return false;
  }
  const pairDef = ORDER_PAIRS.find((entry) => entry.pair === candidate.pair);
  if (
    pairDef === undefined ||
    candidate.base_asset !== pairDef.base ||
    candidate.quote_asset !== pairDef.quote
  ) {
    return false;
  }
  if (
    !ORDER_SIDES.includes(candidate.side) ||
    !ORDER_TYPES.includes(candidate.order_type) ||
    !ORDER_STATUSES.includes(candidate.status) ||
    candidate.execution !== "not_supported" ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  if (
    !Number.isSafeInteger(candidate.fee_bps) ||
    candidate.fee_bps < 0 ||
    candidate.fee_bps > MAX_BPS
  ) {
    return false;
  }
  if (
    !ORDER_ID_PATTERN.test(candidate.order_id) ||
    !isScaledDecimal(candidate.base_amount, pairDef.baseScale) ||
    !isScaledDecimal(candidate.price, PRICE_SCALE) ||
    !isScaledDecimal(candidate.quote_amount, pairDef.quoteScale) ||
    !isScaledDecimal(candidate.fee_amount, pairDef.quoteScale) ||
    !isScaledDecimal(candidate.total_quote_amount, pairDef.quoteScale)
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.created_at) || !isIsoTimestamp(candidate.updated_at)) {
    return false;
  }
  const created = Date.parse(candidate.created_at);
  const updated = Date.parse(candidate.updated_at);
  // Lifecycle coherence mirrors the synthetic build: a resting open order
  // has never changed and a terminal order updates at or after creation.
  if (updated < created || (candidate.status === "open" && updated !== created)) {
    return false;
  }
  // Fail closed unless every derived amount recomputes exactly like the
  // simulator's quote arithmetic at the order's fixed price.
  const recomputed = computeAmounts(
    pairDef,
    candidate.side,
    parseUnits(candidate.base_amount),
    parseUnits(candidate.price),
    candidate.fee_bps
  );
  return (
    decimal(recomputed.quoteUnits, pairDef.quoteScale) === candidate.quote_amount &&
    decimal(recomputed.fee, pairDef.quoteScale) === candidate.fee_amount &&
    decimal(recomputed.total, pairDef.quoteScale) === candidate.total_quote_amount &&
    recomputed.quoteUnits > 0n &&
    recomputed.total > 0n
  );
}

/** @param {unknown} view */
export function validExchangeOrdersView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {ExchangeOrdersView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.orders)) {
    return false;
  }
  return candidate.orders.every(validOrder);
}

/** @returns {ExchangeOrderDirectory} */
export function createSyntheticExchangeOrderDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildOrdersView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
