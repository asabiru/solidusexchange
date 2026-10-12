/**
 * Adversarial order-book semantics audit — wave 69. Pins the matching
 * engine's price/time priority, self-trade policy, amend semantics,
 * partial-fill and dust handling, cancel lifecycle, decimal exactness and
 * event/journal emission contract, plus regression coverage for the
 * defects this wave fixed (see
 * Documentation/regulated-core/orderbook-audit-wave69.md):
 * the stale owner-gap paragraph in the README, `book.remove`'s partial
 * mutation on a level miss, `emit`'s caller-shadowable envelope keys, and
 * `finish`'s unsealed batch / unguarded re-entrant operation.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createOrderBook } from "../src/book.mjs";
import { createSimulatedClock, toIsoSeconds } from "../src/deterministic.mjs";
import { parseScaledDecimal } from "../src/decimal.mjs";
import { createMatchingEngine } from "../src/engine.mjs";
import { replayMatchingEngine } from "../src/replay.mjs";
import { marketOrder, ord, order } from "./helpers.mjs";

/**
 * @param {readonly { type: string }[]} events
 * @returns {string[]}
 */
const types = (events) => events.map((event) => event.type);

/**
 * The maker-side event of an execution: its `order_id` equals the
 * `maker_order_id`, unlike the taker-side event of the same fill.
 *
 * @param {{ type: string, order_id?: unknown, maker_order_id?: unknown }} event
 */
const isMakerFill = (event) =>
  (event.type === "filled" || event.type === "partially_filled") &&
  event.order_id === event.maker_order_id;

/**
 * @param {string | number} id
 * @param {Record<string, unknown>} [fields]
 */
const sell = (id, fields = {}) => order(id, { side: "sell", ...fields });

/**
 * @param {string | number} id
 * @param {Record<string, unknown>} [fields]
 */
const buy = (id, fields = {}) => order(id, { side: "buy", ...fields });

describe("order-book audit: price-time priority", () => {
  test("two rests at the same price fill in submission order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(sell(2));
    const events = engine.submitOrder(buy(3));
    assert.deepEqual(types(events), ["accepted", "filled", "filled"]);
    assert.equal(events[1].order_id, ord(1));
    assert.equal(engine.orderStatus(ord(2)).state, "resting");
  });

  test("rests stamped at one instant still queue in acceptance order", () => {
    const clock = createSimulatedClock();
    const engine = createMatchingEngine({ clock });
    engine.submitOrder(sell(1));
    engine.submitOrder(sell(2));
    engine.submitOrder(sell(3));
    const events = engine.submitOrder(buy(4, { quantity: "2" }));
    const makers = events.filter(isMakerFill);
    assert.deepEqual(
      makers.map((event) => event.order_id),
      [ord(1), ord(2)],
    );
    assert.equal(new Set(engine.journal().map((event) => event.at)).size, 1);
    assert.equal(engine.orderStatus(ord(3)).state, "resting");
  });

  test("an aggressor sweeping levels drains best price outward", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { price: "92" }));
    engine.submitOrder(sell(2, { price: "90" }));
    engine.submitOrder(sell(3, { price: "91" }));
    const events = engine.submitOrder(buy(4, { price: "92", quantity: "3" }));
    const makers = events.filter(isMakerFill);
    // Fills land at maker prices, cheapest level first.
    assert.deepEqual(
      makers.map((event) => [event.order_id, event.price]),
      [
        [ord(2), "90.00000000"],
        [ord(3), "91.00000000"],
        [ord(1), "92.00000000"],
      ],
    );
    assert.equal(types(events).at(-1), "filled");
    assert.equal(engine.bookSnapshot("USDT/RUB").asks.length, 0);
  });

  test("equal-price rests of different quantity sequence in arrival order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { quantity: "5" }));
    engine.submitOrder(sell(2, { quantity: "1" }));
    const events = engine.submitOrder(buy(3, { quantity: "2" }));
    const maker = events.filter(isMakerFill)[0];
    assert.equal(maker.type, "partially_filled");
    assert.equal(maker.order_id, ord(1));
    assert.equal(maker.remaining_quantity, "3.000000");
    assert.equal(engine.orderStatus(ord(2)).remaining_quantity, "1.000000");
  });

  test("a re-priced order joins the tail of its new level", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { price: "90" }));
    engine.submitOrder(sell(2, { price: "91" }));
    const amended = engine.amendOrder({ order_id: ord(1), price: "91" });
    assert.deepEqual(types(amended), ["amended", "resting"]);
    const events = engine.submitOrder(buy(3, { price: "91", quantity: "2" }));
    const makers = events.filter(isMakerFill);
    assert.deepEqual(
      makers.map((event) => event.order_id),
      [ord(2), ord(1)],
    );
  });
});

