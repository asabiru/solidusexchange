import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import { ord, order } from "./helpers.mjs";

describe("book snapshot", () => {
  test("an empty book has no depth", () => {
    const engine = createMatchingEngine();
    const book = engine.bookSnapshot("USDT/RUB");
    assert.deepEqual(book, { instrument: "USDT/RUB", bids: [], asks: [] });
    const untouched = engine.bookSnapshot("TON/RUB");
    assert.deepEqual(untouched, { instrument: "TON/RUB", bids: [], asks: [] });
  });

  test("unknown instruments throw", () => {
    const engine = createMatchingEngine();
    assert.throws(() => engine.bookSnapshot("BTC/USD"), TypeError);
    assert.throws(() => engine.bookSnapshot(42), TypeError);
  });

  test("depth aggregates quantities per level, best first", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "buy", price: "90", quantity: "1" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "2" }));
    engine.submitOrder(order(3, { side: "buy", price: "91", quantity: "4" }));
    engine.submitOrder(order(4, { side: "sell", price: "95", quantity: "3" }));
    engine.submitOrder(order(5, { side: "sell", price: "94", quantity: "1" }));
    const book = engine.bookSnapshot("USDT/RUB");
    assert.deepEqual(
      book.bids.map((level) => [level.price, level.quantity, level.order_count]),
      [
        ["91.00000000", "4.000000", 1],
        ["90.00000000", "3.000000", 2],
      ],
    );
    assert.deepEqual(
      book.asks.map((level) => [level.price, level.quantity]),
      [
        ["94.00000000", "1.000000"],
        ["95.00000000", "3.000000"],
      ],
    );
  });

  test("FIFO is respected inside a price level", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "3" }));
    engine.submitOrder(order(3, { side: "sell", price: "90", quantity: "4" }));
    const events = engine.submitOrder(order(4, { side: "buy", price: "90", quantity: "6" }));
    const makerFills = events.filter(
      (event) => event.fill_id !== undefined && event.side === "sell",
    );
    assert.deepEqual(
      makerFills.map((event) => [event.maker_order_id, event.type, event.remaining_quantity]),
      [
        [ord(1), "filled", "0.000000"],
        [ord(2), "filled", "0.000000"],
        [ord(3), "partially_filled", "3.000000"],
      ],
    );
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.asks[0].order_count, 1);
    assert.equal(book.asks[0].quantity, "3.000000");
  });

  test("a crossed submission never leaves crossed depth behind", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "3" }));
    engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "5" }));
    const book = engine.bookSnapshot("USDT/RUB");
    const bestBid = book.bids.at(0)?.price;
    const bestAsk = book.asks.at(0)?.price;
    assert.equal(
      bestBid === undefined || bestAsk === undefined || bestBid < bestAsk,
      true,
    );
  });

  test("snapshots are frozen snapshots, not live views", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "3" }));
    const before = engine.bookSnapshot("USDT/RUB");
    engine.cancelOrder("USDT/RUB", ord(1));
    const after = engine.bookSnapshot("USDT/RUB");
    assert.equal(before.asks[0].quantity, "3.000000");
    assert.equal(after.asks.length, 0);
    assert.equal(Object.isFrozen(before), true);
    assert.equal(Object.isFrozen(before.asks), true);
    assert.equal(Object.isFrozen(before.asks[0]), true);
  });

  test("partial fills update depth in place", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "10" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "3" }));
    engine.submitOrder(order(3, { side: "buy", price: "90", quantity: "2" }));
    const book = engine.bookSnapshot("USDT/RUB");
    assert.deepEqual(
      book.asks.map((level) => [level.price, level.quantity, level.order_count]),
      [["90.00000000", "5.000000", 1]],
    );
  });
});
