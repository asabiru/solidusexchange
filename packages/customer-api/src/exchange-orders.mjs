import { createHash } from "node:crypto";
import {
  createMatchingEngine,
  createSimulatedClock,
  INSTRUMENTS
} from "../../matching-core/src/index.mjs";

// Deterministic synthetic exchange-order source. A future exchange adapter
// replaces it behind `listFor(subject) -> Promise<ExchangeOrdersView>`;
// payloads are frozen and derived from the subject only, so reads stay
// reproducible. Each view is a projection of a REAL matching engine:
// `exchangeOrderScenario(subject)` derives a deterministic market scenario
// (the subject's own submissions plus deterministic counterparty liquidity
// — the sweeps that rest, partially fill, exhaust or leave gaps), a fresh
// `createMatchingEngine` replays it inside the call, and
// `projectExchangeOrders` folds the journal and tracked-order state into
// the contract rows — no row is hand-written fixture data. The engine
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
// every checkout and is allowlisted in scripts/check-boundary.mjs.
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
 * @typedef {object} ExchangeOrderDirectory
 * @property {(subject: string) => Promise<ExchangeOrdersView>} listFor
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
 * @property {{ quantityUnits: bigint, priceUnits: bigint }[]} fills This
 *   order's own fill legs — the VWAP source for a market order's price.
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
    } else {
      engine.cancelOrder(step.instrument, step.order_id);
    }
  }
  return engine;
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
        trail.fills.push({ quantityUnits: parseUnits(fields.quantity), priceUnits: parseUnits(fields.price) });
      }
    } else if (event.type === "cancelled" || event.type === "rejected") {
      trail.terminalAt = event.at;
      trail.terminalQuantity = typeof fields.quantity === "string" ? fields.quantity : null;
    }
  }

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
  // No per-subject memo or retained engine: each read rebuilds the whole
  // scenario projection — a retained engine or cache would grow without
  // bound across distinct subjects (the audit pins exactly that).
  return Object.freeze({
    async listFor(subject) {
      const scenario = exchangeOrderScenario(subject);
      const engine = replayExchangeOrderScenario(scenario);
      const orders = Object.freeze(projectExchangeOrders(engine, scenario.intents).slice().reverse());
      return Object.freeze({ mode: "test", orders });
    }
  });
}
