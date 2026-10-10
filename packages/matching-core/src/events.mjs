/**
 * Matching engine event vocabulary. Events are plain frozen data records —
 * they describe what the book did, they never perform it: no ledger entry,
 * no balance change, no settlement instruction (`posting: "none"` on every
 * event, mirroring the customer exchange-orders read contract).
 */

export const EVENT_TYPES = Object.freeze([
  "accepted",
  "resting",
  "partially_filled",
  "filled",
  "cancelled",
  "rejected",
]);

export const REJECT_REASONS = Object.freeze([
  "invalid_order",
  "invalid_order_id",
  "invalid_instrument",
  "unknown_instrument",
  "invalid_side",
  "invalid_owner",
  "invalid_price",
  "non_positive_price",
  "invalid_quantity",
  "non_positive_quantity",
  "duplicate_order_id",
  "self_trade",
  "order_not_resting",
]);

/**
 * Self-trade policy is pinned to "reject": when the resting order at the
 * head of the best opposite price level belongs to the same owner as the
 * incoming order, the incoming order's remainder is rejected (`self_trade`)
 * instead of matching its own order or skipping levels.
 */
export const SELF_TRADE_POLICY = "reject";

/** Fill events carry no posting semantics: they are data, never ledger entries. */
export const POSTING = "none";

export const ORDER_ID_PATTERN = /^ord_[0-9a-f]{24}$/u;
export const FILL_ID_PATTERN = /^fll_[0-9a-f]{24}$/u;
export const SIDES = Object.freeze(["buy", "sell"]);

const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const ORDER_KEYS = Object.freeze(["instrument", "order_id", "owner", "price", "quantity", "side"]);

/**
 * @typedef {object} OrderInput
 * @property {string} order_id `ord_` + 24 lowercase hex.
 * @property {string} instrument Canonical pair, e.g. "USDT/RUB".
 * @property {"buy" | "sell"} side
 * @property {string} price Canonical decimal string, at most instrument price scale.
 * @property {string} quantity Canonical decimal string, at most instrument base scale.
 * @property {string} [owner] Optional owner tag used by the self-trade policy.
 */

/**
 * @typedef {object} MatchingEvent
 * @property {number} seq Engine-scoped strictly increasing sequence.
 * @property {string} at Canonical UTC timestamp from the injected clock.
 * @property {string} type One of EVENT_TYPES.
 * @property {string | null} order_id The order the event concerns.
 * @property {string | null} instrument
 * @property {string | null} side
 * @property {"none"} posting Always "none": events never post to a ledger.
 */

/**
 * @param {unknown} value
 * @returns {value is "buy" | "sell"}
 */
export function isSide(value) {
  return value === "buy" || value === "sell";
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isOrderId(value) {
  return typeof value === "string" && ORDER_ID_PATTERN.test(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isOwner(value) {
  return typeof value === "string" && OWNER_PATTERN.test(value);
}