describe("order-book audit: self-trade protection", () => {
  test("an own rest at the book head rejects the aggressor's remainder only", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { owner: "desk-b" }));
    engine.submitOrder(sell(2, { price: "91", owner: "desk-a" }));
    const events = engine.submitOrder(buy(3, { price: "91", quantity: "2", owner: "desk-a" }));
    assert.deepEqual(types(events), ["accepted", "filled", "partially_filled", "rejected"]);
    const rejected = events.at(-1);
    assert.equal(rejected.reason, "self_trade");
    assert.equal(rejected.quantity, "1.000000");
    // The taker goes terminal, the honest fill stands, and the own rest is
    // untouched — reject policy, never skip or cancel-own.
    assert.equal(engine.orderStatus(ord(3)).state, "rejected");
    assert.equal(engine.orderStatus(ord(1)).state, "filled");
    assert.equal(engine.orderStatus(ord(2)).state, "resting");
    assert.equal(engine.orderStatus(ord(2)).remaining_quantity, "1.000000");
  });

  test("an own rest beyond the aggressor's limit does not trip the check", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { price: "95", owner: "desk-a" }));
    const events = engine.submitOrder(buy(2, { price: "92", owner: "desk-a" }));
    assert.deepEqual(types(events), ["accepted", "resting"]);
    const depth = engine.bookSnapshot("USDT/RUB");
    assert.equal(depth.bids[0].price, "92.00000000");
    assert.equal(depth.asks[0].price, "95.00000000");
  });

  test("the self-trade check is scoped per instrument, not per owner", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { owner: "desk-a" }));
    engine.submitOrder(order(2, { instrument: "TON/RUB", side: "sell", price: "150", owner: "desk-a" }));
    // desk-b lifts desk-a's TON offer cleanly — the USDT rest is irrelevant.
    const clean = engine.submitOrder(
      order(3, { instrument: "TON/RUB", side: "buy", price: "150", owner: "desk-b" }),
    );
    assert.equal(types(clean).at(-1), "filled");
    // Inside one instrument the same-owner check still bites.
    engine.submitOrder(order(4, { instrument: "TON/RUB", side: "sell", price: "140", owner: "desk-a" }));
    const crossed = engine.submitOrder(
      order(5, { instrument: "TON/RUB", side: "buy", price: "150", owner: "desk-a" }),
    );
    assert.equal(crossed.at(-1).reason, "self_trade");
  });

  test("amending a rest into the owner's own opposite rest rejects self_trade", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { price: "95", owner: "desk-a" }));
    engine.submitOrder(buy(2, { price: "80", owner: "desk-a" }));
    const events = engine.amendOrder({ order_id: ord(2), price: "96" });
    assert.deepEqual(types(events), ["amended", "rejected"]);
    assert.equal(events.at(-1).reason, "self_trade");
    assert.equal(engine.orderStatus(ord(2)).state, "rejected");
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });

  test("orders without an owner never self-trade", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    const events = engine.submitOrder(buy(2));
    assert.equal(types(events).at(-1), "filled");
  });

  test("owner matching is exact: differing case is a different owner", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { owner: "Desk-A" }));
    const events = engine.submitOrder(buy(2, { owner: "desk-a" }));
    assert.equal(types(events).at(-1), "filled");
  });

  test("a rest left by a self-trade reject still fills other owners", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { owner: "desk-a" }));
    const rejected = engine.submitOrder(buy(2, { owner: "desk-a" }));
    assert.equal(rejected.at(-1).reason, "self_trade");
    const events = engine.submitOrder(buy(3, { owner: "desk-b" }));
    assert.equal(types(events).at(-1), "filled");
    assert.equal(engine.orderStatus(ord(1)).state, "filled");
  });
});

