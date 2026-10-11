import { createHash } from "node:crypto";
import { createSimulatedClock } from "../../matching-core/src/deterministic.mjs";
import { createMatchingEngine } from "../../matching-core/src/engine.mjs";
import { INSTRUMENTS } from "../../matching-core/src/instruments.mjs";

// Deterministic synthetic exchange-order source. A future exchange adapter
// replaces it behind `listFor(subject) -> Promise<ExchangeOrdersView>`;
// payloads are frozen and derived from the subject only, so reads stay
// reproducible. Each view is a projection of a REAL matching engine:
// `exchangeOrderScenario(subject)` derives a deterministic market scenario
// (the subject's own submissions plus deterministic counterparty liquidity
// — the sweeps that rest, partially fill, exhaust or leave gaps), a fresh
// `createMatchingEngine` replays it inside the call, and
// `projectExchangeOrders` folds the journal and tracked-order state into
// the contract rows — no row is hand-written fixture data — and
// `projectExchangeTrades` folds the same journal's fill pairs into the
// trades read's execution rows. The engine
// trades in the provider-simulators market model
// (packages/provider-simulators/src/quotes.mjs): the pair set, asset
// scales, price scale, side semantics and fee bounds are the same, and the
// derived quote/fee/total amounts recompute exactly like a quote accepted
// at the order's price. An order never grants execution or settlement
// authority — execution stays "not_supported", posting stays "none" and
// nothing here is a ledger entry or moves money. No I/O.
//
// Status mapping — the contract advertises only non-executed observations:
//   engine "resting"   -> "open"      (base_amount is the remaining
//                                      quantity, so a partially filled
//                                      order shows its reduced remainder)
//   engine "cancelled" -> "cancelled" (or "expired" when the intent's
//                                      `expires` flag marks the scenario's
//                                      TTL sweep — the engine has no expiry
//                                      primitive, so expiry is expressed as
//                                      a deterministic cancel the
//                                      projection re-labels)
//   engine "rejected"  -> "rejected"  (base_amount is the rejected
//                                      remainder, or the placed quantity
//                                      when validation never tracked the
//                                      submission)
//   engine "filled"    -> excluded    (a fully executed order has no
//                                      outstanding remainder, and the
//                                      contract's four statuses never
//                                      describe one)
// `created_at`/`updated_at` come from the journal: the `accepted` event —
// or the lone reject event for untracked submissions — and the terminal
// event, second-precision stamps widened to contract milliseconds, so an
// open order always carries updated_at == created_at. A market order's
// `price` is the volume-weighted average of its own fill events, falling
// back to the scenario's reference estimate when it never executed.
//
// Dependency wiring: matching-core is reached through a repo-relative
// `../` import, not a `file:` dependency. `file:` links install as
// symlinks and Node realpaths this module back to packages/customer-api,
// where the symlinked consumers (miniapp, backoffice, e2e-dev — their CI
// never runs `npm ci` inside this package) cannot resolve a bare
// `@solidchange/matching-core` specifier. The relative path resolves in
// every checkout and is allowlisted in scripts/check-boundary.mjs. The
// leaf modules are imported rather than the package barrel: index.mjs
// type-references the PostgreSQL journal store, which would drag the pg
// driver into this package's module graph and typecheck.
//
// Determinism / cross-directory-audit invariants: the scenario is a pure
// function of the subject, and the engine instance is request-scoped —
// created inside `listFor`, projected, dropped. No per-subject engine,
// memo or cache is ever retained (the audit pins exactly that).

// Pair set and reference mids mirror the simulator's SYNTHETIC_MID_PRICES;
// asset scales mirror its ASSET_SCALES; prices carry its PRICE_SCALE (8).
export const ORDER_PAIRS = Object.freeze([
  Object.freeze({ pair: "USDT/RUB", base: "USDT", quote: "RUB", baseScale: 6, quoteScale: 2, referenceMid: "90.00000000" }),
  Object.freeze({ pair: "TON/RUB", base: "TON", quote: "RUB", baseScale: 9, quoteScale: 2, referenceMid: "300.00000000" }),
  Object.freeze({ pair: "TON/USDT", base: "TON", quote: "USDT", baseScale: 9, quoteScale: 6, referenceMid: "3.20000000" })
]);
export const ORDER_SIDES = Object.freeze(["buy", "sell"]);
export const ORDER_TYPES = Object.freeze(["market", "limit"]);
// Every status is a non-executed observation: a resting engine order is
// "open" (a partially filled one still rests, so it stays "open" with the
// reduced remainder), and a removed or refused one ends "cancelled",
// "expired" or "rejected". The engine's "filled"/"partially_filled" states
// never appear — a fully executed order is excluded rather than shown,
// since the contract's statuses never describe executed volume.
export const ORDER_STATUSES = Object.freeze(["open", "cancelled", "expired", "rejected"]);
// The member read serves the same lifecycle vocabulary plus "filled": the
// templated detail read shows terminal state (the getCustomerOperation
// precedent), so a fully executed order answers its executed record —
// only the collection view excludes it.
export const ORDER_DETAIL_STATUSES = Object.freeze(["open", "filled", "cancelled", "expired", "rejected"]);
// A trade's liquidity leg is read straight off the fill pair it came from:
// the subject leg is "maker" when its order rested on the book and "taker"
// when it swept.
export const TRADE_LIQUIDITIES = Object.freeze(["maker", "taker"]);
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
const TRADE_ID_PATTERN = /^trd_[0-9a-f]{24}$/u;
const DETAIL_KEYS = Object.freeze([
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
  "fills",
  "execution",
  "posting"
]);
const FILL_KEYS = Object.freeze(["fill_id", "liquidity", "price", "quantity", "executed_at"]);
const MARKETS_VIEW_KEYS = Object.freeze(["mode", "markets"]);
const MARKET_KEYS = Object.freeze([
  "instrument",
  "base_asset",
  "quote_asset",
  "best_bid",
  "best_ask",
  "last_trade",
  "spread_bps",
  "base_scale",
  "quote_scale",
  "price_scale",
  "as_of",
  "posting"
]);
const MARKET_LEVEL_KEYS = Object.freeze(["price", "quantity", "order_count"]);
const MARKET_LAST_TRADE_KEYS = Object.freeze(["price", "quantity", "executed_at"]);
const MARKET_DEPTH_VIEW_KEYS = Object.freeze([
  "mode",
  "instrument",
  "base_asset",
  "quote_asset",
  "bids",
  "asks",
  "last_trade",
  "depth_levels",
  "as_of",
  "posting"
]);
// The depth member read serves the full ladder the replay leaves resting,
// capped at 16 levels per side — the documented contract bound keeps a
// pathological book from growing the response without limit.
export const MAX_MARKET_DEPTH_LEVELS = 16;
const TRADES_VIEW_KEYS = Object.freeze(["mode", "trades"]);
const TRADE_KEYS = Object.freeze([
  "trade_id",
  "order_id",
  "pair",
  "base_asset",
  "quote_asset",
  "side",
  "liquidity",
  "price",
  "quantity",
  "quote_amount",
  "fee_bps",
  "fee_amount",
  "total_quote_amount",
  "executed_at",
  "execution",
  "posting"
]);
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_SECONDS = Math.trunc(Date.parse("2026-09-01T00:00:00.000Z") / 1_000);
const STEP_SECONDS = 86_400;

// Visible lifecycle roles — each act drives the subject's order through a
// different engine path: rest untouched, rest then get swept partially,
// customer cancel, TTL sweep (projected "expired"), a submission the
// engine's own validation refuses, a market order that exhausts the book,
// and a resting order crossed by the subject's own follow-up.
const SCENARIO_ROLES = Object.freeze([
  "rest",
  "partial",
  "cancel",
  "expire",
  "reject_shape",
  "market_gap",
  "self_trade"
]);
// Roles whose order can never end "filled": the guaranteed tail act keeps
// every subject's view non-empty even when earlier orders were consumed.
const GUARANTEED_ROW_ROLES = Object.freeze(["reject_shape", "cancel", "expire"]);
/** @type {Readonly<Record<"buy" | "sell", "buy" | "sell">>} */
const OPPOSITE_SIDE = Object.freeze({ buy: "sell", sell: "buy" });

