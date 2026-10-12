import { createOrderBook } from "./book.mjs";
import { formatScaledDecimal, isScaledDecimal, parseScaledDecimal } from "./decimal.mjs";
import { createSimulatedClock, fromIsoSeconds } from "./deterministic.mjs";
import { createMatchingEngineFromState } from "./engine.mjs";
import {
  EVENT_TYPES,
  FILL_ID_PATTERN,
  isOrderId,
  isOwner,
  isSide,
  POSTING,
  REJECT_REASONS,
} from "./events.mjs";
import { INSTRUMENTS, instrumentIndex } from "./instruments.mjs";
import { validJournalStore } from "./journal-store.mjs";
import {
  hydrateEngineState,
  parseEngineSnapshot,
  SNAPSHOT_KIND,
  SNAPSHOT_VERSION,
  snapshotPlainData,
} from "./snapshot.mjs";

/**
 * Journal replay and snapshot restore: the read path of the persistence
 * groundwork. Both rebuild an engine-equivalent state from recorded data —
 * `replayMatchingEngine` folds the emitted event stream, `restoreMatchingEngine`
 * rehydrates a canonical snapshot — and both stay pure data: no ledger, no
 * postings, no I/O.
 *
 * A stream is accepted only if it is a prefix the real engine could have
 * emitted: contiguous `seq` from 1, non-decreasing canonical timestamps,
 * known event types and fields only, fill pairs consecutive maker-then-taker
 * with sequentially numbered fill ids, every referenced order accepted by
 * the stream, `amended` events only on resting orders whose recorded
 * previous values match the tracked state, and fill/cancel arithmetic
 * matching the tracked remainder. Anything else throws `TypeError` with an
 * `invalid event stream:` reason.
 *
 * The two recovery paths compose: `replayMatchingEngine` accepts a `base`
 * — a canonical snapshot taken at a journal boundary — and folds the
 * journal tail `snapshot.next_seq..M` onto it, so
 * `snapshot(N)` + `replay(journal[N+1..M], base)` produces exactly the
 * engine the full replay produces. The fold grammar is unchanged; the
 * snapshot simply seeds the state the prefix would have built — the
 * tracked-order trail, the books with intra-level FIFO intact, and the
 * `seq`/`fill_id`/`at` counters the tail must continue without a gap or
 * overlap. Because a snapshot can only land on an operation boundary, the
 * base's in-flight state is always empty: the tail's first event must open
 * a new operation, never continue one mid-flight.
 *
 * @typedef {import("./book.mjs").RestingOrder} RestingOrder
 * @typedef {import("./deterministic.mjs").SimulatedClock} SimulatedClock
 * @typedef {import("./engine.mjs").TrackedOrder} TrackedOrder
 * @typedef {import("./events.mjs").MatchingEvent} MatchingEvent
 * @typedef {import("./instruments.mjs").InstrumentDefinition} InstrumentDefinition
 * @typedef {import("./journal-store.mjs").MatchingJournalStore} MatchingJournalStore
 * @typedef {import("./snapshot.mjs").EngineSnapshot} EngineSnapshot
 */

const MAX_FILL_NUMBER = BigInt(Number.MAX_SAFE_INTEGER - 1);

/** @type {Record<MatchingEvent["type"], Set<string>>} */
const EVENT_KEYS = {
  accepted: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "order_type", "owner", "price", "quantity"]),
  resting: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "price", "quantity"]),
  partially_filled: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "fill_id", "maker_order_id", "taker_order_id", "price", "quantity", "remaining_quantity"]),
  filled: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "fill_id", "maker_order_id", "taker_order_id", "price", "quantity", "remaining_quantity"]),
  cancelled: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "price", "quantity"]),
  amended: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "previous_price", "previous_quantity", "price", "quantity"]),
  rejected: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "reason", "quantity"]),
};

/**
 * @param {string} reason
 * @returns {never}
 */
function invalid(reason) {
  throw new TypeError(`invalid event stream: ${reason}`);
}

/**
 * @param {unknown} value
 * @param {string} reason
 * @returns {asserts value is Record<string, unknown>}
 */
function requireObject(value, reason) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(reason);
  }
}

/**
 * @param {unknown} options
 * @param {string[]} allowed
 * @returns {Record<string, unknown>}
 */
function plainOptions(options, allowed) {
  if (options === undefined) {
    return {};
  }
  requireObject(options, "options must be a plain object");
  const candidate = /** @type {Record<string, unknown>} */ (options);
  for (const key of Object.keys(candidate)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`unknown option: ${key}`);
    }
  }
  return candidate;
}