describe("order-book audit: amend semantics", () => {
  test("a quantity increase loses priority and re-queues at the tail", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(sell(2));
    const amended = engine.amendOrder({ order_id: ord(1), quantity: "3" });
    assert.deepEqual(types(amended), ["amended", "resting"]);
    const events = engine.submitOrder(buy(3));
    assert.equal(events.filter(isMakerFill)[0].order_id, ord(2));
    assert.equal(engine.orderStatus(ord(2)).state, "filled");
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });

  test("a quantity decrease at an unchanged price keeps its slot", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { quantity: "5" }));
    engine.submitOrder(sell(2, { quantity: "5" }));
    const amended = engine.amendOrder({ order_id: ord(1), quantity: "2" });
    assert.deepEqual(types(amended), ["amended"]);
    const events = engine.submitOrder(buy(3, { quantity: "2" }));
    assert.equal(events.filter(isMakerFill)[0].order_id, ord(1));
    assert.equal(engine.orderStatus(ord(1)).state, "filled");
    assert.equal(engine.orderStatus(ord(2)).remaining_quantity, "5.000000");
  });

  test("amending a filled, cancelled, rejected or unknown order is rejected", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(buy(2));
    engine.submitOrder(sell(3, { price: "95" }));
    engine.cancelOrder("USDT/RUB", ord(3));
    engine.submitOrder(sell(4, { price: "95", owner: "desk-a" }));
    engine.submitOrder(buy(5, { price: "95", owner: "desk-a" }));
    for (const id of [ord(1), ord(2), ord(3), ord(5), ord(99)]) {
      const events = engine.amendOrder({ order_id: id, price: "91" });
      assert.equal(events.at(-1).reason, "order_not_resting", `amend of ${id}`);
    }
  });

  test("an amend crossing the book executes in the same call at maker prices", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(buy(1, { price: "89" }));
    engine.submitOrder(sell(2, { price: "91" }));
    const events = engine.amendOrder({ order_id: ord(2), price: "89" });
    assert.deepEqual(types(events), ["amended", "filled", "filled"]);
    assert.equal(events[1].order_id, ord(1));
    assert.equal(events[1].price, "89.00000000");
    assert.equal(engine.orderStatus(ord(2)).state, "filled");
  });

  test("an amended total at or below the filled part is rejected", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { quantity: "5" }));
    engine.submitOrder(buy(2, { quantity: "3" }));
    for (const quantity of ["3", "2"]) {
      const events = engine.amendOrder({ order_id: ord(1), quantity });
      assert.equal(events.at(-1).reason, "quantity_below_filled");
    }
    const amended = engine.amendOrder({ order_id: ord(1), quantity: "4" });
    assert.equal(types(amended)[0], "amended");
    assert.equal(engine.orderStatus(ord(1)).remaining_quantity, "1.000000");
  });

  test("an amend that normalizes to no change is rejected no_change", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { price: "90", quantity: "2" }));
    assert.equal(
      engine.amendOrder({ order_id: ord(1), price: "90.00000000" }).at(-1).reason,
      "no_change",
    );
    assert.equal(
      engine.amendOrder({ order_id: ord(1), quantity: "2.000000" }).at(-1).reason,
      "no_change",
    );
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });
});

describe("order-book audit: partial fills, dust and market residuals", () => {
  test("zero-quantity submissions are rejected and never rest", () => {
    const engine = createMatchingEngine();
    const events = engine.submitOrder(sell(1, { quantity: "0" }));
    assert.equal(events.at(-1).reason, "non_positive_quantity");
    assert.equal(engine.orderStatus(ord(1)), null);
    assert.equal(engine.bookSnapshot("USDT/RUB").asks.length, 0);
  });

  test("a rest at the smallest quantity unit fills exactly", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { quantity: "0.000001" }));
    const events = engine.submitOrder(buy(2, { quantity: "0.000001" }));
    assert.equal(types(events).at(-1), "filled");
    assert.equal(engine.orderStatus(ord(1)).remaining_quantity, "0.000000");
  });

  test("fill quantities plus remainder always equal the submitted quantity", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { quantity: "1" }));
    engine.submitOrder(sell(2, { price: "91", quantity: "2" }));
    const events = engine.submitOrder(buy(3, { price: "91", quantity: "2" }));
    let filledUnits = 0n;
    for (const event of events) {
      if (
        event.order_id === ord(3) &&
        event.order_id !== event.maker_order_id &&
        (event.type === "filled" || event.type === "partially_filled")
      ) {
        filledUnits += parseScaledDecimal(event.quantity, 6);
      }
    }
    const status = engine.orderStatus(ord(3));
    const total = filledUnits + parseScaledDecimal(status.remaining_quantity, 6);
    assert.equal(total, parseScaledDecimal("2", 6));
  });

  test("a market order draining the book rejects its remainder, never rests", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(sell(2, { price: "91" }));
    const events = engine.submitOrder(marketOrder(3, { side: "buy", quantity: "10" }));
    assert.equal(types(events).at(-1), "rejected");
    assert.equal(events.at(-1).reason, "insufficient_liquidity");
    assert.equal(events.at(-1).quantity, "8.000000");
    assert.equal(engine.orderStatus(ord(3)).state, "rejected");
    const depth = engine.bookSnapshot("USDT/RUB");
    assert.equal(depth.bids.length, 0);
    assert.equal(depth.asks.length, 0);
  });

  test("a market order into an empty book is rejected whole", () => {
    const engine = createMatchingEngine();
    const events = engine.submitOrder(marketOrder(4, { side: "buy", quantity: "5" }));
    assert.deepEqual(types(events), ["accepted", "rejected"]);
    assert.equal(events.at(-1).reason, "insufficient_liquidity");
    assert.equal(events.at(-1).quantity, "5.000000");
  });

  test("only limit and market order types exist — IOC/FOK spellings reject", () => {
    const engine = createMatchingEngine();
    for (const orderType of ["ioc", "fok", "IOC", "immediate_or_cancel"]) {
      const events = engine.submitOrder(sell(1, { type: orderType }));
      assert.equal(events.at(-1).reason, "invalid_type");
    }
  });

  test("a market order carrying a price is rejected, not coerced to limit", () => {
    const engine = createMatchingEngine();
    const events = engine.submitOrder({ ...marketOrder(1), price: "90" });
    assert.equal(events.at(-1).reason, "invalid_order");
    assert.equal(engine.orderStatus(ord(1)), null);
  });
});