// The scenario replays against the engine's own instrument registry, so
// every declared pair must exist there with the same assets, scales and
// price scale — drift in either table fails fast instead of mis-pricing
// submissions or views.
for (const pairDef of ORDER_PAIRS) {
  const definition = INSTRUMENTS.find((entry) => entry.instrument === pairDef.pair);
  if (
    definition === undefined ||
    definition.base_asset !== pairDef.base ||
    definition.quote_asset !== pairDef.quote ||
    definition.base_scale !== pairDef.baseScale ||
    definition.quote_scale !== pairDef.quoteScale ||
    definition.price_scale !== PRICE_SCALE
  ) {
    throw new Error(`matching-core instrument registry drifted from ORDER_PAIRS: ${pairDef.pair}`);
  }
}

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
 * One executed leg of an order detail — the same fill pair the trades
 * projection folds into a TradeView, minus the redundant per-order
 * context. `fill_id` reuses the trades read's subject-scoped trd_* digest
 * recipe so a leg joins one-to-one to its TradeView row; `price`/`quantity`
 * are the maker price and executed size off the journal pair, and
 * `liquidity` is "maker" when this order rested and "taker" when it swept.
 *
 * @typedef {object} ExchangeOrderFillView
 * @property {string} fill_id
 * @property {string} liquidity
 * @property {string} price
 * @property {string} quantity
 * @property {string} executed_at
 */

/**
 * The templated member read's row: every list field plus `fills`, the
 * order's own executed legs in journal order. `status` extends the list
 * vocabulary with "filled" — the detail read serves terminal state (the
 * getCustomerOperation precedent), so a fully executed order answers its
 * executed record with `base_amount` the placed quantity and `updated_at`
 * its last fill's stamp. For every other status the shared fields carry
 * exactly the list row's semantics (an "open" detail still reports the
 * resting remainder while `fills` shows what already executed).
 *
 * @typedef {object} ExchangeOrderDetailView
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
 * @property {readonly ExchangeOrderFillView[]} fills
 * @property {string} execution
 * @property {string} posting
 */

/**
 * @typedef {object} ExchangeOrderDirectory
 * @property {(subject: string) => Promise<ExchangeOrdersView>} listFor
 * @property {(subject: string, orderId: string) => Promise<ExchangeOrderDetailView | null>} orderFor
 */

/**
 * @typedef {object} TradeView
 * @property {string} trade_id
 * @property {string} order_id
 * @property {string} pair
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {string} side
 * @property {string} liquidity
 * @property {string} price
 * @property {string} quantity
 * @property {string} quote_amount
 * @property {number} fee_bps
 * @property {string} fee_amount
 * @property {string} total_quote_amount
 * @property {string} executed_at
 * @property {string} execution
 * @property {string} posting
 */

/**
 * @typedef {object} TradesView
 * @property {string} mode
 * @property {readonly TradeView[]} trades
 */

/**
 * @typedef {object} TradeDirectory
 * @property {(subject: string) => Promise<TradesView>} listFor
 */

/**
 * One side of the book's top level as `bookSnapshot` reports it — the best
 * price first, the aggregate resting quantity and the number of orders
 * queued at the level. Both sides are null whenever the instrument's side
 * is empty (the contract's nested-object nullability mirrors the activity
 * feed's `money` precedent: the price/quantity members themselves never
 * go null — the whole level does).
 *
 * @typedef {object} MarketLevelView
 * @property {string} price
 * @property {string} quantity
 * @property {number} order_count
 */

/**
 * The latest fill the subject's book recorded on an instrument, or null
 * when the replay left no fills there. `price`/`quantity` are the fill's
 * own (the maker price the legs crossed at) and `executed_at` is the
 * journal stamp widened to contract milliseconds.
 *
 * @typedef {object} MarketLastTradeView
 * @property {string} price
 * @property {string} quantity
 * @property {string} executed_at
 */

/**
 * Instrument-scoped market data for the subject's synthetic book. The
 * depth is whatever the replay leaves resting — the subject's own open
 * orders plus counterparty remnants — so the view honestly mirrors that
 * book rather than advertising global market data. `spread_bps` is the
 * relative spread of the two top levels in integer basis points of the
 * mid, or null when either side is empty. `as_of` is the simulated
 * session close (the end of the scenario's clock), `posting` stays
 * "none" — nothing here is a ledger entry or moves money.
 *
 * @typedef {object} MarketView
 * @property {string} instrument
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {MarketLevelView | null} best_bid
 * @property {MarketLevelView | null} best_ask
 * @property {MarketLastTradeView | null} last_trade
 * @property {number | null} spread_bps
 * @property {number} base_scale
 * @property {number} quote_scale
 * @property {number} price_scale
 * @property {string} as_of
 * @property {string} posting
 */

/**
 * @typedef {object} MarketsView
 * @property {string} mode
 * @property {readonly MarketView[]} markets
 */

/**
 * The depth member read's row for one instrument — the same replay
 * projected into the full resting ladder rather than the top level: every
 * bid level the subject's book still holds, best (highest) price first,
 * every ask level best (lowest) price first, each capped at
 * MAX_MARKET_DEPTH_LEVELS so a deeper book truncates rather than growing
 * the response without bound. `depth_levels` is the deeper side's resting
 * level count before the cap — it exceeds the served level count exactly
 * when the book runs deeper than the bound, so a client can tell the
 * ladder was truncated. `last_trade` and `as_of` carry exactly the markets
 * read's semantics (the instrument's last fill, the simulated session
 * close), `posting` stays "none" — nothing here is a ledger entry or
 * moves money.
 *
 * @typedef {object} MarketDepthView
 * @property {string} mode
 * @property {string} instrument
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {readonly MarketLevelView[]} bids
 * @property {readonly MarketLevelView[]} asks
 * @property {MarketLastTradeView | null} last_trade
 * @property {number} depth_levels
 * @property {string} as_of
 * @property {string} posting
 */

/**
 * @typedef {object} MarketDirectory
 * @property {(subject: string) => Promise<MarketsView>} listFor
 * @property {(subject: string, instrument: string) => Promise<MarketDepthView | null>} depthFor
 */

/**
 * @typedef {object} ScenarioOrderIntent
 * @property {string} order_id
 * @property {string} pair
 * @property {"buy" | "sell"} side
 * @property {"limit" | "market"} order_type
 * @property {string} price Limit price for limit orders; the scenario's
 *   reference estimate shown for a market order that never executed.
 * @property {string} quantity Placed base quantity at the pair's scale.
 * @property {number} fee_bps
 * @property {boolean} expires True when the scenario's TTL sweep — not the
 *   customer — removes the order; projected as "expired" instead of
 *   "cancelled" (the engine has no expiry primitive).
 */

/**
 * @typedef {object} ScenarioStep
 * @property {"advance" | "submit" | "cancel"} op
 * @property {number} [seconds] `advance` only.
 * @property {unknown} [input] `submit` only — engine order input.
 * @property {string} [instrument] `cancel` only.
 * @property {string} [order_id] `cancel` only.
 */

/**
 * @typedef {object} ExchangeOrderScenario
 * @property {number} start_seconds Epoch the simulated clock starts at.
 * @property {readonly ScenarioStep[]} steps Replay steps in order.
 * @property {readonly ScenarioOrderIntent[]} intents Subject orders in
 *   submission order.
 */

