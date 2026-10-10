import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import { fll, ord, order } from "./helpers.mjs";

/**
 * @param {readonly { type: string }[]} events
 */
function types(events) {
  return events.map((event) => event.type);
}

describe("order validation", () => {
  test("non-object and wrong-shape submissions are rejected", () => {
    const engine = createMatchingEngine();
    for (const input of [null, undefined, 5, "x", [1], () => {}]) {
      const [event] = engine.submitOrder(input);
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "invalid_order");
      assert.equal(event.posting, "none");
    }
    for (const bad of [
      { ...order(1), extra: true },
      { order_id: ord(2), instrument: "USDT/RUB", side: "buy", price: "1" },
      { order_id: ord(3), instrument: "USDT/RUB", side: "buy", quantity: "1" },
    ]) {
      const [event] = engine.submitOrder(bad);
      assert.equal(event.reason, "invalid_order");
    }
  });

  test("malformed order ids are rejected", () => {
    const engine = createMatchingEngine();
    for (const id of [
      "",
      "x",
      "ord_",
      `ORD_${"0".repeat(24)}`,
      `ord_${"0".repeat(23)}`,
      `ord_${"0".repeat(25)}`,
      `ord_${"z".repeat(24)}`,
      `ord_${"A".repeat(24)}`,
      7,
    ]) {
      const [event] = engine.submitOrder(order(1, { order_id: id }));
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "invalid_order_id", String(id));
    }
  });

  test("unknown or malformed instruments are rejected", () => {
    const engine = createMatchingEngine();
    let [event] = engine.submitOrder(order(1, { instrument: "BTC/USD" }));
    assert.equal(event.reason, "unknown_instrument");
    [event] = engine.submitOrder(order(2, { instrument: 42 }));
    assert.equal(event.reason, "invalid_instrument");
    [event] = engine.submitOrder(order(3, { instrument: null }));
    assert.equal(event.reason, "invalid_instrument");
  });

  test("bad sides, owners, prices and quantities are rejected", () => {
    const engine = createMatchingEngine();
    const cases = [
      [{ side: "hold" }, "invalid_side"],
      [{ side: "BUY" }, "invalid_side"],
      [{ owner: "" }, "invalid_owner"],
      [{ owner: "not allowed spaces" }, "invalid_owner"],
      [{ owner: 7 }, "invalid_owner"],
      [{ price: "abc" }, "invalid_price"],
      [{ price: "-5" }, "invalid_price"],
      [{ price: "1e2" }, "invalid_price"],
      [{ price: 100 }, "invalid_price"],
      [{ price: "0.000000001" }, "invalid_price"],
      [{ price: "0" }, "non_positive_price"],
      [{ price: "0.00000000" }, "non_positive_price"],
      [{ quantity: "abc" }, "invalid_quantity"],
      [{ quantity: "-1" }, "invalid_quantity"],
      [{ quantity: "0.0000001" }, "invalid_quantity"],
      [{ quantity: 5 }, "invalid_quantity"],
      [{ quantity: "0" }, "non_positive_quantity"],
      [{ quantity: "0.000000" }, "non_positive_quantity"],
    ];
    let index = 0;
    for (const [patch, reason] of cases) {
      const [event] = engine.submitOrder(order(++index, patch));
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, reason, JSON.stringify(patch));
    }
  });

  test("duplicate order ids are rejected engine-wide", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1));
    let [event] = engine.submitOrder(order(1));
    assert.equal(event.reason, "duplicate_order_id");
    [event] = engine.submitOrder(order(1, { instrument: "TON/RUB" }));
    assert.equal(event.reason, "duplicate_order_id");
  });

  test("rejected submissions do not consume the order id", () => {
    const engine = createMatchingEngine();
    const [rejected] = engine.submitOrder(order(1, { price: "bad" }));
    assert.equal(rejected.reason, "invalid_price");
    const events = engine.submitOrder(order(1));
    assert.equal(types(events)[0], "accepted");
  });
});