describe("order-book audit: decimal exactness", () => {
  test("quantity arithmetic is decimal-exact at 0.1 granularity", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { quantity: "0.3" }));
    engine.submitOrder(buy(2, { quantity: "0.1" }));
    assert.equal(engine.orderStatus(ord(1)).remaining_quantity, "0.200000");
    engine.submitOrder(buy(3, { quantity: "0.2" }));
    assert.equal(engine.orderStatus(ord(1)).state, "filled");
    assert.equal(engine.orderStatus(ord(1)).remaining_quantity, "0.000000");
  });

  test("one unit past an instrument's scale rejects; the unit itself works", () => {
    const engine = createMatchingEngine();
    assert.equal(
      engine.submitOrder(sell(1, { quantity: "0.0000001" })).at(-1).reason,
      "invalid_quantity",
    );
    assert.equal(
      engine.submitOrder(sell(2, { price: "0.000000001" })).at(-1).reason,
      "invalid_price",
    );
    assert.equal(
      types(engine.submitOrder(sell(3, { price: "0.00000001", quantity: "0.000001" }))).at(-1),
      "resting",
    );
    const crossed = engine.submitOrder(buy(4, { price: "0.00000001", quantity: "0.000001" }));
    assert.equal(types(crossed).at(-1), "filled");
  });

  test("equivalent price spellings share one level in arrival order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { price: "90" }));
    engine.submitOrder(sell(2, { price: "90.00000000" }));
    const asks = engine.bookSnapshot("USDT/RUB").asks;
    assert.equal(asks.length, 1);
    assert.equal(asks[0].order_count, 2);
    const events = engine.submitOrder(buy(3));
    assert.equal(events.filter(isMakerFill)[0].order_id, ord(1));
  });

  test("price and quantity reject past 18 significant digits, never round", () => {
    const engine = createMatchingEngine();
    assert.equal(
      types(engine.submitOrder(sell(1, { quantity: "999999999999.999999" }))).at(-1),
      "resting",
    );
    assert.equal(
      engine.submitOrder(sell(2, { quantity: "9999999999999.999999" })).at(-1).reason,
      "invalid_quantity",
    );
    assert.equal(
      types(engine.submitOrder(sell(3, { price: "9999999999.99999999" }))).at(-1),
      "resting",
    );
    assert.equal(
      engine.submitOrder(sell(4, { price: "99999999999.99999999" })).at(-1).reason,
      "invalid_price",
    );
    assert.equal(
      engine.submitOrder(sell(5, { price: "090" })).at(-1).reason,
      "invalid_price",
    );
    assert.equal(
      engine.submitOrder(sell(6, { quantity: ".5" })).at(-1).reason,
      "invalid_quantity",
    );
  });
});