/**
 * Per-order journal trail folded out of one replay — projection scratch
 * state that lives and dies inside a single call.
 *
 * @typedef {object} OrderTrail
 * @property {string | null} acceptedAt `accepted` event stamp, if any.
 * @property {string | null} terminalAt `cancelled`/`rejected` stamp.
 * @property {string | null} terminalQuantity Remaining quantity the
 *   terminal event removed or refused, when the event carries one.
 * @property {{
 *   fillId: string | null,
 *   liquidity: "maker" | "taker" | null,
 *   at: string,
 *   quantityUnits: bigint,
 *   priceUnits: bigint
 * }[]} fills This order's own fill legs — the VWAP source for a market
 *   order's price and the member read's `fills` projection source.
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

/** Engine `at` stamps are second-precision; the contract carries milliseconds. @param {string} at */
function msIso(at) {
  return new Date(Date.parse(at)).toISOString();
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
 * The placed fields a subject order carries into the view that do not come
 * from engine state — the jittered reference-mid price and the 10..9999
 * unit quantity draw, the same distributions the fixture used, so subject
 * books keep their deterministic shape.
 *
 * @param {string} subject
 * @param {{ baseScale: number, quoteScale: number, referenceMid: string }} pairDef
 * @param {string} salt
 * @returns {{ price: bigint, baseAmount: bigint }}
 */
function placedFields(subject, pairDef, salt) {
  const offsetBps = Number(units(subject, `offset:${salt}`, 151n)) - 75;
  const direction = units(subject, `direction:${salt}`, 2n) === 0n ? 1 : -1;
  const price = divideRounded(
    parseUnits(pairDef.referenceMid) * BigInt(10_000 + direction * offsetBps),
    10_000n,
    "half_even"
  );
  const whole = 10n + units(subject, `base:${salt}`, 9_990n);
  const fraction = units(subject, `fraction:${salt}`, 10n ** BigInt(pairDef.baseScale));
  const baseAmount = whole * 10n ** BigInt(pairDef.baseScale) + fraction;
  return { price, baseAmount };
}

/**
 * Deterministic per-subject synthetic market scenario — a pure function of
 * the subject: the same subject always derives the same steps and intents
 * and nothing is retained between subjects or calls. The steps interleave
 * the subject's own orders with deterministic counterparty liquidity and
 * sweeps, which is what makes the engine emit the lifecycle events the
 * projection folds into contract rows.
 *
 * Counterparty submissions come from synthetic `mm_*` market-maker owners,
 * so the engine's pinned self-trade-reject policy can still fire whenever
 * the subject's own orders cross each other.
 *
 * @param {string} subject
 * @returns {ExchangeOrderScenario}
 */
export function exchangeOrderScenario(subject) {
  /** @type {ScenarioStep[]} */
  const steps = [];
  /** @type {ScenarioOrderIntent[]} */
  const intents = [];
  // The subject's orders all carry one derived owner tag: collisions
  // between them trip the engine's self-trade policy deterministically.
  const owner = `cust_${digest(subject, "owner").toString("hex").slice(0, 16)}`;
  const pairFor = (/** @type {string} */ salt) =>
    ORDER_PAIRS[Number(units(subject, `pair:${salt}`, BigInt(ORDER_PAIRS.length)))];
  const sideFor = (/** @type {string} */ salt) =>
    /** @type {"buy" | "sell"} */ (
      ORDER_SIDES[Number(units(subject, `side:${salt}`, BigInt(ORDER_SIDES.length)))]
    );
  const feeFor = (/** @type {string} */ salt) => 15 + Number(units(subject, `fee:${salt}`, 31n));
  const idFor = (/** @type {string} */ salt) =>
    `ord_${digest(subject, `id:${salt}`).toString("hex").slice(0, 24)}`;
  const counterpartyId = (/** @type {string} */ salt) =>
    `ord_${digest(subject, `cp-id:${salt}`).toString("hex").slice(0, 24)}`;
  const counterpartyOwner = (/** @type {string} */ salt) =>
    `mm_${digest(subject, `cp-owner:${salt}`).toString("hex").slice(0, 12)}`;
  const gapFor = (/** @type {string} */ salt) => 10 + Number(units(subject, `gap:${salt}`, 281n));
  const betweenActs = (/** @type {string} */ salt) =>
    STEP_SECONDS + Number(units(subject, `created:${salt}`, BigInt(STEP_SECONDS)));
  const advance = (/** @type {number} */ seconds) => steps.push({ op: "advance", seconds });
  const cancel = (/** @type {string} */ instrument, /** @type {string} */ orderId) =>
    steps.push({ op: "cancel", instrument, order_id: orderId });
  const submit = (/** @type {Record<string, unknown>} */ input) =>
    steps.push({ op: "submit", input: Object.freeze(input) });
  const intent = (/** @type {ScenarioOrderIntent} */ value) => intents.push(Object.freeze(value));
  const limitInput = (
    /** @type {string} */ orderId,
    /** @type {{ pair: string }} */ pairDef,
    /** @type {"buy" | "sell"} */ side,
    /** @type {string} */ orderOwner,
    /** @type {string} */ priceText,
    /** @type {string} */ quantityText
  ) => ({ order_id: orderId, instrument: pairDef.pair, side, type: "limit", price: priceText, quantity: quantityText, owner: orderOwner });
  const marketInput = (
    /** @type {string} */ orderId,
    /** @type {{ pair: string }} */ pairDef,
    /** @type {"buy" | "sell"} */ side,
    /** @type {string} */ orderOwner,
    /** @type {string} */ quantityText
  ) => ({ order_id: orderId, instrument: pairDef.pair, side, type: "market", quantity: quantityText, owner: orderOwner });
  const limitIntent = (
    /** @type {string} */ orderId,
    /** @type {{ pair: string }} */ pairDef,
    /** @type {"buy" | "sell"} */ side,
    /** @type {string} */ orderType,
    /** @type {string} */ priceText,
    /** @type {string} */ quantityText,
    /** @type {number} */ feeBps,
    /** @type {boolean} */ expires
  ) => ({
    order_id: orderId,
    pair: pairDef.pair,
    side,
    order_type: /** @type {"limit" | "market"} */ (orderType),
    price: priceText,
    quantity: quantityText,
    fee_bps: feeBps,
    expires
  });

  const appendAct = (/** @type {string} */ role, /** @type {string} */ salt) => {
    const pairDef = pairFor(salt);
    const side = sideFor(salt);
    const { price, baseAmount } = placedFields(subject, pairDef, salt);
    const priceText = decimal(price, PRICE_SCALE);
    const quantityText = decimal(baseAmount, pairDef.baseScale);
    const orderId = idFor(salt);
    const feeBps = feeFor(salt);
    advance(betweenActs(salt));
    if (role === "rest") {
      intent(limitIntent(orderId, pairDef, side, "limit", priceText, quantityText, feeBps, false));
      submit(limitInput(orderId, pairDef, side, owner, priceText, quantityText));
      return;
    }
    if (role === "partial") {
      intent(limitIntent(orderId, pairDef, side, "limit", priceText, quantityText, feeBps, false));
      submit(limitInput(orderId, pairDef, side, owner, priceText, quantityText));
      advance(gapFor(`${salt}:fill`));
      // A counterparty market order on the opposite side sweeps 30–90% of
      // this order's size (or stale cheaper levels first — the projection
      // is honest either way): the resting remainder is what the view
      // must report.
      const fillUnits =
        (baseAmount * BigInt(3 + Number(units(subject, `fill:${salt}`, 7n)))) / 10n;
      submit(
        marketInput(
          counterpartyId(`${salt}:taker`),
          pairDef,
          OPPOSITE_SIDE[side],
          counterpartyOwner(`${salt}:taker`),
          decimal(fillUnits, pairDef.baseScale)
        )
      );
      return;
    }
    if (role === "cancel" || role === "expire") {
      // Customer cancel vs TTL sweep: identical engine event — the
      // intent's `expires` flag carries the distinction into the
      // projection.
      intent(limitIntent(orderId, pairDef, side, "limit", priceText, quantityText, feeBps, role === "expire"));
      submit(limitInput(orderId, pairDef, side, owner, priceText, quantityText));
      advance(gapFor(`${salt}:sweep`));
      cancel(pairDef.pair, orderId);
      return;
    }
    if (role === "reject_shape") {
      intent(limitIntent(orderId, pairDef, side, "limit", priceText, quantityText, feeBps, false));
      // Malformed by construction: the unknown `note` key makes the
      // engine's input validation reject before the order is tracked.
      submit({ ...limitInput(orderId, pairDef, side, owner, priceText, quantityText), note: "synthetic-shape" });
      return;
    }
    if (role === "market_gap") {
      // A thin opposite-side maker first: the market order sweeps it
      // whole, and its leftover is rejected insufficient_liquidity — a
      // rejected row whose fill legs fix its VWAP price.
      const maker = placedFields(subject, pairDef, `cp:${salt}`);
      const makerUnits = baseAmount / BigInt(2 + Number(units(subject, `thin:${salt}`, 7n)));
      submit(
        limitInput(
          counterpartyId(`${salt}:maker`),
          pairDef,
          OPPOSITE_SIDE[side],
          counterpartyOwner(`${salt}:maker`),
          decimal(maker.price, PRICE_SCALE),
          decimal(makerUnits, pairDef.baseScale)
        )
      );
      advance(gapFor(`${salt}:gap`));
      intent(limitIntent(orderId, pairDef, side, "market", priceText, quantityText, feeBps, false));
      submit(marketInput(orderId, pairDef, side, owner, quantityText));
      return;
    }
    // role === "self_trade": the resting order and the crossing follow-up
    // collide under the engine's pinned self-trade-reject policy — the
    // cross carries the same price on the opposite side, so it always
    // meets the subject's own level.
    intent(limitIntent(orderId, pairDef, side, "limit", priceText, quantityText, feeBps, false));
    submit(limitInput(orderId, pairDef, side, owner, priceText, quantityText));
    advance(gapFor(`${salt}:cross`));
    const crossId = idFor(`${salt}:cross`);
    const crossSide = OPPOSITE_SIDE[side];
    intent(limitIntent(crossId, pairDef, crossSide, "limit", priceText, quantityText, feeBps, false));
    submit(limitInput(crossId, pairDef, crossSide, owner, priceText, quantityText));
  };

  // Two opening acts run on an empty book, so no stale level can ever
  // intercept them: they are the trades read's guaranteed rows. Both
  // subject orders fill completely — a resting limit order swept by a
  // counterparty market taker (a maker leg) and a subject market order
  // that fills inside an exact-size counterparty level (a taker leg) —
  // so, like the ghost acts, the orders projection drops them and every
  // later act replays on the empty book they leave behind.
  {
    const salt = "trade:maker";
    const pairDef = pairFor(salt);
    const side = sideFor(salt);
    const { price, baseAmount } = placedFields(subject, pairDef, salt);
    const priceText = decimal(price, PRICE_SCALE);
    const quantityText = decimal(baseAmount, pairDef.baseScale);
    const orderId = idFor(salt);
    advance(betweenActs(salt));
    intent(limitIntent(orderId, pairDef, side, "limit", priceText, quantityText, feeFor(salt), false));
    submit(limitInput(orderId, pairDef, side, owner, priceText, quantityText));
    advance(gapFor(`${salt}:sweep`));
    // A counterparty market order sized past the resting order's whole
    // quantity fills the book's only opposite level completely, then its
    // own remainder is rejected on the empty book.
    submit(
      marketInput(
        counterpartyId(`${salt}:taker`),
        pairDef,
        OPPOSITE_SIDE[side],
        counterpartyOwner(`${salt}:taker`),
        decimal(baseAmount + baseAmount / 4n + 1n, pairDef.baseScale)
      )
    );
  }
  {
    const salt = "trade:taker";
    const pairDef = pairFor(salt);
    const side = sideFor(salt);
    const { price, baseAmount } = placedFields(subject, pairDef, salt);
    const quantityText = decimal(baseAmount, pairDef.baseScale);
    const orderId = idFor(salt);
    const maker = placedFields(subject, pairDef, `cp:${salt}`);
    advance(betweenActs(salt));
    // A counterparty maker sized exactly to the subject's market sweep:
    // the taker fills completely at that one level and both legs close,
    // leaving the book empty again for the first ordinary act.
    submit(
      limitInput(
        counterpartyId(`${salt}:maker`),
        pairDef,
        OPPOSITE_SIDE[side],
        counterpartyOwner(`${salt}:maker`),
        decimal(maker.price, PRICE_SCALE),
        quantityText
      )
    );
    advance(gapFor(`${salt}:sweep`));
    intent(
      limitIntent(
        orderId,
        pairDef,
        side,
        "market",
        decimal(price, PRICE_SCALE),
        quantityText,
        feeFor(salt),
        false
      )
    );
    submit(marketInput(orderId, pairDef, side, owner, quantityText));
  }

  const count = 1 + Number(units(subject, "count", 4n));
  const roleOffset = Number(units(subject, "role", BigInt(SCENARIO_ROLES.length)));
  for (let index = 0; index < count; index += 1) {
    appendAct(SCENARIO_ROLES[(index + roleOffset) % SCENARIO_ROLES.length], `${index}`);
  }
  // Guaranteed tail act — a role whose order can never fill — keeps every
  // subject's view non-empty even when book cross-talk consumed the rest.
  appendAct(
    GUARANTEED_ROW_ROLES[Number(units(subject, "tail-role", BigInt(GUARANTEED_ROW_ROLES.length)))],
    "tail"
  );

  // Two ghost acts close the book: orders engineered to execute in full.
  // The engine tracks them "filled" and the projection drops them — the
  // contract never advertises an executed order. Stale levels may
  // intercept part of a sweep; that stays honest too, since a ghost that
  // survives simply remains an ordinary open or rejected row.
  {
    const salt = "ghost-limit";
    const pairDef = pairFor(salt);
    const side = sideFor(salt);
    const { price, baseAmount } = placedFields(subject, pairDef, salt);
    const priceText = decimal(price, PRICE_SCALE);
    const quantityText = decimal(baseAmount, pairDef.baseScale);
    const orderId = idFor(salt);
    advance(betweenActs(salt));
    intent(limitIntent(orderId, pairDef, side, "limit", priceText, quantityText, feeFor(salt), false));
    submit(limitInput(orderId, pairDef, side, owner, priceText, quantityText));
    advance(gapFor(`${salt}:sweep`));
    // A counterparty market order sized past the ghost's whole quantity.
    submit(
      marketInput(
        counterpartyId(`${salt}:taker`),
        pairDef,
        OPPOSITE_SIDE[side],
        counterpartyOwner(`${salt}:taker`),
        decimal(baseAmount + baseAmount / 4n + 1n, pairDef.baseScale)
      )
    );
  }
  {
    const salt = "ghost-market";
    const pairDef = pairFor(salt);
    const side = sideFor(salt);
    const { price, baseAmount } = placedFields(subject, pairDef, salt);
    const orderId = idFor(salt);
    const maker = placedFields(subject, pairDef, `cp:${salt}`);
    advance(betweenActs(salt));
    // A counterparty maker deeper than the subject's sweep, so the market
    // order can fill entirely inside this one level.
    submit(
      limitInput(
        counterpartyId(`${salt}:maker`),
        pairDef,
        OPPOSITE_SIDE[side],
        counterpartyOwner(`${salt}:maker`),
        decimal(maker.price, PRICE_SCALE),
        decimal(baseAmount + baseAmount / 4n + 1n, pairDef.baseScale)
      )
    );
    advance(gapFor(`${salt}:sweep`));
    intent(
      limitIntent(
        orderId,
        pairDef,
        side,
        "market",
        decimal(price, PRICE_SCALE),
        decimal(baseAmount, pairDef.baseScale),
        feeFor(salt),
        false
      )
    );
    submit(marketInput(orderId, pairDef, side, owner, decimal(baseAmount, pairDef.baseScale)));
  }

  return Object.freeze({
    start_seconds: BASE_SECONDS,
    steps: Object.freeze(steps.map((step) => Object.freeze(step))),
    intents: Object.freeze(intents)
  });
}

/**
 * Replays a scenario on a fresh engine: one simulated clock advanced by
 * the scenario's steps, one `createMatchingEngine` applying the
 * submissions and cancels in order. The engine is request-scoped — the
 * caller projects it and drops it; nothing is retained per subject.
 *
 * @param {ExchangeOrderScenario} scenario
 * @returns {ReturnType<typeof createMatchingEngine>}
 */
export function replayExchangeOrderScenario(scenario) {
  const clock = createSimulatedClock(scenario.start_seconds);
  const engine = createMatchingEngine({ clock });
  for (const step of scenario.steps) {
    if (step.op === "advance") {
      clock.advance(step.seconds ?? 0);
    } else if (step.op === "submit") {
      engine.submitOrder(step.input);
    } else if (step.op === "cancel") {
      engine.cancelOrder(step.instrument, step.order_id);
    } else {
      // Unknown operations fail closed instead of being silently mapped
      // onto a cancel: a scenario carrying a new or mistyped op replays
      // nothing rather than the wrong thing.
      throw new TypeError(`unknown scenario step op: ${String(step.op)}`);
    }
  }
  return engine;
}

/**
 * Folds one replayed journal into per-order trails — the scratch state
 * every row projection shares. Fill legs keep the pair's ids, liquidity
 * leg, stamp and units so a market order's VWAP and the member read's
 * `fills` both come from the same recorded executions.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 * @returns {Map<string, OrderTrail>}
 */
function orderTrails(engine) {
  /** @type {Map<string, OrderTrail>} */
  const trails = new Map();
  for (const event of engine.journal()) {
    if (typeof event.order_id !== "string") {
      continue;
    }
    const fields = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event));
    let trail = trails.get(event.order_id);
    if (trail === undefined) {
      trail = { acceptedAt: null, terminalAt: null, terminalQuantity: null, fills: [] };
      trails.set(event.order_id, trail);
    }
    if (event.type === "accepted") {
      trail.acceptedAt = event.at;
    } else if (event.type === "partially_filled" || event.type === "filled") {
      if (typeof fields.price === "string" && typeof fields.quantity === "string") {
        trail.fills.push({
          fillId: typeof fields.fill_id === "string" ? fields.fill_id : null,
          liquidity:
            event.order_id === fields.maker_order_id
              ? "maker"
              : event.order_id === fields.taker_order_id
                ? "taker"
                : null,
          at: event.at,
          quantityUnits: parseUnits(fields.quantity),
          priceUnits: parseUnits(fields.price)
        });
      }
    } else if (event.type === "cancelled" || event.type === "rejected") {
      // `updated_at` follows the last terminal-type event about the order
      // (a redundant cancel or duplicate id emits a terminal echo too),
      // while the displayed remainder is the quantity a terminal event
      // actually removed or refused — a quantity-less echo must never
      // erase a remainder already recorded by a real removal.
      trail.terminalAt = event.at;
      if (typeof fields.quantity === "string") {
        trail.terminalQuantity = fields.quantity;
      }
    }
  }
  return trails;
}