/**
 * @param {unknown} clock
 * @returns {SimulatedClock | undefined}
 */
function validClock(clock) {
  if (clock === undefined) {
    return undefined;
  }
  if (
    clock === null ||
    typeof clock !== "object" ||
    typeof (/** @type {SimulatedClock} */ (clock).now) !== "function"
  ) {
    throw new TypeError("clock must be an object with a now() function");
  }
  return /** @type {SimulatedClock} */ (clock);
}

/**
 * Rebuilds an engine-equivalent state by folding a recorded event stream —
 * typically another engine's `journal()`. `submitOrder`/`cancelOrder` are
 * never re-run; each event's recorded effect is applied verbatim, so the
 * replayed engine's `bookSnapshot`/`orderStatus` come out identical to the
 * source's for every touched order and instrument.
 *
 * The folded result is pushed through the canonical snapshot validator and
 * hydrator — the same code path `restoreMatchingEngine` uses — so replay and
 * restore cannot disagree. The replayed engine's own `journal()` returns the
 * folded events; submitting afterwards continues `seq`/`fill_id` numbering
 * where the stream ended.
 *
 * With `base` — a canonical snapshot produced by `engine.snapshot()` — the
 * stream is the tail `base.next_seq..`: the fold resumes the tracked state,
 * books and counters the snapshot recorded instead of starting empty. Every
 * stream rule then applies across the seam: the tail's first seq must be
 * `base.next_seq` (a gap or an overlap fails like a broken stream), its
 * fills continue `fill_id` numbering from `base.next_fill`, its timestamps
 * continue from `base.last_at`, and mid-invariants like "an order is in
 * flight" or "a rejection must be earned" are decided against the snapshot's
 * state. `base` and `instruments` are mutually exclusive — the snapshot
 * already carries its registry.
 *
 * @param {{ instruments?: InstrumentDefinition[], events?: readonly MatchingEvent[], clock?: SimulatedClock, journalStore?: MatchingJournalStore, base?: EngineSnapshot }} [options]
 */
