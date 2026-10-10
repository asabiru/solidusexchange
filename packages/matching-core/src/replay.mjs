import { createOrderBook } from "./book.mjs";
import { formatScaledDecimal, isScaledDecimal, parseScaledDecimal } from "./decimal.mjs";
import { createSimulatedClock, fromIsoSeconds } from "./deterministic.mjs";
import { createMatchingEngineFromState } from "./engine.mjs";
import {
  EVENT_TYPES,
  FILL_ID_PATTERN,
  isOrderId,
  isSide,
  POSTING,
  REJECT_REASONS,
} from "./events.mjs";
import { INSTRUMENTS, instrumentIndex } from "./instruments.mjs";
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
 * the stream, and fill/cancel arithmetic matching the tracked remainder.
 * Anything else throws `TypeError` with an `invalid event stream:` reason.
 *
 * @typedef {import("./book.mjs").RestingOrder} RestingOrder
 * @typedef {import("./deterministic.mjs").SimulatedClock} SimulatedClock
 * @typedef {import("./engine.mjs").TrackedOrder} TrackedOrder
 * @typedef {import("./events.mjs").MatchingEvent} MatchingEvent
 * @typedef {import("./instruments.mjs").InstrumentDefinition} InstrumentDefinition
 * @typedef {import("./snapshot.mjs").EngineSnapshot} EngineSnapshot
 */

const MAX_FILL_NUMBER = BigInt(Number.MAX_SAFE_INTEGER - 1);

/** @type {Record<MatchingEvent["type"], Set<string>>} */
const EVENT_KEYS = {
  accepted: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "order_type", "price", "quantity"]),
  resting: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "price", "quantity"]),
  partially_filled: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "fill_id", "maker_order_id", "taker_order_id", "price", "quantity", "remaining_quantity"]),
  filled: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "fill_id", "maker_order_id", "taker_order_id", "price", "quantity", "remaining_quantity"]),
  cancelled: new Set(["seq", "at", "type", "posting", "order_id", "instrument", "side", "price", "quantity"]),
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
 * @param {{ instruments?: InstrumentDefinition[], events?: readonly MatchingEvent[], clock?: SimulatedClock }} [options]
 */
export function replayMatchingEngine(options = {}) {
  const candidate = plainOptions(options, ["instruments", "events", "clock"]);
  if (candidate.instruments !== undefined && !Array.isArray(candidate.instruments)) {
    throw new TypeError("instruments must be an array of instrument definitions");
  }
  const index = instrumentIndex(
    /** @type {InstrumentDefinition[] | undefined} */ (candidate.instruments) ?? INSTRUMENTS,
  );
  const clock = validClock(candidate.clock);
  const events = snapshotPlainData(candidate.events);
  if (!Array.isArray(events)) {
    invalid("events must be an array");
  }

  /** @type {Map<string, TrackedOrder>} */
  const tracked = new Map();
  /** @type {Map<string, ReturnType<typeof createOrderBook>>} */
  const books = new Map();
  /** @type {Set<string>} */
  const inBook = new Set();
  /** @type {string[]} Book-insertion order of every order that ever rested. */
  const restingOrder = [];
  /** @type {MatchingEvent[]} */
  const journal = [];
  /** @type {{ fill_id: string, maker_order_id: string, taker_order_id: string, quantity: unknown } | null} */
  let pendingMaker = null;
  let expectedSeq = 1;
  let lastAt = -1;
  let lastFill = 0n;

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
    }
  }

  for (const record of events) {
    requireObject(record, "each event must be a plain object");
    const event = /** @type {Record<string, unknown>} */ (record);
    if (event.seq !== expectedSeq) {
      invalid("seq must be contiguous from 1 with no gaps");
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
    if (typeof event.type !== "string" || !EVENT_TYPES.includes(/** @type {never} */ (event.type))) {
      invalid(`event seq ${event.seq}: unknown event type`);
    }
    if (event.posting !== POSTING) {
      invalid(`event seq ${event.seq}: posting must be none`);
    }
    const type = /** @type {MatchingEvent["type"]} */ (event.type);
    checkKeys(event, type);

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
          owner: undefined,
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
        inBook.add(entry.order_id);
        restingOrder.push(entry.order_id);
        bookFor(entry.instrument).addResting(/** @type {RestingOrder} */ (entry));
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
          const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
          if (unitsOf(event.quantity, "rejected quantity", definition.base_scale) !== entry.remaining_units) {
            invalid(`event seq ${event.seq}: rejected quantity is not the tracked remainder`);
          }
          entry.state = "rejected";
        } else if (event.quantity !== undefined) {
          invalid(`event seq ${event.seq}: only self_trade and insufficient_liquidity rejections carry a quantity`);
        }
        break;
      }
    }
    journal.push(/** @type {MatchingEvent} */ (Object.freeze({ ...event })));
  }

  if (pendingMaker !== null) {
    invalid("stream ends inside a fill pair");
  }

  const resting = restingOrder.filter((orderId) => inBook.has(orderId));
  const orders = [...tracked.values()].map((entry) => {
    const definition = /** @type {InstrumentDefinition} */ (index.get(entry.instrument));
    return {
      order_id: entry.order_id,
      instrument: entry.instrument,
      side: entry.side,
      order_type: entry.order_type,
      owner: null,
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