/**
 * Folds one replayed engine into contract rows in submission order — the
 * directory reverses for newest-first display. Engine state is read two
 * ways: `orderStatus` for the tracked lifecycle state, and the journal
 * for the `accepted`/terminal timestamps, removed remainders and the fill
 * legs a market order's VWAP comes from.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 * @param {readonly ScenarioOrderIntent[]} intents
 * @returns {readonly ExchangeOrderView[]}
 */
export function projectExchangeOrders(engine, intents) {
  const trails = orderTrails(engine);

  /** @type {ExchangeOrderView[]} */
  const rows = [];
  for (const intent of intents) {
    const pairDef = ORDER_PAIRS.find((entry) => entry.pair === intent.pair);
    const trail = trails.get(intent.order_id);
    const createdAt = trail === undefined ? null : trail.acceptedAt ?? trail.terminalAt;
    if (pairDef === undefined || trail === undefined || createdAt === null) {
      // Intents always name ORDER_PAIRS instruments and every submission
      // emits at least one event; anything else is a scenario bug the view
      // must not silently re-render as an order.
      continue;
    }
    const status = engine.orderStatus(intent.order_id);
    /** @type {"open" | "cancelled" | "expired" | "rejected"} */
    let state;
    let baseText;
    let updatedAt;
    if (status === null) {
      // Validation rejects never reach the tracked map: the lone reject
      // event is the whole lifecycle and nothing ever executed.
      state = "rejected";
      baseText = intent.quantity;
      updatedAt = trail.terminalAt ?? createdAt;
    } else if (status.state === "resting") {
      // Open orders show the still-resting remainder — a partially filled
      // order reports its reduced never-executed quantity.
      state = "open";
      baseText = status.remaining_quantity;
      updatedAt = createdAt;
    } else if (status.state === "cancelled") {
      state = intent.expires ? "expired" : "cancelled";
      baseText = trail.terminalQuantity ?? status.quantity;
      updatedAt = trail.terminalAt ?? createdAt;
    } else if (status.state === "rejected") {
      state = "rejected";
      baseText = trail.terminalQuantity ?? status.remaining_quantity;
      updatedAt = trail.terminalAt ?? createdAt;
    } else {
      // "filled": a fully executed order has no outstanding remainder —
      // the contract never advertises executed orders, so it is dropped.
      continue;
    }
    // A market order carries no limit price: its displayed price is the
    // volume-weighted average of its own fills (fill legs record maker
    // prices at the shared price scale), or the scenario's reference
    // estimate when nothing executed.
    const priceUnits =
      intent.order_type === "market" && trail.fills.length > 0
        ? divideRounded(
            trail.fills.reduce((sum, fill) => sum + fill.quantityUnits * fill.priceUnits, 0n),
            trail.fills.reduce((sum, fill) => sum + fill.quantityUnits, 0n),
            "half_even"
          )
        : parseUnits(intent.price);
    const baseUnits = parseUnits(baseText);
    const { quoteUnits, fee, total } = computeAmounts(
      pairDef,
      intent.side,
      baseUnits,
      priceUnits,
      intent.fee_bps
    );
    rows.push(
      Object.freeze({
        order_id: intent.order_id,
        pair: intent.pair,
        base_asset: pairDef.base,
        quote_asset: pairDef.quote,
        side: intent.side,
        order_type: intent.order_type,
        base_amount: decimal(baseUnits, pairDef.baseScale),
        price: decimal(priceUnits, PRICE_SCALE),
        quote_amount: decimal(quoteUnits, pairDef.quoteScale),
        fee_bps: intent.fee_bps,
        fee_amount: decimal(fee, pairDef.quoteScale),
        total_quote_amount: decimal(total, pairDef.quoteScale),
        status: state,
        created_at: msIso(createdAt),
        updated_at: msIso(updatedAt),
        execution: "not_supported",
        posting: "none"
      })
    );
  }
  return Object.freeze(rows);
}