export function replayMatchingEngine(options = {}) {
  const candidate = plainOptions(options, ["instruments", "events", "clock", "journalStore", "base"]);
  if (candidate.instruments !== undefined && !Array.isArray(candidate.instruments)) {
    throw new TypeError("instruments must be an array of instrument definitions");
  }
  const base =
    candidate.base === undefined ? undefined : parseEngineSnapshot(candidate.base);
  if (base !== undefined && candidate.instruments !== undefined) {
    throw new TypeError("a snapshot base carries its own instrument registry");
  }
  const baseState = base === undefined ? undefined : hydrateEngineState(base);
  const index =
    baseState === undefined
      ? instrumentIndex(
          /** @type {InstrumentDefinition[] | undefined} */ (candidate.instruments) ?? INSTRUMENTS,
        )
      : baseState.index;
  const clock = validClock(candidate.clock);
  const journalStore =
    candidate.journalStore === undefined ? undefined : validJournalStore(candidate.journalStore);
  const events = snapshotPlainData(candidate.events);
  if (!Array.isArray(events)) {
    invalid("events must be an array");
  }

  /** @type {Map<string, TrackedOrder>} */
  const tracked = baseState?.tracked ?? new Map();
  /** @type {Map<string, ReturnType<typeof createOrderBook>>} */
  const books = baseState?.books ?? new Map();
  /** @type {Set<string>} */
  const inBook = new Set(base === undefined ? [] : base.resting);
  /** @type {MatchingEvent[]} */
  const journal = [];
  /** @type {{ fill_id: string, maker_order_id: string, taker_order_id: string, quantity: unknown } | null} */
  let pendingMaker = null;
  let expectedSeq = base === undefined ? 1 : base.next_seq;
  let lastAt = base === undefined ? -1 : base.last_at ?? -1;
  let lastFill = base === undefined ? 0n : BigInt(base.next_fill) - 1n;
  // The order inside an unfinished operation — accepted or re-queued by an
  // amendment and not yet resolved by `resting`, a terminal `rejected`, or
  // the taker event of its final fill. `null` on an operation boundary.
  /** @type {string | null} */
  let inFlight = null;
  // The live engine stamps every event of one operation with a single
  // `now` read (beginOperation), so all events inside an operation share
  // `at`; each boundary resets it. `null` before the first event.
  /** @type {number | null} */
  let opAt = null;

  /**
   * @param {string} instrument
   */
  function bookFor(instrument) {
    let book = books.get(instrument);
    if (book === undefined) {
      const definition = /** @type {InstrumentDefinition} */ (index.get(instrument));
      book = createOrderBook(instrument, definition.base_scale, definition.price_scale);
      books.set(instrument, book);
    }
    return book;
  }

  /**
   * Parses a decimal field the live engine emitted: the string must be the
   * exact-scale canonical form `formatScaledDecimal` produces, not merely a
   * valid decimal.
   *
   * @param {unknown} value
   * @param {string} label
   * @param {number} scale
   * @returns {bigint}
   */
  function unitsOf(value, label, scale) {
    if (!isScaledDecimal(value, scale)) {
      invalid(`${label} must be a canonical decimal at scale ${scale}`);
    }
    const units = parseScaledDecimal(value, scale);
    if (value !== formatScaledDecimal(units, scale)) {
      invalid(`${label} must be in exact-scale form`);
    }
    return units;
  }

  /**
   * @param {Record<string, unknown>} event
   * @param {MatchingEvent["type"]} type
   */
  function checkKeys(event, type) {
    const allowed = EVENT_KEYS[type];
    for (const key of Object.keys(event)) {
      if (!allowed.has(key)) {
        invalid(`event seq ${event.seq}: unexpected key ${key} on ${type}`);
      }
    }
  }

  /**
   * @param {Record<string, unknown>} event
   * @returns {TrackedOrder}
   */
  function trackedOrder(event) {
    if (!isOrderId(event.order_id)) {
      invalid(`event seq ${event.seq}: invalid order id`);
    }
    const entry = tracked.get(event.order_id);
    if (entry === undefined) {
      invalid(`event seq ${event.seq}: order was never accepted`);
    }
    if (entry.instrument !== event.instrument || entry.side !== event.side) {
      invalid(`event seq ${event.seq}: instrument or side does not match the accepted order`);
    }
    return entry;
  }

  /**
   * Folds one `filled`/`partially_filled` event. The stream pins the live
   * emission order: each execution writes the maker's event first, then the
   * taker's, sharing one sequentially numbered `fill_id`.
   *
   * @param {Record<string, unknown>} event
   */
  function foldFill(event) {
    if (typeof event.fill_id !== "string" || !FILL_ID_PATTERN.test(event.fill_id)) {
      invalid(`event seq ${event.seq}: invalid fill id`);
    }
    const fillNumber = BigInt(`0x${event.fill_id.slice(4)}`);
    if (!isOrderId(event.maker_order_id) || !isOrderId(event.taker_order_id)) {
      invalid(`event seq ${event.seq}: invalid maker or taker order id`);
    }
    if (event.maker_order_id === event.taker_order_id) {
      invalid(`event seq ${event.seq}: fill maker and taker are the same order`);
    }
    const maker = tracked.get(event.maker_order_id);
    const taker = tracked.get(event.taker_order_id);
    if (maker === undefined || taker === undefined) {
      invalid(`event seq ${event.seq}: fill references an order the stream never accepted`);
    }
    if (event.taker_order_id !== inFlight) {
      invalid(`event seq ${event.seq}: fill pair taker is not the in-flight order`);
    }
    if (maker.instrument !== event.instrument || taker.instrument !== event.instrument) {
      invalid(`event seq ${event.seq}: fill instrument does not match its orders`);
    }
    if (maker.side === taker.side) {
      invalid(`event seq ${event.seq}: fill maker and taker share a side`);
    }
    if (event.price !== maker.price) {
      invalid(`event seq ${event.seq}: fill price is not the maker's resting price`);
    }
    const definition = /** @type {InstrumentDefinition} */ (index.get(maker.instrument));
    const executed = unitsOf(event.quantity, "fill quantity", definition.base_scale);
    if (executed === 0n) {
      invalid(`event seq ${event.seq}: non-positive fill quantity`);
    }
    const remainder = unitsOf(event.remaining_quantity, "fill remaining", definition.base_scale);
    if (event.type === "filled" && remainder !== 0n) {
      invalid(`event seq ${event.seq}: filled must end at zero remaining`);
    }
    if (event.type === "partially_filled" && remainder === 0n) {
      invalid(`event seq ${event.seq}: partially_filled must keep a remainder`);
    }

    if (pendingMaker === null) {
      if (event.order_id !== maker.order_id) {
        invalid(`event seq ${event.seq}: a fill pair must start with the maker event`);
      }
      if (fillNumber !== lastFill + 1n) {
        invalid(`event seq ${event.seq}: fill ids must be sequential`);
      }
      if (fillNumber > MAX_FILL_NUMBER) {
        invalid(`event seq ${event.seq}: fill counter exceeds the supported range`);
      }
      if (maker.state !== "resting" || !inBook.has(maker.order_id)) {
        invalid(`event seq ${event.seq}: maker is not resting`);
      }
      if (bookFor(maker.instrument).bestHead(maker.side) !== maker) {
        invalid(`event seq ${event.seq}: maker is not at the head of the best level`);
      }
      if (
        taker.order_type === "limit" &&
        (taker.side === "buy"
          ? /** @type {bigint} */ (taker.price_units) < /** @type {bigint} */ (maker.price_units)
          : /** @type {bigint} */ (taker.price_units) > /** @type {bigint} */ (maker.price_units))
      ) {
        invalid(`event seq ${event.seq}: fill price is outside the taker's limit`);
      }
      pendingMaker = {
        fill_id: event.fill_id,
        maker_order_id: maker.order_id,
        taker_order_id: taker.order_id,
        quantity: event.quantity,
      };
      lastFill = fillNumber;
    } else {
      if (
        event.order_id !== pendingMaker.taker_order_id ||
        event.maker_order_id !== pendingMaker.maker_order_id ||
        event.taker_order_id !== pendingMaker.taker_order_id ||
        event.fill_id !== pendingMaker.fill_id ||
        event.quantity !== pendingMaker.quantity
      ) {
        invalid(`event seq ${event.seq}: a fill pair must end with the matching taker event`);
      }
      if (taker.state !== "resting" || inBook.has(taker.order_id)) {
        invalid(`event seq ${event.seq}: taker is not in flight`);
      }
      pendingMaker = null;
    }
    const entry = event.order_id === maker.order_id ? maker : taker;
    if (entry.remaining_units - executed !== remainder) {
      invalid(`event seq ${event.seq}: fill arithmetic does not match the remainder`);
    }
    entry.remaining_units = remainder;
    if (remainder === 0n) {
      entry.state = "filled";
      if (inBook.delete(entry.order_id)) {
        bookFor(entry.instrument).remove(/** @type {RestingOrder} */ (entry));
      }
      if (entry === taker) {
        inFlight = null;
      }
    }
  }

  for (const record of events) {
    requireObject(record, "each event must be a plain object");
    const event = /** @type {Record<string, unknown>} */ (record);
    if (Object.getOwnPropertySymbols(record).length !== 0) {
      invalid(`event seq ${String(event.seq)}: must not carry symbol keys`);
    }
    if (event.seq !== expectedSeq) {
      invalid(
        base === undefined
          ? "seq must be contiguous from 1 with no gaps"
          : `seq must continue the snapshot at ${expectedSeq} with no gaps`,
      );
    }
    expectedSeq += 1;
    let at;
    try {
      at = fromIsoSeconds(event.at);
    } catch {
      invalid("event timestamps must be canonical ISO-8601 seconds");
    }
    if (/** @type {number} */ (at) < lastAt) {
      invalid("event timestamps must not go backwards");
    }
    lastAt = /** @type {number} */ (at);
    // Operation atomicity: on a boundary this event opens a new operation
    // and owns its stamp; mid-operation the stamp must be the operation's
    // — the live engine reads `now` once per operation.
    if (inFlight === null && pendingMaker === null) {
      opAt = at;
    } else if (at !== opAt) {
      invalid(`event seq ${event.seq}: timestamp changes inside an operation`);
    }
    if (typeof event.type !== "string" || !EVENT_TYPES.includes(/** @type {never} */ (event.type))) {
      invalid(`event seq ${event.seq}: unknown event type`);
    }
    if (event.posting !== POSTING) {
      invalid(`event seq ${event.seq}: posting must be none`);
    }
    const type = /** @type {MatchingEvent["type"]} */ (event.type);
    checkKeys(event, type);

    // While an order is in flight the stream must stay inside that
    // order's operation: the only admissible events are its fill pairs
    // (taker_order_id pins it in foldFill) and the event resolving it —
    // its `resting`, its terminal `rejected`, or the taker event of its
    // last fill. Anything else interleaves operations the live engine
    // emits atomically, so the stream is not a prefix it could produce.
    if (inFlight !== null) {
      const inFlightEvent =
        type === "filled" ||
        type === "partially_filled" ||
        (type === "resting" && event.order_id === inFlight) ||
        (type === "rejected" &&
          event.order_id === inFlight &&
          (event.reason === "self_trade" ||
            event.reason === "insufficient_liquidity"));
      if (!inFlightEvent) {
        invalid(`event seq ${event.seq}: interleaved event while an order is in flight`);
      }
    }

    switch (type) {
      case "accepted": {
        if (pendingMaker !== null) {
          invalid(`event seq ${event.seq}: event inside a fill pair`);
        }
        if (!isOrderId(event.order_id)) {
          invalid(`event seq ${event.seq}: invalid order id`);
        }
        if (tracked.has(event.order_id)) {
          invalid(`event seq ${event.seq}: duplicate accepted order id`);
        }
        if (typeof event.instrument !== "string") {
          invalid(`event seq ${event.seq}: invalid instrument`);
        }
        const definition = index.get(event.instrument);
        if (definition === undefined) {
          invalid(`event seq ${event.seq}: unknown instrument`);
        }
        if (!isSide(event.side)) {
          invalid(`event seq ${event.seq}: invalid side`);
        }
        if (event.order_type !== "limit" && event.order_type !== "market") {
          invalid(`event seq ${event.seq}: invalid order_type`);
        }
        if (event.order_type === "market" && Object.hasOwn(event, "price")) {
          invalid(`event seq ${event.seq}: market orders carry no price`);
        }
        if (event.owner !== undefined && !isOwner(event.owner)) {
          invalid(`event seq ${event.seq}: invalid owner`);
        }
        const priceUnits =
          event.order_type === "market"
            ? null
            : unitsOf(event.price, "price", definition.price_scale);
        if (priceUnits === 0n) {
          invalid(`event seq ${event.seq}: non-positive price`);
        }
        const quantityUnits = unitsOf(event.quantity, "quantity", definition.base_scale);
        if (quantityUnits === 0n) {
          invalid(`event seq ${event.seq}: non-positive quantity`);
        }
        tracked.set(event.order_id, {
          order_id: event.order_id,
          instrument: event.instrument,
          side: event.side,
          order_type: /** @type {"limit" | "market"} */ (event.order_type),
          owner: event.owner === undefined ? undefined : /** @type {string} */ (event.owner),
          price:
            priceUnits === null
              ? null
              : formatScaledDecimal(priceUnits, definition.price_scale),
          price_units: priceUnits,
          quantity: formatScaledDecimal(quantityUnits, definition.base_scale),
          quantity_units: quantityUnits,
          remaining_units: quantityUnits,
          state: "resting",
        });
        inFlight = event.order_id;
        break;
      }
      case "resting": {
        const entry = trackedOrder(event);
        if (pendingMaker !== null) {
          invalid(`event seq ${event.seq}: event inside a fill pair`);
        }
        if (entry.order_type === "market") {
          invalid(`event seq ${event.seq}: market orders never rest`);
        }
        if (entry.state !== "resting" || inBook.has(entry.order_id)) {
          invalid(`event seq ${event.seq}: order is not in flight for resting`);
        }
        if (event.price !== entry.price) {
          invalid(`event seq ${event.seq}: resting price does not match the accepted order`);
        }
        const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
        if (unitsOf(event.quantity, "resting quantity", definition.base_scale) !== entry.remaining_units) {
          invalid(`event seq ${event.seq}: resting quantity is not the tracked remainder`);
        }
        // A taker rests only after its sweep found nothing matchable: a
        // resting event that would cross the current opposite head is one
        // the live engine could never emit — the order would have filled.
        const opposite = entry.side === "buy" ? "sell" : "buy";
        const head = bookFor(entry.instrument).bestHead(opposite);
        if (
          head !== undefined &&
          (entry.side === "buy"
            ? /** @type {bigint} */ (entry.price_units) >= head.price_units
            : /** @type {bigint} */ (entry.price_units) <= head.price_units)
        ) {
          invalid(`event seq ${event.seq}: resting order would cross the book`);
        }
        inBook.add(entry.order_id);
        bookFor(entry.instrument).addResting(/** @type {RestingOrder} */ (entry));
        inFlight = null;
        break;
      }
      case "filled":
      case "partially_filled": {
        trackedOrder(event);
        foldFill(event);
        break;
      }
      case "cancelled": {
        const entry = trackedOrder(event);
        if (pendingMaker !== null) {
          invalid(`event seq ${event.seq}: event inside a fill pair`);
        }
        if (entry.state !== "resting" || !inBook.has(entry.order_id)) {
          invalid(`event seq ${event.seq}: cancelled order is not resting`);
        }
        if (event.price !== entry.price) {
          invalid(`event seq ${event.seq}: cancelled price does not match the resting order`);
        }
        const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
        if (unitsOf(event.quantity, "cancelled quantity", definition.base_scale) !== entry.remaining_units) {
          invalid(`event seq ${event.seq}: cancelled quantity is not the tracked remainder`);
        }
        inBook.delete(entry.order_id);
        bookFor(entry.instrument).remove(/** @type {RestingOrder} */ (entry));
        entry.state = "cancelled";
        entry.remaining_units = 0n;
        break;
      }
      case "amended": {
        const entry = trackedOrder(event);
        if (pendingMaker !== null) {
          invalid(`event seq ${event.seq}: event inside a fill pair`);
        }
        if (entry.state !== "resting" || !inBook.has(entry.order_id)) {
          invalid(`event seq ${event.seq}: amended order is not resting`);
        }
        if (event.previous_price !== entry.price) {
          invalid(`event seq ${event.seq}: amended previous price does not match the resting order`);
        }
        if (event.previous_quantity !== entry.quantity) {
          invalid(`event seq ${event.seq}: amended previous quantity does not match the resting order`);
        }
        const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
        const priceUnits = unitsOf(event.price, "amended price", definition.price_scale);
        if (priceUnits === 0n) {
          invalid(`event seq ${event.seq}: non-positive amended price`);
        }
        const totalUnits = unitsOf(event.quantity, "amended quantity", definition.base_scale);
        if (totalUnits === 0n) {
          invalid(`event seq ${event.seq}: non-positive amended quantity`);
        }
        const executedUnits = entry.quantity_units - entry.remaining_units;
        if (totalUnits <= executedUnits) {
          invalid(`event seq ${event.seq}: amended quantity is not above the filled amount`);
        }
        if (priceUnits === entry.price_units && totalUnits === entry.quantity_units) {
          invalid(`event seq ${event.seq}: amended event changes nothing`);
        }
        // Mirror the live priority rule: a decrease at an unchanged price
        // keeps the queue slot; a price change or an increase re-queues.
        const keepsPriority =
          priceUnits === entry.price_units && totalUnits < entry.quantity_units;
        if (!keepsPriority) {
          inBook.delete(entry.order_id);
          bookFor(entry.instrument).remove(/** @type {RestingOrder} */ (entry));
          tracked.delete(entry.order_id);
          tracked.set(entry.order_id, entry);
        }
        entry.price = formatScaledDecimal(priceUnits, definition.price_scale);
        entry.price_units = priceUnits;
        entry.quantity_units = totalUnits;
        entry.quantity = formatScaledDecimal(totalUnits, definition.base_scale);
        entry.remaining_units = totalUnits - executedUnits;
        if (!keepsPriority) {
          // Re-queued like a fresh taker: in flight until the stream
          // resolves it, exactly as the live re-match emits.
          inFlight = entry.order_id;
        }
        break;
      }
      case "rejected": {
        if (pendingMaker !== null) {
          invalid(`event seq ${event.seq}: event inside a fill pair`);
        }
        if (typeof event.reason !== "string" || !REJECT_REASONS.includes(/** @type {never} */ (event.reason))) {
          invalid(`event seq ${event.seq}: unknown reject reason`);
        }
        if (event.order_id !== null && typeof event.order_id !== "string") {
          invalid(`event seq ${event.seq}: order id must be a string or null`);
        }
        if (event.instrument !== null && typeof event.instrument !== "string") {
          invalid(`event seq ${event.seq}: instrument must be a string or null`);
        }
        if (event.side !== null && typeof event.side !== "string") {
          invalid(`event seq ${event.seq}: side must be a string or null`);
        }
        if (event.reason === "self_trade" || event.reason === "insufficient_liquidity") {
          const entry = trackedOrder(event);
          if (event.reason === "insufficient_liquidity" && entry.order_type !== "market") {
            invalid(`event seq ${event.seq}: insufficient_liquidity only rejects market orders`);
          }
          if (entry.state !== "resting" || inBook.has(entry.order_id)) {
            invalid(`event seq ${event.seq}: ${event.reason} order is not in flight`);
          }
          // A terminal rejection must be earned where it lands: the live
          // engine emits it only under the exact trigger below, so a
          // stream cannot reject a taker that would have matched or
          // rested.
          const opposite = entry.side === "buy" ? "sell" : "buy";
          const head = bookFor(entry.instrument).bestHead(opposite);
          if (event.reason === "self_trade") {
            // The live policy rejects the taker only when the head of the
            // best opposite level is matchable AND carries its owner.
            if (
              head === undefined ||
              entry.owner === undefined ||
              head.owner !== entry.owner ||
              (entry.order_type === "limit" &&
                (entry.side === "buy"
                  ? /** @type {bigint} */ (entry.price_units) < head.price_units
                  : /** @type {bigint} */ (entry.price_units) > head.price_units))
            ) {
              invalid(`event seq ${event.seq}: self_trade rejection is not earned`);
            }
          } else if (head !== undefined) {
            // A market taker is liquidity-rejected only once no opposite
            // order remains for it to match.
            invalid(`event seq ${event.seq}: insufficient_liquidity rejection is not earned`);
          }
          const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
          if (unitsOf(event.quantity, "rejected quantity", definition.base_scale) !== entry.remaining_units) {
            invalid(`event seq ${event.seq}: rejected quantity is not the tracked remainder`);
          }
          entry.state = "rejected";
          inFlight = null;
        } else if (event.quantity !== undefined) {
          invalid(`event seq ${event.seq}: only self_trade and insufficient_liquidity rejections carry a quantity`);
        } else {
          // A validation rejection must be earnable too: each reason pins
          // which echo fields the failed submission could have carried,
          // so the stream cannot record a rejection the engine never
          // emitted.
          const echoed =
            event.order_id === null
              ? undefined
              : tracked.get(/** @type {string} */ (event.order_id));
          if (event.reason === "no_change" || event.reason === "quantity_below_filled") {
            // Amend-path reasons: the target must be a resting order in
            // the book, echoed with its own instrument and side — and a
            // below-filled rejection needs something filled already.
            if (
              echoed === undefined ||
              !inBook.has(echoed.order_id) ||
              echoed.instrument !== event.instrument ||
              echoed.side !== event.side ||
              (event.reason === "quantity_below_filled" &&
                echoed.remaining_units === echoed.quantity_units)
            ) {
              invalid(`event seq ${event.seq}: ${event.reason} rejection is not earned`);
            }
          } else if (event.reason === "duplicate_order_id") {
            if (echoed === undefined) {
              invalid(`event seq ${event.seq}: duplicate_order_id rejection is not earned`);
            }
          } else if (event.reason === "order_not_resting") {
            // The id that reached the resting check was already a valid
            // pattern. The rejection is earned exactly when the order is
            // not resting in the echoed instrument's book: the live cancel
            // looks the id up in the SUBMITTED instrument only, so an
            // order resting on another instrument rejects for real.
            if (
              !isOrderId(event.order_id) ||
              (echoed !== undefined &&
                echoed.state === "resting" &&
                echoed.instrument === event.instrument)
            ) {
              invalid(`event seq ${event.seq}: order_not_resting rejection is not earned`);
            }
            // The cancel echo carries the submitted (known) instrument;
            // the amend echo carries the tracked order's instrument and
            // side. Any other combination is not emittable.
            if (event.side === null) {
              if (event.instrument !== null && !index.has(event.instrument)) {
                invalid(`event seq ${event.seq}: order_not_resting rejection is not earned`);
              }
            } else if (
              echoed === undefined ||
              echoed.instrument !== event.instrument ||
              echoed.side !== event.side
            ) {
              invalid(`event seq ${event.seq}: order_not_resting rejection is not earned`);
            }
          } else if (event.reason === "invalid_instrument") {
            if (event.instrument !== null) {
              invalid(`event seq ${event.seq}: invalid_instrument rejection is not earned`);
            }
          } else if (event.reason === "unknown_instrument") {
            if (typeof event.instrument !== "string" || index.has(event.instrument)) {
              invalid(`event seq ${event.seq}: unknown_instrument rejection is not earned`);
            }
          } else if (event.reason === "invalid_order_id") {
            if (event.order_id !== null && isOrderId(event.order_id)) {
              invalid(`event seq ${event.seq}: invalid_order_id rejection is not earned`);
            }
          } else if (event.reason === "invalid_side") {
            // The failed submission echoed whatever side it carried; its
            // order id and instrument were validated before side fired.
            if (
              !isOrderId(event.order_id) ||
              typeof event.instrument !== "string" ||
              !index.has(event.instrument)
            ) {
              invalid(`event seq ${event.seq}: invalid_side rejection is not earned`);
            }
          } else if (event.reason !== "invalid_order") {
            // invalid_owner, invalid_type, invalid_price,
            // non_positive_price, invalid_quantity,
            // non_positive_quantity: either path reached these checks
            // only after order id, instrument and side passed — the echo
            // is a valid-pattern id on a known instrument with a side.
            if (
              !isOrderId(event.order_id) ||
              typeof event.instrument !== "string" ||
              !index.has(event.instrument) ||
              !isSide(event.side)
            ) {
              invalid(`event seq ${event.seq}: ${event.reason} rejection is not earned`);
            }
          }
          // invalid_order echoes whatever string fields the raw input
          // carried — every string-or-null combination is emittable, so
          // no further pin applies.
        }
        break;
      }
    }
    journal.push(/** @type {MatchingEvent} */ (Object.freeze({ ...event })));
  }

  if (pendingMaker !== null) {
    invalid("stream ends inside a fill pair");
  }
  if (inFlight !== null) {
    invalid("stream ends mid-operation");
  }

  const resting = [...tracked.keys()].filter((orderId) => inBook.has(orderId));
  const orders = [...tracked.values()].map((entry) => {
    const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
    return {
      order_id: entry.order_id,
      instrument: entry.instrument,
      side: entry.side,
      order_type: entry.order_type,
      owner: entry.owner ?? null,
      price: entry.price,
      quantity: entry.quantity,
      remaining: formatScaledDecimal(entry.remaining_units, definition.base_scale),
      state: entry.state,
    };
  });
  let canonical;
  try {
    canonical = parseEngineSnapshot({
      kind: SNAPSHOT_KIND,
      version: SNAPSHOT_VERSION,
      instruments: [...index.values()].map((definition) => ({ ...definition })),
      orders,
      resting,
      next_seq: expectedSeq,
      next_fill: Number(lastFill) + 1,
      last_at: lastAt < 0 ? null : lastAt,
    });
  } catch (error) {
    invalid(
      `folded stream failed snapshot validation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const hydrated = hydrateEngineState(canonical);
  return createMatchingEngineFromState(index, clock ?? createSimulatedClock(), {
    books: hydrated.books,
    tracked: hydrated.tracked,
    journal,
    nextSeq: hydrated.nextSeq,
    nextFill: hydrated.nextFill,
    lastAt: hydrated.lastAt,
  }, journalStore);
}

/**
 * The journal store's restore path — the only way recorded events reach
 * an engine. `store.load()` returns the raw durable stream and this
 * function folds it through `replayMatchingEngine`'s fail-closed
 * validation: contiguous `seq`, canonical timestamps, known fields, fill
 * pairing and tracked-order arithmetic must all hold or a corrupted or
 * hostile row fails here, before any engine exists. The replayed engine
 * keeps appending to the same store, so new submissions continue the
 * recorded `seq` contiguously.
 *
 * With `base` — a canonical snapshot taken when the store's durable tail
 * had reached `base.next_seq - 1` — only the tail is read: a store that
 * can slice serves it through `loadAfter(base.next_seq - 1)`, one that
 * cannot is loaded whole and filtered to the same seqs. Either way the
 * fold re-validates the tail against the snapshot, so a snapshot that
 * disagrees with the recorded stream — wrong boundary, stale, foreign —
 * fails here rather than booting a divergent engine.
 *
 * @param {MatchingJournalStore} store
 * @param {{ instruments?: InstrumentDefinition[], clock?: SimulatedClock, base?: EngineSnapshot }} [options]
 */
export async function replayMatchingJournalStore(store, options = {}) {
  validJournalStore(store);
  const candidate = plainOptions(options, ["instruments", "clock", "base"]);
  if (candidate.instruments !== undefined && !Array.isArray(candidate.instruments)) {
    throw new TypeError("instruments must be an array of instrument definitions");
  }
  const base = candidate.base === undefined ? undefined : parseEngineSnapshot(candidate.base);
  if (base !== undefined && candidate.instruments !== undefined) {
    throw new TypeError("a snapshot base carries its own instrument registry");
  }
  const events =
    base === undefined
      ? await store.load()
      : typeof store.loadAfter === "function"
        ? await store.loadAfter(base.next_seq - 1)
        : (await store.load()).filter((event) => event.seq >= base.next_seq);
  return replayMatchingEngine({
    events,
    clock: validClock(candidate.clock),
    journalStore: store,
    base,
  });
}

/**
 * Rebuilds an engine from a canonical snapshot written by `engine.snapshot()`.
 * The snapshot must come through {@link parseEngineSnapshot}'s fail-closed
 * checks — wrong types, duplicate resting ids, a resting order missing from
 * tracked state, resting out of book order, counters inconsistent with the
 * recorded state — or restore throws `TypeError` with an
 * `invalid engine snapshot:` reason.
 *
 * The restored engine's `bookSnapshot` is byte-identical to the source's,
 * `seq`/`fill_id` numbering continues monotonically, and `journal()` starts
 * empty: a snapshot carries state, not history.
 *
 * @param {unknown} snapshot
 * @param {{ clock?: SimulatedClock }} [options]
 */
export function restoreMatchingEngine(snapshot, options = {}) {
  const candidate = plainOptions(options, ["clock"]);
  const clock = validClock(candidate.clock);
  const canonical = parseEngineSnapshot(snapshot);
  const { index, books, tracked, nextSeq, nextFill, lastAt } = hydrateEngineState(canonical);
  return createMatchingEngineFromState(index, clock ?? createSimulatedClock(), {
    books,
    tracked,
    journal: [],
    nextSeq,
    nextFill,
    lastAt,
  });
}
