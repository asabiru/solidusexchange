import { createOrderBook } from "./book.mjs";
import { formatScaledDecimal, isScaledDecimal, parseScaledDecimal } from "./decimal.mjs";
import { assertEpochSeconds, createSimulatedClock, toIsoSeconds } from "./deterministic.mjs";
import {
  isOrderId,
  isOwner,
  isSide,
  ORDER_KEYS,
  POSTING,
  SELF_TRADE_POLICY,
} from "./events.mjs";
import { INSTRUMENTS, instrumentIndex } from "./instruments.mjs";
import { snapshotPlainData } from "./snapshot.mjs";

/**
 * Pure deterministic matching engine. A submission runs synchronously:
 * validate, emit `accepted`, walk the opposite side in price/time order
 * emitting one `filled`/`partially_filled` event per order per execution,
 * then emit `resting` for whatever remains. Every output is data with
 * `posting: "none"` — nothing posts to a ledger, moves balances, settles
 * or talks to anything. Same input sequence always yields the same event
 * sequence, byte-identical.
 *
 * @typedef {import("./book.mjs").RestingOrder} RestingOrder
 * @typedef {import("./events.mjs").MatchingEvent} MatchingEvent
 * @typedef {import("./events.mjs").OrderInput} OrderInput
 * @typedef {import("./deterministic.mjs").SimulatedClock} SimulatedClock
 * @typedef {import("./instruments.mjs").InstrumentDefinition} InstrumentDefinition
 *
 * @typedef {object} TrackedOrder
 * @property {string} order_id
 * @property {string} instrument
 * @property {"buy" | "sell"} side
 * @property {string | undefined} owner
 * @property {string} price
 * @property {bigint} price_units
 * @property {string} quantity
 * @property {bigint} quantity_units
 * @property {bigint} remaining_units
 * @property {"resting" | "filled" | "cancelled" | "rejected"} state
 *
 * @typedef {object} OrderStatusView
 * @property {string} order_id
 * @property {string} instrument
 * @property {"buy" | "sell"} side
 * @property {string} price
 * @property {string} quantity
 * @property {string} remaining_quantity
 * @property {string} state
 */

const REQUIRED_ORDER_KEYS = Object.freeze(["instrument", "order_id", "price", "quantity", "side"]);

/**
 * @param {unknown} options
 * @returns {{ instruments: import("./instruments.mjs").InstrumentDefinition[] | undefined, clock: SimulatedClock | undefined }}
 */
function engineOptions(options) {
  if (options === undefined) {
    return { instruments: undefined, clock: undefined };
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("engine options must be a plain object");
  }
  const candidate = /** @type {{ instruments?: unknown, clock?: unknown }} */ (options);
  for (const key of Object.keys(options)) {
    if (key !== "instruments" && key !== "clock") {
      throw new TypeError(`unknown engine option: ${key}`);
    }
  }
  if (candidate.instruments !== undefined && !Array.isArray(candidate.instruments)) {
    throw new TypeError("instruments must be an array of instrument definitions");
  }
  const clock = candidate.clock;
  if (
    clock !== undefined &&
    (clock === null || typeof clock !== "object" || typeof (/** @type {SimulatedClock} */ (clock).now) !== "function")
  ) {
    throw new TypeError("clock must be an object with a now() function");
  }
  return {
    instruments: /** @type {InstrumentDefinition[] | undefined} */ (candidate.instruments),
    clock: /** @type {SimulatedClock | undefined} */ (clock),
  };
}

/**
 * @param {{ instruments?: InstrumentDefinition[], clock?: SimulatedClock }} [options]
 */