/**
 * Folds one replayed engine into the subject's single-order detail: the
 * same contract row the list read emits — same status mapping, same
 * derived amounts — plus the order's own executed legs and the "filled"
 * terminal state the collection view excludes. A member read serves
 * terminal state (the getCustomerOperation precedent), so a fully
 * executed order reports `base_amount` as the placed quantity, its last
 * fill's stamp as `updated_at` and every leg in `fills`; an "open" order
 * still reports the resting remainder while `fills` shows what already
 * executed. `null` answers ids no intent minted — a foreign or
 * never-minted id fails closed rather than leaking existence.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 * @param {readonly ScenarioOrderIntent[]} intents
 * @param {string} orderId
 * @returns {ExchangeOrderDetailView | null}
 */
export function projectExchangeOrderDetail(engine, intents, orderId) {
  const intent = intents.find((entry) => entry.order_id === orderId);
  const pairDef = ORDER_PAIRS.find((entry) => entry.pair === intent?.pair);
  const trail = orderTrails(engine).get(orderId);
  const createdAt = trail === undefined ? null : trail.acceptedAt ?? trail.terminalAt;
  if (intent === undefined || pairDef === undefined || trail === undefined || createdAt === null) {
    // Intents always name ORDER_PAIRS instruments and every submission
    // emits at least one event; a subject intent with no journal record is
    // a scenario bug the read must not silently re-render as an order.
    return null;
  }
  const status = engine.orderStatus(orderId);
  /** @type {"open" | "filled" | "cancelled" | "expired" | "rejected"} */
  let state;
  let baseText;
  let updatedAt;
  if (status === null) {
    // Validation rejects never reach the tracked map: the lone reject
    // event is the whole lifecycle and nothing ever executed.
    state = "rejected";
    baseText = intent.quantity;
    updatedAt = trail.terminalAt ?? createdAt;
  } else if (status.state === "resting") {
    // Open orders show the still-resting remainder — a partially filled
    // order reports its reduced never-executed quantity, with the legs
    // that already executed in `fills`.
    state = "open";
    baseText = status.remaining_quantity;
    updatedAt = createdAt;
  } else if (status.state === "cancelled") {
    state = intent.expires ? "expired" : "cancelled";
    baseText = trail.terminalQuantity ?? status.quantity;
    updatedAt = trail.terminalAt ?? createdAt;
  } else if (status.state === "rejected") {
    state = "rejected";
    baseText = trail.terminalQuantity ?? status.remaining_quantity;
    updatedAt = trail.terminalAt ?? createdAt;
  } else {
    // "filled": the detail read serves terminal state, so the executed
    // order reports the placed quantity (the amount that actually filled)
    // and its last fill's stamp as the terminal update.
    state = "filled";
    baseText = intent.quantity;
    updatedAt = trail.fills.at(-1)?.at ?? trail.terminalAt ?? createdAt;
  }
  /** @type {ExchangeOrderFillView[]} */
  const fills = [];
  for (const leg of trail.fills) {
    if (leg.fillId === null || leg.liquidity === null) {
      // Fill events always carry both leg ids on this engine; a leg
      // without them is scenario drift the member read must not serve.
      continue;
    }
    fills.push(
      Object.freeze({
        // The trd_* digest recipe the trades read applies to the same
        // journal pair, so a fill leg joins one-to-one to its TradeView.
        fill_id: `trd_${digest(orderId, `trade:${leg.fillId}`).toString("hex").slice(0, 24)}`,
        liquidity: leg.liquidity,
        price: decimal(leg.priceUnits, PRICE_SCALE),
        quantity: decimal(leg.quantityUnits, pairDef.baseScale),
        executed_at: msIso(leg.at)
      })
    );
  }
  // A market order carries no limit price: its displayed price is the
  // volume-weighted average of its own fills (the same legs `fills`
  // projects), or the scenario's reference estimate when nothing executed.
  const priceUnits =
    intent.order_type === "market" && trail.fills.length > 0
      ? divideRounded(
          trail.fills.reduce((sum, fill) => sum + fill.quantityUnits * fill.priceUnits, 0n),
          trail.fills.reduce((sum, fill) => sum + fill.quantityUnits, 0n),
          "half_even"
        )
      : parseUnits(intent.price);
  const baseUnits = parseUnits(baseText);
  const { quoteUnits, fee, total } = computeAmounts(
    pairDef,
    intent.side,
    baseUnits,
    priceUnits,
    intent.fee_bps
  );
  return Object.freeze({
    order_id: intent.order_id,
    pair: intent.pair,
    base_asset: pairDef.base,
    quote_asset: pairDef.quote,
    side: intent.side,
    order_type: intent.order_type,
    base_amount: decimal(baseUnits, pairDef.baseScale),
    price: decimal(priceUnits, PRICE_SCALE),
    quote_amount: decimal(quoteUnits, pairDef.quoteScale),
    fee_bps: intent.fee_bps,
    fee_amount: decimal(fee, pairDef.quoteScale),
    total_quote_amount: decimal(total, pairDef.quoteScale),
    status: state,
    created_at: msIso(createdAt),
    updated_at: msIso(updatedAt),
    fills: Object.freeze(fills),
    execution: "not_supported",
    posting: "none"
  });
}

/**
 * Folds the same replay's journal into the subject's execution rows: a
 * fill pair emits one event per leg, so a leg is one of the subject's
 * trades exactly when its `order_id` belongs to a subject intent —
 * counterparty-only fills and the counterparty side of a shared fill are
 * never the subject's trades. `liquidity` reads straight off the pair's
 * maker/taker ids, `price`/`quantity` come from the fill event (the maker
 * price the legs actually crossed at, not the intent's estimate), and the
 * derived amounts recompute with the intent's own fee through the same
 * simulator arithmetic the orders view uses. Rows are emitted in journal
 * (execution) order — the directory reverses for newest-first display.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 * @param {readonly ScenarioOrderIntent[]} intents
 * @returns {readonly TradeView[]}
 */