describe("order-book audit: cancel lifecycle", () => {
  test("cancelling a filled, cancelled or unknown order is rejected", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(buy(2));
    engine.submitOrder(sell(3, { price: "95" }));
    engine.cancelOrder("USDT/RUB", ord(3));
    for (const id of [ord(1), ord(2), ord(3), ord(99)]) {
      const events = engine.cancelOrder("USDT/RUB", id);
      assert.equal(events.at(-1).reason, "order_not_resting", `cancel of ${id}`);
    }
  });

  test("a cancel addressed to the wrong instrument does not touch the order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    const events = engine.cancelOrder("TON/RUB", ord(1));
    assert.equal(events.at(-1).reason, "order_not_resting");
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
    assert.equal(engine.bookSnapshot("USDT/RUB").asks.length, 1);
  });

  test("cancelling a partially filled order removes only the remainder", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1, { quantity: "5" }));
    engine.submitOrder(buy(2, { quantity: "3" }));
    const events = engine.cancelOrder("USDT/RUB", ord(1));
    assert.deepEqual(types(events), ["cancelled"]);
    assert.equal(events[0].quantity, "2.000000");
    const status = engine.orderStatus(ord(1));
    assert.equal(status.state, "cancelled");
    assert.equal(status.remaining_quantity, "0.000000");
    assert.equal(engine.bookSnapshot("USDT/RUB").asks.length, 0);
  });

  test("a cancel frees the level for the next aggressor", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(sell(2));
    engine.cancelOrder("USDT/RUB", ord(1));
    const events = engine.submitOrder(buy(3));
    assert.equal(events.filter(isMakerFill)[0].order_id, ord(2));
  });

  test("cancel and aggressor interleavings resolve in call order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    // Cancel lands first: the aggressor finds an empty book and rests.
    engine.cancelOrder("USDT/RUB", ord(1));
    assert.deepEqual(types(engine.submitOrder(buy(2))), ["accepted", "resting"]);
    // Aggressor lands first: the cancel then finds nothing resting.
    engine.submitOrder(sell(3));
    const cancel = engine.cancelOrder("USDT/RUB", ord(2));
    assert.equal(cancel.at(-1).reason, "order_not_resting");
    assert.equal(engine.orderStatus(ord(2)).state, "filled");
  });

  test("a terminal order id stays consumed; a validation-rejected id does not", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(buy(2));
    engine.submitOrder(sell(4, { price: "95" }));
    engine.cancelOrder("USDT/RUB", ord(4));
    for (const id of [ord(1), ord(2), ord(4)]) {
      const events = engine.submitOrder(sell(id, { price: "96" }));
      assert.equal(events.at(-1).reason, "duplicate_order_id", `resubmit ${id}`);
    }
    const rejected = engine.submitOrder(sell(3, { quantity: "0" }));
    assert.equal(rejected.at(-1).reason, "non_positive_quantity");
    assert.equal(types(engine.submitOrder(sell(3, { price: "95" }))).at(-1), "resting");
  });
});