describe("matching", () => {
  test("a non-marketable order is accepted and rests", () => {
    const engine = createMatchingEngine();
    const events = engine.submitOrder(order(1, { price: "88", quantity: "2" }));
    assert.deepEqual(types(events), ["accepted", "resting"]);
    const resting = events[1];
    assert.equal(resting.price, "88.00000000");
    assert.equal(resting.quantity, "2.000000");
    assert.equal(resting.posting, "none");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids.length, 1);
    assert.equal(book.asks.length, 0);
  });

  test("a marketable order fills at the maker price", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5" }));
    const events = engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "5" }));
    assert.deepEqual(types(events), ["accepted", "filled", "filled"]);
    const [makerFill, takerFill] = events.slice(1);
    for (const fill of [makerFill, takerFill]) {
      assert.equal(fill.fill_id, fll(1));
      assert.equal(fill.maker_order_id, ord(1));
      assert.equal(fill.taker_order_id, ord(2));
      assert.equal(fill.price, "90.00000000");
      assert.equal(fill.quantity, "5.000000");
      assert.equal(fill.remaining_quantity, "0.000000");
      assert.equal(fill.posting, "none");
    }
    assert.equal(makerFill.side, "sell");
    assert.equal(takerFill.side, "buy");
    assert.equal(makerFill.order_id, ord(1));
    assert.equal(takerFill.order_id, ord(2));
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids.length + book.asks.length, 0);
  });

  test("price improvement: a crossed buy pays the ask, not its limit", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "89.5", quantity: "1" }));
    const events = engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "1" }));
    assert.equal(events[2].price, "89.50000000");
  });

  test("a taker larger than the maker partially fills and rests", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "4" }));
    const events = engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "10" }));
    assert.deepEqual(types(events), ["accepted", "filled", "partially_filled", "resting"]);
    const [makerFill, takerFill, resting] = events.slice(1);
    assert.equal(makerFill.quantity, "4.000000");
    assert.equal(takerFill.remaining_quantity, "6.000000");
    assert.equal(resting.quantity, "6.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids[0].quantity, "6.000000");
  });

  test("a maker larger than the taker partially fills and stays resting", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "10" }));
    const events = engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "4" }));
    assert.deepEqual(types(events), ["accepted", "partially_filled", "filled"]);
    const [makerFill, takerFill] = events.slice(1);
    assert.equal(makerFill.remaining_quantity, "6.000000");
    assert.equal(takerFill.remaining_quantity, "0.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.asks[0].quantity, "6.000000");
  });

  test("a taker sweeps multiple price levels in order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "sell", price: "91", quantity: "3" }));
    engine.submitOrder(order(3, { side: "sell", price: "92", quantity: "5" }));
    const events = engine.submitOrder(order(4, { side: "buy", price: "92", quantity: "8" }));
    const fillEvents = events.filter((event) => event.fill_id !== undefined);
    assert.deepEqual(
      fillEvents.map((event) => [event.fill_id, event.price, event.quantity]),
      [
        [fll(1), "90.00000000", "2.000000"],
        [fll(1), "90.00000000", "2.000000"],
        [fll(2), "91.00000000", "3.000000"],
        [fll(2), "91.00000000", "3.000000"],
        [fll(3), "92.00000000", "3.000000"],
        [fll(3), "92.00000000", "3.000000"],
      ],
    );
    assert.equal(events.at(-1).type, "filled");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.deepEqual(
      book.asks.map((level) => [level.price, level.quantity]),
      [["92.00000000", "2.000000"]],
    );
  });

  test("a sell order sweeps bids from the top down", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "buy", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "3" }));
    const events = engine.submitOrder(order(3, { side: "sell", price: "89", quantity: "4" }));
    const fills = events.filter((event) => event.order_id === ord(3) && event.fill_id !== undefined);
    assert.equal(fills[0].price, "91.00000000");
    assert.equal(fills[0].quantity, "3.000000");
    assert.equal(fills[1].price, "90.00000000");
    assert.equal(fills[1].quantity, "1.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids[0].quantity, "1.000000");
  });

  test("self-trade rejects the taker remainder when the best maker is its own", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5", owner: "desk-a" }));
    const events = engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "5", owner: "desk-a" }));
    assert.deepEqual(types(events), ["accepted", "rejected"]);
    const rejection = events[1];
    assert.equal(rejection.reason, "self_trade");
    assert.equal(rejection.quantity, "5.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.asks[0].quantity, "5.000000");
    assert.equal(engine.orderStatus(ord(2)).state, "rejected");
  });

  test("self-trade bites at a deeper level after honest fills", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1", owner: "desk-b" }));
    engine.submitOrder(order(2, { side: "sell", price: "91", quantity: "5", owner: "desk-a" }));
    const events = engine.submitOrder(order(3, { side: "buy", price: "92", quantity: "10", owner: "desk-a" }));
    const kinds = types(events);
    assert.deepEqual(kinds, ["accepted", "filled", "partially_filled", "rejected"]);
    const rejection = events.at(-1);
    assert.equal(rejection.reason, "self_trade");
    assert.equal(rejection.quantity, "9.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.asks[0].price, "91.00000000");
    assert.equal(book.asks[0].quantity, "5.000000");
  });

  test("orders without owners never self-trade", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const events = engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "2" }));
    assert.equal(types(events).includes("rejected"), false);
  });
});