export function projectExchangeTrades(engine, intents) {
  /** @type {Map<string, ScenarioOrderIntent>} */
  const subjectOrders = new Map(intents.map((intent) => [intent.order_id, intent]));
  /** @type {TradeView[]} */
  const rows = [];
  for (const event of engine.journal()) {
    if (event.type !== "partially_filled" && event.type !== "filled") {
      continue;
    }
    if (typeof event.order_id !== "string") {
      continue;
    }
    const intent = subjectOrders.get(event.order_id);
    if (intent === undefined) {
      continue;
    }
    const fields = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event));
    const liquidity =
      event.order_id === fields.maker_order_id
        ? "maker"
        : event.order_id === fields.taker_order_id
          ? "taker"
          : null;
    const pairDef = ORDER_PAIRS.find((entry) => entry.pair === intent.pair);
    if (
      pairDef === undefined ||
      liquidity === null ||
      typeof fields.fill_id !== "string" ||
      typeof fields.price !== "string" ||
      typeof fields.quantity !== "string"
    ) {
      // Fill events always carry both leg ids, the maker price and the
      // executed quantity on this engine; anything else is a scenario
      // drift the view must not re-render as a trade.
      continue;
    }
    const priceUnits = parseUnits(fields.price);
    const quantityUnits = parseUnits(fields.quantity);
    const { quoteUnits, fee, total } = computeAmounts(
      pairDef,
      intent.side,
      quantityUnits,
      priceUnits,
      intent.fee_bps
    );
    rows.push(
      Object.freeze({
        // The engine's fill_id counter restarts on every replay, so it is
        // identical across subjects — the row id is derived like every
        // other view's: a subject-scoped digest on the order id plus the
        // fill it executed in (unique within a subject's list because the
        // self-trade policy keeps a subject off both legs of one fill).
        trade_id: `trd_${digest(intent.order_id, `trade:${fields.fill_id}`).toString("hex").slice(0, 24)}`,
        order_id: intent.order_id,
        pair: intent.pair,
        base_asset: pairDef.base,
        quote_asset: pairDef.quote,
        side: intent.side,
        liquidity,
        price: decimal(priceUnits, PRICE_SCALE),
        quantity: decimal(quantityUnits, pairDef.baseScale),
        quote_amount: decimal(quoteUnits, pairDef.quoteScale),
        fee_bps: intent.fee_bps,
        fee_amount: decimal(fee, pairDef.quoteScale),
        total_quote_amount: decimal(total, pairDef.quoteScale),
        executed_at: msIso(event.at),
        execution: "not_supported",
        posting: "none"
      })
    );
  }
  return Object.freeze(rows);
}

/**
 * Folds the same replay into per-instrument market data: every declared
 * pair reports its top-of-book state off `bookSnapshot` (best bid/ask with
 * aggregate resting quantity and order count, null on an empty side), the
 * journal's last fill as `last_trade`, the integer-basis-point relative
 * spread of the two top levels against their mid (null when either side
 * is empty, since no spread exists without both), and the simulated
 * session close as `as_of`. Rows are emitted in `ORDER_PAIRS` order — the
 * canonical instrument sequence the validator pins exactly. Depth is
 * honest book state: whatever the subject's scenario left resting.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 * @param {ExchangeOrderScenario} scenario
 * @returns {readonly MarketView[]}
 */
export function projectExchangeMarkets(engine, scenario) {
  const lastFills = lastFillsByInstrument(engine);
  const asOf = new Date(scenarioEndSeconds(scenario) * 1_000).toISOString();
  /** @type {MarketView[]} */
  const rows = [];
  for (const pairDef of ORDER_PAIRS) {
    const book = engine.bookSnapshot(pairDef.pair);
    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    // Relative spread in integer basis points of the mid:
    // (ask - bid) / mid * 10_000 == (ask - bid) * 20_000 / (ask + bid) in
    // exact integer units — the book never rests crossed, so the result is
    // never negative.
    const spreadBps =
      bestBid === undefined || bestAsk === undefined
        ? null
        : Number(
            divideRounded(
              (parseUnits(bestAsk.price) - parseUnits(bestBid.price)) * 20_000n,
              parseUnits(bestAsk.price) + parseUnits(bestBid.price),
              "half_even"
            )
          );
    const lastFill = lastFills.get(pairDef.pair);
    rows.push(
      Object.freeze({
        instrument: pairDef.pair,
        base_asset: pairDef.base,
        quote_asset: pairDef.quote,
        best_bid:
          bestBid === undefined
            ? null
            : Object.freeze({ price: bestBid.price, quantity: bestBid.quantity, order_count: bestBid.order_count }),
        best_ask:
          bestAsk === undefined
            ? null
            : Object.freeze({ price: bestAsk.price, quantity: bestAsk.quantity, order_count: bestAsk.order_count }),
        last_trade:
          lastFill === undefined
            ? null
            : Object.freeze({ price: lastFill.price, quantity: lastFill.quantity, executed_at: msIso(lastFill.at) }),
        spread_bps: spreadBps,
        base_scale: pairDef.baseScale,
        quote_scale: pairDef.quoteScale,
        price_scale: PRICE_SCALE,
        as_of: asOf,
        posting: "none"
      })
    );
  }
  return Object.freeze(rows);
}

/**
 * The latest fill each instrument recorded in one replayed journal — the
 * fold the markets read's `last_trade` and the depth read share.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 * @returns {Map<string, { price: string, quantity: string, at: string }>}
 */
function lastFillsByInstrument(engine) {
  /** @type {Map<string, { price: string, quantity: string, at: string }>} */
  const lastFills = new Map();
  for (const event of engine.journal()) {
    if (event.type !== "partially_filled" && event.type !== "filled") {
      continue;
    }
    const fields = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (event));
    if (
      typeof fields.instrument !== "string" ||
      typeof fields.price !== "string" ||
      typeof fields.quantity !== "string"
    ) {
      // A fill event on this engine always carries its instrument, the
      // maker price and the executed quantity; anything else is journal
      // drift the view must not silently re-render as a last trade.
      continue;
    }
    // Both legs of one fill share fill_id, price, quantity and `at`, so
    // overwriting keeps the latest fill per instrument either way.
    lastFills.set(fields.instrument, { price: fields.price, quantity: fields.quantity, at: event.at });
  }
  return lastFills;
}

/**
 * The simulated session close — the replay's own clock end, derived like
 * every other field from the scenario alone.
 *
 * @param {ExchangeOrderScenario} scenario
 */
function scenarioEndSeconds(scenario) {
  let endSeconds = scenario.start_seconds;
  for (const step of scenario.steps) {
    if (step.op === "advance") {
      endSeconds += step.seconds ?? 0;
    }
  }
  return endSeconds;
}

/**
 * Folds the same replay into the depth member read: the instrument's full
 * resting ladder off `bookSnapshot` — bids best (highest) price first,
 * asks best (lowest) price first — rather than the markets read's top
 * level. Each side reports at most MAX_MARKET_DEPTH_LEVELS levels, the
 * documented contract bound a deeper book truncates to. `last_trade` is
 * the instrument's last fill like the collection read reports it, `as_of`
 * the simulated session close and `depth_levels` the deeper side's level
 * count after the cap. `null` answers instruments outside the declared
 * universe — a malformed or foreign value fails closed to the pinned 404
 * rather than leaking which instruments exist.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 * @param {ExchangeOrderScenario} scenario
 * @param {string} instrument
 * @returns {MarketDepthView | null}
 */
