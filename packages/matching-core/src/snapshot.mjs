import { createOrderBook } from "./book.mjs";
import { formatScaledDecimal, isScaledDecimal, parseScaledDecimal } from "./decimal.mjs";
import { assertEpochSeconds } from "./deterministic.mjs";
import { isOrderId, isOwner, isSide } from "./events.mjs";
import { instrumentIndex, validInstrumentDefinition } from "./instruments.mjs";

/**
 * Input snapshotting, mirroring packages/financial-core/src/ledger.mjs and
 * custody-core entry points: values crossing the engine boundary are
 * structured-cloned before validation so getter or Proxy tricks cannot
 * change a field between checks and use.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function snapshotPlainData(value) {
  try {
    return structuredClone(value);
  } catch {
    throw new TypeError("input must be plain structured-cloneable data");
  }
}

/**
 * Canonical engine snapshots are plain data — the whole engine state as
 * strings and numbers, so a snapshot JSON round-trips losslessly. The format
 * is versioned; only `kind`/`version` pairs this module writes are accepted
 * back.
 */

export const SNAPSHOT_KIND = "matching-engine-snapshot";
export const SNAPSHOT_VERSION = 1;

const SNAPSHOT_KEYS = JSON.stringify(
  ["kind", "version", "instruments", "orders", "resting", "next_seq", "next_fill", "last_at"].sort(),
);
const SNAPSHOT_ORDER_KEYS = JSON.stringify(
  ["instrument", "order_id", "owner", "price", "quantity", "remaining", "side", "state"].sort(),
);
const TRACKED_STATES = Object.freeze(["resting", "filled", "cancelled", "rejected"]);
/**
 * Minimum events one tracked order provably consumed, by state: `resting` and
 * `filled` each take an `accepted` plus one terminal event, `cancelled` also
 * went through `resting`, and `rejected` took `accepted` plus the rejection.
 * Rejections of never-accepted submissions are invisible here, so this is a
 * floor, never an exact count.
 */
const MIN_EVENTS_PER_STATE = { resting: 2, filled: 2, cancelled: 3, rejected: 2 };

/**
 * @typedef {import("./book.mjs").RestingOrder} RestingOrder
 * @typedef {import("./engine.mjs").TrackedOrder} TrackedOrder
 * @typedef {import("./instruments.mjs").InstrumentDefinition} InstrumentDefinition
 *
 * @typedef {object} SnapshotOrder Canonical tracked-order record.
 * @property {string} order_id
 * @property {string} instrument
 * @property {"buy" | "sell"} side
 * @property {string | null} owner `null` where the engine keeps `undefined`.
 * @property {string} price Canonical exact-scale price.
 * @property {string} quantity Canonical exact-scale original quantity.
 * @property {string} remaining Canonical exact-scale remaining quantity.
 * @property {"resting" | "filled" | "cancelled" | "rejected"} state
 *
 * @typedef {object} EngineSnapshot
 * @property {"matching-engine-snapshot"} kind
 * @property {1} version
 * @property {InstrumentDefinition[]} instruments Engine instrument registry.
 * @property {SnapshotOrder[]} orders Every tracked order in acceptance order.
 * @property {string[]} resting Resting order ids in book-insertion order.
 * @property {number} next_seq Next un-emitted event sequence.
 * @property {number} next_fill Next un-issued fill counter.
 * @property {number | null} last_at Epoch seconds of the last stamp, `null` before any event.
 */

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
  }
  return Object.freeze(value);
}

/**
 * @param {string} reason
 * @returns {never}
 */
function invalid(reason) {
  throw new TypeError(`invalid engine snapshot: ${reason}`);
}

/**
 * Serializes live engine internals to the canonical snapshot. The output is
 * deep-frozen and JSON round-trips: `JSON.parse(JSON.stringify(x))` is
 * `deepEqual` to `x`.
 *
 * @param {{ index: ReadonlyMap<string, InstrumentDefinition>, tracked: ReadonlyMap<string, TrackedOrder>, nextSeq: number, nextFill: number, lastAt: number }} state
 * @returns {EngineSnapshot}
 */
export function canonicalEngineSnapshot({ index, tracked, nextSeq, nextFill, lastAt }) {
  /** @type {SnapshotOrder[]} */
  const orders = [];
  /** @type {string[]} */
  const resting = [];
  for (const entry of tracked.values()) {
    const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
    orders.push({
      order_id: entry.order_id,
      instrument: entry.instrument,
      side: entry.side,
      owner: entry.owner ?? null,
      price: entry.price,
      quantity: entry.quantity,
      remaining: formatScaledDecimal(entry.remaining_units, definition.base_scale),
      state: entry.state,
    });
    if (entry.state === "resting") {
      resting.push(entry.order_id);
    }
  }
  return /** @type {EngineSnapshot} */ (
    deepFreeze({
      kind: SNAPSHOT_KIND,
      version: SNAPSHOT_VERSION,
      instruments: [...index.values()].map((definition) => ({ ...definition })),
      orders,
      resting,
      next_seq: nextSeq,
      next_fill: nextFill,
      last_at: lastAt < 0 ? null : lastAt,
    })
  );
}