describe("order-book audit: event and journal emission", () => {
  test("a crossing submission emits accepted then fills then terminal state", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    const events = engine.submitOrder(buy(2, { quantity: "2" }));
    assert.deepEqual(types(events), ["accepted", "filled", "partially_filled", "resting"]);
    const [makerFill, takerFill] = events.slice(1, 3);
    assert.equal(makerFill.order_id, ord(1));
    assert.equal(makerFill.fill_id, takerFill.fill_id);
    assert.equal(takerFill.order_id, ord(2));
    assert.equal(takerFill.maker_order_id, ord(1));
    assert.equal(events.at(-1).quantity, "1.000000");
  });

  test("rejections land on the journal like every other event", () => {
    const engine = createMatchingEngine();
    const events = engine.submitOrder(sell(1, { price: "nope" }));
    assert.deepEqual(types(events), ["rejected"]);
    assert.equal(events[0].reason, "invalid_price");
    assert.equal(engine.journal().at(-1).type, "rejected");
    assert.equal(engine.orderStatus(ord(1)), null);
  });

  test("journal seq is contiguous across submissions, fills, rejects and cancels", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    engine.submitOrder(buy(2));
    engine.submitOrder(sell(3, { quantity: "0" }));
    engine.submitOrder(sell(4, { price: "95" }));
    engine.cancelOrder("USDT/RUB", ord(4));
    const journal = engine.journal();
    assert.deepEqual(
      journal.map((event) => event.seq),
      journal.map((_, index) => index + 1),
    );
    for (const event of journal) {
      assert.equal(Object.isFrozen(event), true);
      assert.equal(event.posting, "none");
    }
  });

  test("a multi-fill submission stamps all of its events at one clock read", () => {
    const clock = createSimulatedClock();
    const engine = createMatchingEngine({ clock });
    engine.submitOrder(sell(1));
    engine.submitOrder(sell(2, { price: "91" }));
    clock.advance(30);
    const events = engine.submitOrder(buy(3, { price: "91", quantity: "2" }));
    assert.equal(new Set(events.map((event) => event.at)).size, 1);
    assert.equal(events[0].at, toIsoSeconds(clock.now()));
  });

  test("journal() returns a frozen copy sealed from caller mutation", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(sell(1));
    const journal = engine.journal();
    assert.throws(() => journal.push({ seq: 99 }), TypeError);
    assert.equal(engine.journal().length, 2);
  });

  test("the store sees post-operation state and the pre-commit journal", () => {
    /** @type {unknown[]} */
    const observed = [];
    const engine = createMatchingEngine({
      journalStore: {
        kind: "observer",
        append: () => {
          observed.push(engine.bookSnapshot("USDT/RUB").asks.length);
          observed.push(engine.journal().length);
        },
        load: () => Promise.resolve([]),
        close: () => Promise.resolve(),
      },
    });
    engine.submitOrder(sell(1));
    engine.submitOrder(buy(2));
    // Inside each append the book already carried the operation's effect
    // (one resting ask, then none after the fill) while the in-memory
    // journal had not yet been appended — events never precede state.
    assert.deepEqual(observed, [1, 0, 0, 2]);
  });

  test("a journal store cannot re-enter the engine mid-operation", () => {
    const engine = createMatchingEngine({
      journalStore: {
        kind: "reentrant",
        append: () => {
          engine.submitOrder(sell(99));
        },
        load: () => Promise.resolve([]),
        close: () => Promise.resolve(),
      },
    });
    assert.throws(() => engine.submitOrder(sell(1)), /reentrant matching operation/);
    assert.equal(engine.orderStatus(ord(99)), null);
  });

  test("a journal store cannot splice into the emitted batch", () => {
    const engine = createMatchingEngine({
      journalStore: {
        kind: "hostile",
        append: (events) => {
          events.push({ seq: 99, type: "filled" });
        },
        load: () => Promise.resolve([]),
        close: () => Promise.resolve(),
      },
    });
    assert.throws(() => engine.submitOrder(sell(1)), TypeError);
    assert.equal(engine.journal().length, 0);
  });

  test("replayed engines keep owner tags and still enforce self-trade", () => {
    const live = createMatchingEngine();
    live.submitOrder(sell(1, { owner: "desk-a" }));
    assert.equal(live.journal()[0].owner, "desk-a");
    const replayed = replayMatchingEngine({ events: live.journal() });
    const events = replayed.submitOrder(buy(2, { owner: "desk-a" }));
    assert.equal(events.at(-1).reason, "self_trade");
    assert.equal(replayed.orderStatus(ord(1)).remaining_quantity, "1.000000");
  });
});

describe("order-book audit: book internals", () => {
  test("remove() is atomic: a level miss mutates nothing", () => {
    const book = createOrderBook("USDT/RUB", 6, 8);
    const restingOrder = {
      order_id: ord(1),
      side: "sell",
      owner: undefined,
      price: "90.00000000",
      price_units: 9_000_000_000n,
      quantity: "1.000000",
      quantity_units: 1_000_000n,
      remaining_units: 1_000_000n,
    };
    book.addResting(restingOrder);
    // Diverge the stored price units from the level key the order was added
    // under — unreachable via engine paths (fields only move after
    // remove()), but remove() must not strand the queue entry by clearing
    // the resting index first.
    restingOrder.price_units = 8_000_000_000n;
    assert.equal(book.remove(restingOrder), false);
    assert.equal(book.restingOrder(ord(1)), restingOrder);
    assert.equal(book.bestHead("sell"), restingOrder);
    assert.equal(book.snapshot().asks.length, 1);
  });

  test("remove() takes an order out of index, queue and level", () => {
    const book = createOrderBook("USDT/RUB", 6, 8);
    const restingOrder = {
      order_id: ord(1),
      side: "buy",
      owner: undefined,
      price: "90.00000000",
      price_units: 9_000_000_000n,
      quantity: "1.000000",
      quantity_units: 1_000_000n,
      remaining_units: 1_000_000n,
    };
    book.addResting(restingOrder);
    assert.equal(book.remove(restingOrder), true);
    assert.equal(book.restingOrder(ord(1)), undefined);
    assert.equal(book.bestHead("buy"), undefined);
    assert.equal(book.snapshot().bids.length, 0);
    assert.equal(book.remove(restingOrder), false);
  });
});