export function projectExchangeMarketDepth(engine, scenario, instrument) {
  const pairDef = ORDER_PAIRS.find((entry) => entry.pair === instrument);
  if (pairDef === undefined) {
    return null;
  }
  const book = engine.bookSnapshot(pairDef.pair);
  // `bookSnapshot` already reports bids best-first descending and asks
  // best-first ascending; the projection freezes exactly that ladder,
  // truncated to the documented per-side bound.
  const bids = Object.freeze(
    book.bids.slice(0, MAX_MARKET_DEPTH_LEVELS).map((level) =>
      Object.freeze({ price: level.price, quantity: level.quantity, order_count: level.order_count })
    )
  );
  const asks = Object.freeze(
    book.asks.slice(0, MAX_MARKET_DEPTH_LEVELS).map((level) =>
      Object.freeze({ price: level.price, quantity: level.quantity, order_count: level.order_count })
    )
  );
  const lastFill = lastFillsByInstrument(engine).get(pairDef.pair);
  return Object.freeze({
    mode: "test",
    instrument: pairDef.pair,
    base_asset: pairDef.base,
    quote_asset: pairDef.quote,
    bids,
    asks,
    last_trade:
      lastFill === undefined
        ? null
        : Object.freeze({ price: lastFill.price, quantity: lastFill.quantity, executed_at: msIso(lastFill.at) }),
    depth_levels: Math.max(book.bids.length, book.asks.length),
    as_of: new Date(scenarioEndSeconds(scenario) * 1_000).toISOString(),
    posting: "none"
  });
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
  // A market order never rests and is never cancelled: it either fills
  // (and the contract excludes filled orders) or ends rejected, so the
  // only market row the projection can emit is a rejected one.
  if (candidate.order_type === "market" && candidate.status !== "rejected") {
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

/** @param {unknown} trade */
function validTrade(trade) {
  if (trade === null || typeof trade !== "object" || Array.isArray(trade)) {
    return false;
  }
  const candidate = /** @type {TradeView} */ (trade);
  if (JSON.stringify(Object.keys(trade).sort()) !== JSON.stringify([...TRADE_KEYS].sort())) {
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
    !TRADE_LIQUIDITIES.includes(candidate.liquidity) ||
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
    !TRADE_ID_PATTERN.test(candidate.trade_id) ||
    !ORDER_ID_PATTERN.test(candidate.order_id) ||
    !isScaledDecimal(candidate.price, PRICE_SCALE) ||
    !isScaledDecimal(candidate.quantity, pairDef.baseScale) ||
    !isScaledDecimal(candidate.quote_amount, pairDef.quoteScale) ||
    !isScaledDecimal(candidate.fee_amount, pairDef.quoteScale) ||
    !isScaledDecimal(candidate.total_quote_amount, pairDef.quoteScale)
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.executed_at)) {
    return false;
  }
  // Fail closed unless every derived amount recomputes exactly like the
  // simulator's quote arithmetic at the fill's fixed price.
  const recomputed = computeAmounts(
    pairDef,
    candidate.side,
    parseUnits(candidate.quantity),
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
export function validTradesView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {TradesView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...TRADES_VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.trades)) {
    return false;
  }
  // A trade id is minted once per (order, fill) pair: a repeated id means
  // two rows claiming one execution record.
  return (
    candidate.trades.every(validTrade) &&
    new Set(candidate.trades.map((trade) => trade.trade_id)).size === candidate.trades.length
  );
}

/**
 * @param {unknown} level
 * @param {{ baseScale: number }} pairDef
 */
function validMarketLevel(level, pairDef) {
  if (level === null) {
    return true;
  }
  if (typeof level !== "object" || Array.isArray(level)) {
    return false;
  }
  const candidate = /** @type {MarketLevelView} */ (level);
  return (
    JSON.stringify(Object.keys(level).sort()) === JSON.stringify([...MARKET_LEVEL_KEYS].sort()) &&
    isScaledDecimal(candidate.price, PRICE_SCALE) &&
    parseUnits(candidate.price) > 0n &&
    isScaledDecimal(candidate.quantity, pairDef.baseScale) &&
    parseUnits(candidate.quantity) > 0n &&
    Number.isSafeInteger(candidate.order_count) &&
    candidate.order_count >= 1
  );
}

/** @param {unknown} market */
function validMarket(market) {
  if (market === null || typeof market !== "object" || Array.isArray(market)) {
    return false;
  }
  const candidate = /** @type {MarketView} */ (market);
  if (JSON.stringify(Object.keys(market).sort()) !== JSON.stringify([...MARKET_KEYS].sort())) {
    return false;
  }
  const pairDef = ORDER_PAIRS.find((entry) => entry.pair === candidate.instrument);
  if (
    pairDef === undefined ||
    candidate.base_asset !== pairDef.base ||
    candidate.quote_asset !== pairDef.quote ||
    candidate.base_scale !== pairDef.baseScale ||
    candidate.quote_scale !== pairDef.quoteScale ||
    candidate.price_scale !== PRICE_SCALE ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  if (!validMarketLevel(candidate.best_bid, pairDef) || !validMarketLevel(candidate.best_ask, pairDef)) {
    return false;
  }
  // The engine never rests a crossed book: when both top levels exist the
  // bid is strictly below the ask, and spread_bps is the exact integer
  // recomputation of the relative mid spread — null exactly when either
  // side is empty.
  if (candidate.best_bid !== null && candidate.best_ask !== null) {
    if (
      !Number.isSafeInteger(candidate.spread_bps) ||
      /** @type {number} */ (candidate.spread_bps) < 0 ||
      parseUnits(candidate.best_bid.price) >= parseUnits(candidate.best_ask.price)
    ) {
      return false;
    }
    const recomputed = divideRounded(
      (parseUnits(candidate.best_ask.price) - parseUnits(candidate.best_bid.price)) * 20_000n,
      parseUnits(candidate.best_ask.price) + parseUnits(candidate.best_bid.price),
      "half_even"
    );
    if (candidate.spread_bps !== Number(recomputed)) {
      return false;
    }
  } else if (candidate.spread_bps !== null) {
    return false;
  }
  if (candidate.last_trade !== null) {
    if (
      typeof candidate.last_trade !== "object" ||
      Array.isArray(candidate.last_trade) ||
      JSON.stringify(Object.keys(candidate.last_trade).sort()) !==
        JSON.stringify([...MARKET_LAST_TRADE_KEYS].sort()) ||
      !isScaledDecimal(candidate.last_trade.price, PRICE_SCALE) ||
      parseUnits(candidate.last_trade.price) <= 0n ||
      !isScaledDecimal(candidate.last_trade.quantity, pairDef.baseScale) ||
      parseUnits(candidate.last_trade.quantity) <= 0n ||
      !isIsoTimestamp(candidate.last_trade.executed_at)
    ) {
      return false;
    }
  }
  // A fill can only be recorded inside the replayed session: the reported
  // last trade never post-dates the snapshot close.
  return (
    isIsoTimestamp(candidate.as_of) &&
    (candidate.last_trade === null ||
      Date.parse(candidate.last_trade.executed_at) <= Date.parse(candidate.as_of))
  );
}

/** @param {unknown} view */
export function validMarketsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {MarketsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...MARKETS_VIEW_KEYS].sort())) {
    return false;
  }
  if (
    candidate.mode !== "test" ||
    !Array.isArray(candidate.markets) ||
    candidate.markets.length !== ORDER_PAIRS.length
  ) {
    return false;
  }
  // The canonical instrument sequence is pinned exactly: every declared
  // pair reports precisely once, in ORDER_PAIRS order.
  return (
    candidate.markets.every(validMarket) &&
    candidate.markets.every(
      (market, index) => market.instrument === ORDER_PAIRS[index].pair
    )
  );
}

/**
 * Fail-closed member-read check for the depth view: exact keys, the
 * instrument resolves its declared assets and scales from ORDER_PAIRS,
 * every level carries a positive price at PRICE_SCALE and a positive
 * quantity at the pair's base scale, bids are strictly descending and
 * asks strictly ascending, the top of book is never crossed, no price
 * level repeats on a side, `depth_levels` stays consistent with the
 * deeper side's resting level count before the documented cap, and
 * `last_trade`
 * is either null or a coherent nested fill stamped inside the replayed
 * session. Money fields appear only inside the nested level and
 * last-trade objects — the view itself never carries a bare amount.
 *
 * @param {unknown} view
 */