/**
 * Validates a canonical engine snapshot fail-closed and returns a fresh
 * deep-frozen copy. Anything that does not look exactly like
 * `engine.snapshot()` output — wrong types, unknown keys, duplicate resting
 * ids, a resting order missing from tracked state, resting order out of book
 * order, or counters that could not have produced the recorded state — is
 * rejected with a TypeError.
 *
 * @param {unknown} snapshot
 * @returns {EngineSnapshot}
 */
export function parseEngineSnapshot(snapshot) {
  const cloned = snapshotPlainData(snapshot);
  if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
    invalid("must be a plain object");
  }
  const candidate = /** @type {Record<string, unknown>} */ (cloned);
  if (JSON.stringify(Object.keys(candidate).sort()) !== SNAPSHOT_KEYS) {
    invalid("unexpected snapshot keys");
  }
  if (candidate.kind !== SNAPSHOT_KIND) {
    invalid("kind must be matching-engine-snapshot");
  }
  if (candidate.version !== SNAPSHOT_VERSION) {
    invalid("unsupported snapshot version");
  }

  if (!Array.isArray(candidate.instruments)) {
    invalid("instruments must be an array");
  }
  /** @type {Map<string, InstrumentDefinition>} */
  const index = new Map();
  for (const definition of candidate.instruments) {
    if (!validInstrumentDefinition(definition)) {
      invalid("instrument definitions must be well-formed BASE/QUOTE pairs");
    }
    const { instrument } = /** @type {InstrumentDefinition} */ (definition);
    if (index.has(instrument)) {
      invalid(`duplicate instrument definition: ${instrument}`);
    }
    index.set(instrument, /** @type {InstrumentDefinition} */ (definition));
  }

  if (!Array.isArray(candidate.orders)) {
    invalid("orders must be an array");
  }
  /** @type {Map<string, { order: SnapshotOrder, remaining_units: bigint, quantity_units: bigint }>} */
  const tracked = new Map();
  /** @type {string[]} */
  const restingExpected = [];
  for (const record of candidate.orders) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      invalid("each order must be a plain object");
    }
    const order = /** @type {Record<string, unknown>} */ (record);
    if (JSON.stringify(Object.keys(order).sort()) !== SNAPSHOT_ORDER_KEYS) {
      invalid(`order ${String(order.order_id)}: unexpected keys`);
    }
    if (!isOrderId(order.order_id)) {
      invalid("order id must match ord_[0-9a-f]{24}");
    }
    if (tracked.has(order.order_id)) {
      invalid(`duplicate order id: ${order.order_id}`);
    }
    if (typeof order.instrument !== "string") {
      invalid(`order ${order.order_id}: invalid instrument`);
    }
    const definition = index.get(order.instrument);
    if (definition === undefined) {
      invalid(`order ${order.order_id}: unknown instrument`);
    }
    if (!isSide(order.side)) {
      invalid(`order ${order.order_id}: invalid side`);
    }
    if (order.owner !== null && !isOwner(order.owner)) {
      invalid(`order ${order.order_id}: invalid owner`);
    }
    if (!isScaledDecimal(order.price, definition.price_scale)) {
      invalid(`order ${order.order_id}: invalid price`);
    }
    const priceUnits = parseScaledDecimal(order.price, definition.price_scale);
    if (priceUnits === 0n) {
      invalid(`order ${order.order_id}: non-positive price`);
    }
    if (!isScaledDecimal(order.quantity, definition.base_scale)) {
      invalid(`order ${order.order_id}: invalid quantity`);
    }
    const quantityUnits = parseScaledDecimal(order.quantity, definition.base_scale);
    if (quantityUnits === 0n) {
      invalid(`order ${order.order_id}: non-positive quantity`);
    }
    if (!isScaledDecimal(order.remaining, definition.base_scale)) {
      invalid(`order ${order.order_id}: invalid remaining`);
    }
    const remainingUnits = parseScaledDecimal(order.remaining, definition.base_scale);
    if (remainingUnits > quantityUnits) {
      invalid(`order ${order.order_id}: remaining exceeds quantity`);
    }
    if (!TRACKED_STATES.includes(/** @type {string} */ (order.state))) {
      invalid(`order ${order.order_id}: unknown state`);
    }
    if (
      (order.state === "filled" || order.state === "cancelled") &&
      remainingUnits !== 0n
    ) {
      invalid(`order ${order.order_id}: ${order.state} must have zero remaining`);
    }
    if (
      (order.state === "resting" || order.state === "rejected") &&
      remainingUnits === 0n
    ) {
      invalid(`order ${order.order_id}: ${order.state} must have positive remaining`);
    }
    const snapshotOrder = /** @type {SnapshotOrder} */ (order);
    tracked.set(order.order_id, {
      order: snapshotOrder,
      remaining_units: remainingUnits,
      quantity_units: quantityUnits,
    });
    if (order.state === "resting") {
      restingExpected.push(order.order_id);
    }
  }

  if (!Array.isArray(candidate.resting)) {
    invalid("resting must be an array");
  }
  const resting = /** @type {unknown[]} */ (candidate.resting);
  if (resting.length !== restingExpected.length) {
    invalid("resting list does not match resting tracked orders");
  }
  const seenResting = new Set();
  for (const [position, orderId] of resting.entries()) {
    if (!isOrderId(orderId)) {
      invalid("resting entries must be order ids");
    }
    if (seenResting.has(orderId)) {
      invalid(`duplicate resting order id: ${orderId}`);
    }
    seenResting.add(orderId);
    if (!tracked.has(orderId)) {
      invalid(`resting order ${orderId} is not tracked`);
    }
    if (orderId !== restingExpected[position]) {
      invalid("resting list is not in book-insertion order");
    }
  }

  if (!Number.isSafeInteger(candidate.next_seq) || /** @type {number} */ (candidate.next_seq) < 1) {
    invalid("next_seq must be a positive integer");
  }
  if (!Number.isSafeInteger(candidate.next_fill) || /** @type {number} */ (candidate.next_fill) < 1) {
    invalid("next_fill must be a positive integer");
  }
  if (candidate.last_at !== null) {
    try {
      assertEpochSeconds(candidate.last_at, "last_at");
    } catch {
      invalid("last_at must be null or integer epoch seconds");
    }
  }
  let minimumSeq = 1;
  let touched = 0;
  for (const { order, remaining_units, quantity_units } of tracked.values()) {
    minimumSeq += MIN_EVENTS_PER_STATE[order.state];
    if (order.state !== "cancelled" && remaining_units < quantity_units) {
      touched += 1;
    }
  }
  if (/** @type {number} */ (candidate.next_seq) < minimumSeq) {
    invalid("next_seq is below what the recorded orders must have emitted");
  }
  if (/** @type {number} */ (candidate.next_fill) < Math.ceil(touched / 2) + 1) {
    invalid("next_fill is below what the recorded orders must have executed");
  }
  return /** @type {EngineSnapshot} */ (deepFreeze(candidate));
}