describe("cancellation", () => {
  test("a resting order cancels with its remainder", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "10" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "4" }));
    const events = engine.cancelOrder("USDT/RUB", ord(1));
    assert.deepEqual(types(events), ["cancelled"]);
    const cancelled = events[0];
    assert.equal(cancelled.order_id, ord(1));
    assert.equal(cancelled.price, "90.00000000");
    assert.equal(cancelled.quantity, "6.000000");
    assert.equal(engine.bookSnapshot("USDT/RUB").asks.length, 0);
    assert.equal(engine.orderStatus(ord(1)).state, "cancelled");
  });

  test("cancelling non-resting ids is rejected", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "2" }));
    engine.submitOrder(order(3));
    for (const id of [ord(1), ord(2), ord(9)]) {
      const [event] = engine.cancelOrder("USDT/RUB", id);
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "order_not_resting");
    }
    const [again] = engine.cancelOrder("USDT/RUB", ord(3));
    assert.equal(again.type, "cancelled");
    const [twice] = engine.cancelOrder("USDT/RUB", ord(3));
    assert.equal(twice.reason, "order_not_resting");
  });

  test("cancel validation rejects malformed inputs", () => {
    const engine = createMatchingEngine();
    let [event] = engine.cancelOrder(42, ord(1));
    assert.equal(event.reason, "invalid_instrument");
    [event] = engine.cancelOrder("BTC/USD", ord(1));
    assert.equal(event.reason, "unknown_instrument");
    [event] = engine.cancelOrder("USDT/RUB", "nope");
    assert.equal(event.reason, "invalid_order_id");
  });
});

describe("order status", () => {
  test("status tracks resting, filled and unknown orders", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "10" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "4" }));
    const resting = engine.orderStatus(ord(1));
    assert.equal(resting.state, "resting");
    assert.equal(resting.remaining_quantity, "6.000000");
    const filled = engine.orderStatus(ord(2));
    assert.equal(filled.state, "filled");
    assert.equal(filled.remaining_quantity, "0.000000");
    assert.equal(engine.orderStatus(ord(99)), null);
    assert.equal(engine.orderStatus(5), null);
    engine.submitOrder(order(3, { price: "bad" }));
    assert.equal(engine.orderStatus(ord(3)), null);
  });
});