export function validMarketDepthView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {MarketDepthView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...MARKET_DEPTH_VIEW_KEYS].sort())) {
    return false;
  }
  const pairDef = ORDER_PAIRS.find((entry) => entry.pair === candidate.instrument);
  if (
    candidate.mode !== "test" ||
    pairDef === undefined ||
    candidate.base_asset !== pairDef.base ||
    candidate.quote_asset !== pairDef.quote ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  /**
   * @param {readonly MarketLevelView[]} levels
   * @param {boolean} descending
   */
  const validSide = (levels, descending) => {
    if (!Array.isArray(levels) || levels.length > MAX_MARKET_DEPTH_LEVELS) {
      return false;
    }
    const seen = new Set();
    let previous = null;
    for (const level of levels) {
      // A level in a ladder is never null: nullability is the markets
      // read's empty-side convention, not the depth ladder's.
      if (level === null || typeof level !== "object" || Array.isArray(level)) {
        return false;
      }
      const entry = /** @type {MarketLevelView} */ (level);
      if (
        JSON.stringify(Object.keys(level).sort()) !== JSON.stringify([...MARKET_LEVEL_KEYS].sort()) ||
        !isScaledDecimal(entry.price, PRICE_SCALE) ||
        !isScaledDecimal(entry.quantity, pairDef.baseScale) ||
        parseUnits(entry.price) <= 0n ||
        parseUnits(entry.quantity) <= 0n ||
        !Number.isSafeInteger(entry.order_count) ||
        entry.order_count < 1 ||
        seen.has(entry.price)
      ) {
        return false;
      }
      const price = parseUnits(entry.price);
      if (previous !== null && (descending ? price >= previous : price <= previous)) {
        return false;
      }
      seen.add(entry.price);
      previous = price;
    }
    return true;
  };
  if (!validSide(candidate.bids, true) || !validSide(candidate.asks, false)) {
    return false;
  }
  // The engine never rests a crossed book: when both sides hold levels
  // the best bid stays strictly below the best ask.
  const bestBid = candidate.bids[0];
  const bestAsk = candidate.asks[0];
  if (
    bestBid !== undefined &&
    bestAsk !== undefined &&
    parseUnits(bestBid.price) >= parseUnits(bestAsk.price)
  ) {
    return false;
  }
  // `depth_levels` reports the book's true level count on the deeper
  // side before truncation: it must cover every served level and can only
  // exceed them when a side actually hit the documented cap.
  const servedLevels = Math.max(candidate.bids.length, candidate.asks.length);
  if (
    !Number.isSafeInteger(candidate.depth_levels) ||
    candidate.depth_levels < servedLevels ||
    (servedLevels < MAX_MARKET_DEPTH_LEVELS && candidate.depth_levels !== servedLevels)
  ) {
    return false;
  }
  if (candidate.last_trade !== null) {
    if (
      typeof candidate.last_trade !== "object" ||
      Array.isArray(candidate.last_trade) ||
      JSON.stringify(Object.keys(candidate.last_trade).sort()) !==
        JSON.stringify([...MARKET_LAST_TRADE_KEYS].sort()) ||
      !isScaledDecimal(candidate.last_trade.price, PRICE_SCALE) ||
      parseUnits(candidate.last_trade.price) <= 0n ||
      !isScaledDecimal(candidate.last_trade.quantity, pairDef.baseScale) ||
      parseUnits(candidate.last_trade.quantity) <= 0n ||
      !isIsoTimestamp(candidate.last_trade.executed_at)
    ) {
      return false;
    }
  }
  // A fill can only be recorded inside the replayed session: the reported
  // last trade never post-dates the snapshot close.
  return (
    isIsoTimestamp(candidate.as_of) &&
    (candidate.last_trade === null ||
      Date.parse(candidate.last_trade.executed_at) <= Date.parse(candidate.as_of))
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
  // An order id is minted once per submission: a repeated id means two
  // rows claiming one order record.
  return (
    candidate.orders.every(validOrder) &&
    new Set(candidate.orders.map((order) => order.order_id)).size === candidate.orders.length
  );
}

/**
 * Fail-closed member-read check: every list-row constraint holds (the
 * shared fields carry the same semantics — the "open" remainder, the
 * amounts recomputation, the created/updated coherence), the status
 * vocabulary extends to "filled", and `fills` recomputes against the
 * recorded execution — ids unique trd_* digests, quantities/price at the
 * pair and price scales, stamps inside the order's lifetime, the legs
 * summing to the executed quantity exactly when the status is "filled",
 * and a market order's displayed price exactly its fills' VWAP.
 *
 * @param {unknown} detail
 */
export function validExchangeOrderDetailView(detail) {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return false;
  }
  const candidate = /** @type {ExchangeOrderDetailView} */ (detail);
  if (JSON.stringify(Object.keys(detail).sort()) !== JSON.stringify([...DETAIL_KEYS].sort())) {
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
    !ORDER_DETAIL_STATUSES.includes(candidate.status) ||
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
  // still stamps its acceptance while a terminal order updates at or
  // after creation — a "filled" order's last leg IS its terminal update.
  if (updated < created || (candidate.status === "open" && updated !== created)) {
    return false;
  }
  if (!Array.isArray(candidate.fills)) {
    return false;
  }
  const legIds = new Set();
  let executedUnits = 0n;
  for (const leg of candidate.fills) {
    if (leg === null || typeof leg !== "object" || Array.isArray(leg)) {
      return false;
    }
    const fill = /** @type {ExchangeOrderFillView} */ (leg);
    if (JSON.stringify(Object.keys(leg).sort()) !== JSON.stringify([...FILL_KEYS].sort())) {
      return false;
    }
    if (
      !TRADE_ID_PATTERN.test(fill.fill_id) ||
      !TRADE_LIQUIDITIES.includes(fill.liquidity) ||
      !isScaledDecimal(fill.price, PRICE_SCALE) ||
      !isScaledDecimal(fill.quantity, pairDef.baseScale) ||
      !isIsoTimestamp(fill.executed_at) ||
      legIds.has(fill.fill_id)
    ) {
      return false;
    }
    const executed = Date.parse(fill.executed_at);
    // A leg can never precede acceptance; once the order is terminal no
    // leg lands after the terminal stamp. A resting order's legs are the
    // exception to the latter: fills keep landing on an open remainder
    // while updated_at stays pinned to acceptance.
    if (
      executed < created ||
      (candidate.status !== "open" && executed > updated) ||
      parseUnits(fill.price) <= 0n ||
      parseUnits(fill.quantity) <= 0n
    ) {
      return false;
    }
    legIds.add(fill.fill_id);
    executedUnits += parseUnits(fill.quantity);
  }
  const baseUnits = parseUnits(candidate.base_amount);
  // A filled detail reports the placed quantity as base_amount, so its
  // legs must recompute that execution exactly; any other status keeps
  // base_amount on the never-executed remainder and places no sum
  // constraint on its (possibly empty) legs.
  if (candidate.status === "filled" && (candidate.fills.length === 0 || executedUnits !== baseUnits)) {
    return false;
  }
  // A market order's displayed price is its legs' exact volume-weighted
  // average — the same recomputation the projection performs.
  if (candidate.order_type === "market" && candidate.fills.length > 0) {
    const vwap = divideRounded(
      candidate.fills.reduce((sum, fill) => sum + parseUnits(fill.quantity) * parseUnits(fill.price), 0n),
      executedUnits,
      "half_even"
    );
    if (decimal(vwap, PRICE_SCALE) !== candidate.price) {
      return false;
    }
  }
  // Fail closed unless every derived amount recomputes exactly like the
  // simulator's quote arithmetic at the order's fixed price.
  const recomputed = computeAmounts(
    pairDef,
    candidate.side,
    baseUnits,
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

/** @returns {ExchangeOrderDirectory} */
export function createSyntheticExchangeOrderDirectory() {
  // No per-subject memo or retained engine: each read rebuilds the whole
  // scenario projection — a retained engine or cache would grow without
  // bound across distinct subjects (the audit pins exactly that).
  return Object.freeze({
    async listFor(subject) {
      const scenario = exchangeOrderScenario(subject);
      const engine = replayExchangeOrderScenario(scenario);
      const orders = Object.freeze(projectExchangeOrders(engine, scenario.intents).slice().reverse());
      return Object.freeze({ mode: "test", orders });
    },
    async orderFor(subject, orderId) {
      // Same request-scoped invariant as listFor: the member read rebuilds
      // the subject's scenario on a fresh engine and projects the single
      // order — a foreign id simply has no intent to project, so the null
      // answer never leaks existence across subjects.
      const scenario = exchangeOrderScenario(subject);
      const engine = replayExchangeOrderScenario(scenario);
      return projectExchangeOrderDetail(engine, scenario.intents, orderId);
    }
  });
}

/** @returns {TradeDirectory} */
export function createSyntheticTradeDirectory() {
  // Same request-scoped invariant as the orders directory: each read
  // rebuilds the subject's scenario on a fresh engine and projects its
  // fills — nothing is retained across subjects or calls.
  return Object.freeze({
    async listFor(subject) {
      const scenario = exchangeOrderScenario(subject);
      const engine = replayExchangeOrderScenario(scenario);
      const trades = Object.freeze(projectExchangeTrades(engine, scenario.intents).slice().reverse());
      return Object.freeze({ mode: "test", trades });
    }
  });
}

/** @returns {MarketDirectory} */
export function createSyntheticMarketDirectory() {
  // Same request-scoped invariant as the orders and trades directories:
  // each read rebuilds the subject's scenario on a fresh engine and
  // projects its book state — nothing is retained across subjects or
  // calls (the cross-directory audit pins exactly that).
  return Object.freeze({
    async listFor(subject) {
      const scenario = exchangeOrderScenario(subject);
      const engine = replayExchangeOrderScenario(scenario);
      const markets = projectExchangeMarkets(engine, scenario);
      return Object.freeze({ mode: "test", markets });
    },
    async depthFor(subject, instrument) {
      // Same request-scoped invariant as listFor and the order member
      // read: the depth ladder is a fourth projection of the identical
      // replay — a foreign instrument simply has no pair to project, so
      // the null answer never leaks existence across the universe.
      const scenario = exchangeOrderScenario(subject);
      const engine = replayExchangeOrderScenario(scenario);
      return projectExchangeMarketDepth(engine, scenario, instrument);
    }
  });
}