/**
 * Rebuilds live engine internals from a canonical snapshot produced by
 * {@link parseEngineSnapshot}. Resting orders re-enter their books in the
 * recorded insertion order, so level queues — and therefore every
 * `bookSnapshot` — come out byte-identical.
 *
 * @param {EngineSnapshot} canonical
 * @returns {{ index: ReadonlyMap<string, InstrumentDefinition>, books: Map<string, ReturnType<typeof createOrderBook>>, tracked: Map<string, TrackedOrder>, nextSeq: number, nextFill: number, lastAt: number }}
 */
export function hydrateEngineState(canonical) {
  const index = instrumentIndex(canonical.instruments);
  /** @type {Map<string, ReturnType<typeof createOrderBook>>} */
  const books = new Map();
  /** @type {Map<string, TrackedOrder>} */
  const tracked = new Map();
  for (const order of canonical.orders) {
    const definition = /** @type {InstrumentDefinition} */ (index.get(order.instrument));
    tracked.set(order.order_id, {
      order_id: order.order_id,
      instrument: order.instrument,
      side: order.side,
      owner: order.owner ?? undefined,
      price: order.price,
      price_units: parseScaledDecimal(order.price, definition.price_scale),
      quantity: order.quantity,
      quantity_units: parseScaledDecimal(order.quantity, definition.base_scale),
      remaining_units: parseScaledDecimal(order.remaining, definition.base_scale),
      state: order.state,
    });
  }
  for (const orderId of canonical.resting) {
    const entry = /** @type {TrackedOrder} */ (tracked.get(orderId));
    const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
    let book = books.get(entry.instrument);
    if (book === undefined) {
      book = createOrderBook(entry.instrument, definition.base_scale, definition.price_scale);
      books.set(entry.instrument, book);
    }
    book.addResting(/** @type {RestingOrder} */ (entry));
  }
  return {
    index,
    books,
    tracked,
    nextSeq: canonical.next_seq,
    nextFill: canonical.next_fill,
    lastAt: canonical.last_at ?? -1,
  };
}