export function createMatchingEngine(options = {}) {
  const { instruments, clock } = engineOptions(options);
  const index = instrumentIndex(instruments ?? INSTRUMENTS);
  const timeSource = clock ?? createSimulatedClock();
  /** @type {Map<string, ReturnType<typeof createOrderBook>>} */
  const books = new Map();
  /** @type {Map<string, TrackedOrder>} */
  const tracked = new Map();
  let nextSeq = 1;
  let nextFill = 1;
  let lastAt = -1;

  /**
   * @param {string} instrument
   */
  function bookFor(instrument) {
    let book = books.get(instrument);
    if (book === undefined) {
      const definition = /** @type {import("./instruments.mjs").InstrumentDefinition} */ (
        index.get(instrument)
      );
      book = createOrderBook(instrument, definition.base_scale, definition.price_scale);
      books.set(instrument, book);
    }
    return book;
  }

  function stamp() {
    const now = timeSource.now();
    assertEpochSeconds(now, "clock time");
    if (now < lastAt) {
      throw new RangeError("clock must not go backwards");
    }
    lastAt = now;
    return { seq: nextSeq++, at: toIsoSeconds(now) };
  }

  /**
   * @param {MatchingEvent[]} events
   * @param {string} type
   * @param {Record<string, unknown>} fields
   */
  function emit(events, type, fields) {
    events.push(
      /** @type {MatchingEvent} */ (
        Object.freeze({ ...stamp(), ...fields, type, posting: POSTING })
      ),
    );
  }

  /**
   * @param {MatchingEvent[]} events
   * @param {{ order_id?: unknown, instrument?: unknown, side?: unknown }} echo
   * @param {string} reason
   */
  function emitRejected(events, echo, reason) {
    emit(events, "rejected", {
      order_id: typeof echo.order_id === "string" ? echo.order_id : null,
      instrument: typeof echo.instrument === "string" ? echo.instrument : null,
      side: typeof echo.side === "string" ? echo.side : null,
      reason,
    });
  }

  /**
   * Validates a snapshotted order input. Returns the reason code on failure.
   *
   * @param {unknown} order
   * @returns {{ ok: true, parsed: TrackedOrder } | { ok: false, reason: string }}
   */
  function validateOrder(order) {
    if (order === null || typeof order !== "object" || Array.isArray(order)) {
      return { ok: false, reason: "invalid_order" };
    }
    const keys = Object.keys(order);
    if (
      keys.some((key) => !ORDER_KEYS.includes(key)) ||
      REQUIRED_ORDER_KEYS.some((key) => !Object.hasOwn(order, key))
    ) {
      return { ok: false, reason: "invalid_order" };
    }
    const candidate = /** @type {OrderInput} */ (order);
    if (!isOrderId(candidate.order_id)) {
      return { ok: false, reason: "invalid_order_id" };
    }
    if (typeof candidate.instrument !== "string") {
      return { ok: false, reason: "invalid_instrument" };
    }
    const definition = index.get(candidate.instrument);
    if (definition === undefined) {
      return { ok: false, reason: "unknown_instrument" };
    }
    if (!isSide(candidate.side)) {
      return { ok: false, reason: "invalid_side" };
    }
    if (candidate.owner !== undefined && !isOwner(candidate.owner)) {
      return { ok: false, reason: "invalid_owner" };
    }
    if (!isScaledDecimal(candidate.price, definition.price_scale)) {
      return { ok: false, reason: "invalid_price" };
    }
    const priceUnits = parseScaledDecimal(candidate.price, definition.price_scale);
    if (priceUnits === 0n) {
      return { ok: false, reason: "non_positive_price" };
    }
    if (!isScaledDecimal(candidate.quantity, definition.base_scale)) {
      return { ok: false, reason: "invalid_quantity" };
    }
    const quantityUnits = parseScaledDecimal(candidate.quantity, definition.base_scale);
    if (quantityUnits === 0n) {
      return { ok: false, reason: "non_positive_quantity" };
    }
    if (tracked.has(candidate.order_id)) {
      return { ok: false, reason: "duplicate_order_id" };
    }
    const price = formatScaledDecimal(priceUnits, definition.price_scale);
    const quantity = formatScaledDecimal(quantityUnits, definition.base_scale);
    return {
      ok: true,
      parsed: {
        order_id: candidate.order_id,
        instrument: candidate.instrument,
        side: candidate.side,
        owner: candidate.owner,
        price,
        price_units: priceUnits,
        quantity,
        quantity_units: quantityUnits,
        remaining_units: quantityUnits,
        state: "resting",
      },
    };
  }

  /**
   * @param {MatchingEvent[]} events
   * @param {TrackedOrder} taker
   * @param {RestingOrder} maker
   * @param {string} fillId
   * @param {bigint} quantityUnits
   * @param {number} baseScale
   */
  function emitFill(events, taker, maker, fillId, quantityUnits, baseScale) {
    const quantity = formatScaledDecimal(quantityUnits, baseScale);
    for (const order of [maker, taker]) {
      emit(events, order.remaining_units === 0n ? "filled" : "partially_filled", {
        order_id: order.order_id,
        instrument: taker.instrument,
        side: order.side,
        fill_id: fillId,
        maker_order_id: maker.order_id,
        taker_order_id: taker.order_id,
        price: maker.price,
        quantity,
        remaining_quantity: formatScaledDecimal(order.remaining_units, baseScale),
      });
    }
  }

  return Object.freeze({
    /**
     * Validates and matches one limit order, returning the events it
     * produced in order. Invalid input produces a single `rejected` event.
     *
     * @param {unknown} input
     * @returns {readonly MatchingEvent[]}
     */
    submitOrder(input) {
      /** @type {MatchingEvent[]} */
      const events = [];
      /** @type {unknown} */
      let snapshot;
      try {
        snapshot = snapshotPlainData(input);
      } catch {
        emitRejected(events, {}, "invalid_order");
        return Object.freeze(events);
      }
      const validated = validateOrder(snapshot);
      if (!validated.ok) {
        const echo =
          snapshot !== null && typeof snapshot === "object" && !Array.isArray(snapshot)
            ? /** @type {{ order_id?: unknown, instrument?: unknown, side?: unknown }} */ (snapshot)
            : {};
        emitRejected(events, echo, validated.reason);
        return Object.freeze(events);
      }
      const taker = validated.parsed;
      const book = bookFor(taker.instrument);
      const definition = /** @type {import("./instruments.mjs").InstrumentDefinition} */ (
        index.get(taker.instrument)
      );
      tracked.set(taker.order_id, taker);
      emit(events, "accepted", {
        order_id: taker.order_id,
        instrument: taker.instrument,
        side: taker.side,
        price: taker.price,
        quantity: taker.quantity,
      });

      const opposite = taker.side === "buy" ? "sell" : "buy";
      let rejected = false;
      for (;;) {
        const maker = book.bestHead(opposite);
        if (
          maker === undefined ||
          taker.remaining_units === 0n ||
          (taker.side === "buy"
            ? taker.price_units < maker.price_units
            : taker.price_units > maker.price_units)
        ) {
          break;
        }
        if (
          SELF_TRADE_POLICY === "reject" &&
          taker.owner !== undefined &&
          maker.owner !== undefined &&
          taker.owner === maker.owner
        ) {
          taker.state = "rejected";
          emit(events, "rejected", {
            order_id: taker.order_id,
            instrument: taker.instrument,
            side: taker.side,
            reason: "self_trade",
            quantity: formatScaledDecimal(taker.remaining_units, definition.base_scale),
          });
          rejected = true;
          break;
        }
        const quantityUnits =
          taker.remaining_units < maker.remaining_units
            ? taker.remaining_units
            : maker.remaining_units;
        const fillId = `fll_${nextFill.toString(16).padStart(24, "0")}`;
        nextFill += 1;
        maker.remaining_units -= quantityUnits;
        taker.remaining_units -= quantityUnits;
        emitFill(events, taker, maker, fillId, quantityUnits, definition.base_scale);
        if (maker.remaining_units === 0n) {
          book.shiftBest(opposite);
          const makerTracked = tracked.get(maker.order_id);
          if (makerTracked !== undefined) {
            makerTracked.state = "filled";
          }
        }
      }

      if (!rejected && taker.remaining_units > 0n) {
        book.addResting(/** @type {RestingOrder} */ (taker));
        emit(events, "resting", {
          order_id: taker.order_id,
          instrument: taker.instrument,
          side: taker.side,
          price: taker.price,
          quantity: formatScaledDecimal(taker.remaining_units, definition.base_scale),
        });
      } else if (!rejected) {
        taker.state = "filled";
      }
      return Object.freeze(events);
    },

    /**
     * Cancels a resting order by id. Cancelling an id that is not resting —
     * unknown, filled, cancelled or rejected — produces `rejected` with
     * `order_not_resting`.
     *
     * @param {unknown} instrument
     * @param {unknown} orderId
     * @returns {readonly MatchingEvent[]}
     */
    cancelOrder(instrument, orderId) {
      /** @type {MatchingEvent[]} */
      const events = [];
      const echo = { order_id: orderId, instrument, side: null };
      if (typeof instrument !== "string") {
        emitRejected(events, echo, "invalid_instrument");
        return Object.freeze(events);
      }
      if (!index.has(instrument)) {
        emitRejected(events, echo, "unknown_instrument");
        return Object.freeze(events);
      }
      if (!isOrderId(orderId)) {
        emitRejected(events, echo, "invalid_order_id");
        return Object.freeze(events);
      }
      const book = bookFor(instrument);
      const resting = book.restingOrder(orderId);
      if (resting === undefined) {
        emitRejected(events, echo, "order_not_resting");
        return Object.freeze(events);
      }
      const removedUnits = resting.remaining_units;
      book.remove(resting);
      const entry = tracked.get(orderId);
      const definition = /** @type {import("./instruments.mjs").InstrumentDefinition} */ (
        index.get(instrument)
      );
      if (entry !== undefined) {
        entry.state = "cancelled";
        entry.remaining_units = 0n;
      }
      emit(events, "cancelled", {
        order_id: resting.order_id,
        instrument,
        side: resting.side,
        price: resting.price,
        quantity: formatScaledDecimal(removedUnits, definition.base_scale),
      });
      return Object.freeze(events);
    },

    /**
     * Aggregated market depth for one instrument, best price first.
     *
     * @param {unknown} instrument
     */
    bookSnapshot(instrument) {
      if (typeof instrument !== "string" || !index.has(instrument)) {
        throw new TypeError("unknown instrument");
      }
      return bookFor(instrument).snapshot();
    },

    /**
     * Current tracked state of an accepted order id, or null when the id was
     * never accepted (rejected submissions do not consume order ids).
     *
     * @param {unknown} orderId
     * @returns {OrderStatusView | null}
     */
    orderStatus(orderId) {
      if (typeof orderId !== "string") {
        return null;
      }
      const entry = tracked.get(orderId);
      if (entry === undefined) {
        return null;
      }
      const definition = /** @type {import("./instruments.mjs").InstrumentDefinition} */ (
        index.get(entry.instrument)
      );
      return Object.freeze({
        order_id: entry.order_id,
        instrument: entry.instrument,
        side: entry.side,
        price: entry.price,
        quantity: entry.quantity,
        remaining_quantity: formatScaledDecimal(entry.remaining_units, definition.base_scale),
        state: entry.state,
      });
    },
  });
}
