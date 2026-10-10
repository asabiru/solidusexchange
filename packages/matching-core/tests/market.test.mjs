import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import { replayMatchingEngine, restoreMatchingEngine } from "../src/replay.mjs";
import { fll, marketOrder, ord, order } from "./helpers.mjs";

const AT = "2026-01-01T00:00:00Z";

/**
 * @param {readonly { type: string }[]} events
 */
function types(events) {
  return events.map((event) => event.type);
}

/**
 * @param {readonly object[]} events
 */
function plain(events) {
  return events.map((event) => JSON.parse(JSON.stringify(event)));
}

/**
 * A mixed limit+market stream: two resting asks, one market buy that fills
 * the lot, one market sell that sweeps a bid and is rejected on the rest.
 */
function marketStream() {
  const engine = createMatchingEngine();
  engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "3", owner: "desk-a" }));
  engine.submitOrder(order(2, { side: "sell", price: "92", quantity: "2", owner: "desk-b" }));
  engine.submitOrder(marketOrder(3, { side: "buy", quantity: "5" }));
  engine.submitOrder(order(4, { side: "buy", price: "88", quantity: "2", owner: "desk-c" }));
  engine.submitOrder(marketOrder(5, { side: "sell", quantity: "5", owner: "desk-d" }));
  return { engine, journal: engine.journal() };
}

/**
 * @param {readonly unknown[]} events
 * @param {RegExp} [message]
 */
function assertStreamRejected(events, message) {
  assert.throws(() => replayMatchingEngine({ events }), (error) => {
    assert.equal(error instanceof TypeError, true);
    assert.match(error.message, /invalid event stream/);
    if (message !== undefined) {
      assert.match(error.message, message);
    }
    return true;
  });
}

describe("market order input shape", () => {
  test("type defaults to limit and must be limit or market", () => {
    const engine = createMatchingEngine();
    const implicit = engine.submitOrder(order(1));
    assert.equal(implicit[0].order_type, "limit");
    const explicit = engine.submitOrder(order(2, { type: "limit" }));
    assert.equal(explicit[0].order_type, "limit");
    for (const type of ["market ", "LIMIT", "ioc", "fok", "stop", 5, null, true]) {
      const [event] = engine.submitOrder(marketOrder(3, { type }));
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "invalid_type", JSON.stringify(type));
    }
  });

  test("a market submission must not carry a price", () => {
    const engine = createMatchingEngine();
    for (const bad of [
      { ...marketOrder(1), price: "90" },
      { ...marketOrder(2), price: null },
      { ...marketOrder(3), price: "junk" },
      order(4, { type: "market" }),
    ]) {
      const events = engine.submitOrder(bad);
      assert.deepEqual(types(events), ["rejected"]);
      assert.equal(events[0].reason, "invalid_order", JSON.stringify(bad));
    }
  });

  test("a limit submission still requires a price", () => {
    const engine = createMatchingEngine();
    for (const bad of [
      { order_id: ord(1), instrument: "USDT/RUB", side: "buy", quantity: "1", type: "limit" },
      { order_id: ord(2), instrument: "USDT/RUB", side: "buy", quantity: "1" },
    ]) {
      const [event] = engine.submitOrder(bad);
      assert.equal(event.reason, "invalid_order");
    }
  });

  test("quantities are validated exactly like limit orders", () => {
    const engine = createMatchingEngine();
    const cases = [
      [{ quantity: "abc" }, "invalid_quantity"],
      [{ quantity: "-1" }, "invalid_quantity"],
      [{ quantity: "0.0000001" }, "invalid_quantity"],
      [{ quantity: 5 }, "invalid_quantity"],
      [{ quantity: "0" }, "non_positive_quantity"],
      [{ quantity: "0.000000" }, "non_positive_quantity"],
    ];
    let index = 0;
    for (const [patch, reason] of cases) {
      const [event] = engine.submitOrder(marketOrder(++index, patch));
      assert.equal(event.reason, reason, JSON.stringify(patch));
    }
    const [missing] = engine.submitOrder({
      order_id: ord(9),
      instrument: "USDT/RUB",
      side: "buy",
      type: "market",
    });
    assert.equal(missing.reason, "invalid_order");
  });

  test("a rejected market submission does not consume the order id", () => {
    const engine = createMatchingEngine();
    const [rejected] = engine.submitOrder({ ...marketOrder(1), price: "90" });
    assert.equal(rejected.reason, "invalid_order");
    const events = engine.submitOrder(marketOrder(1));
    assert.equal(types(events)[0], "accepted");
    // Accepted market orders do consume the id even when rejected afterwards.
    const [dup] = engine.submitOrder(marketOrder(1));
    assert.equal(dup.reason, "duplicate_order_id");
  });
});

describe("market matching", () => {
  test("a market buy sweeps the asks, each level at its own price", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "sell", price: "91", quantity: "3" }));
    engine.submitOrder(order(3, { side: "sell", price: "92", quantity: "5" }));
    const events = engine.submitOrder(marketOrder(4, { side: "buy", quantity: "8" }));
    const accepted = events[0];
    assert.equal(accepted.type, "accepted");
    assert.equal(accepted.order_type, "market");
    assert.equal(Object.hasOwn(accepted, "price"), false);
    assert.equal(accepted.quantity, "8.000000");
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
    assert.equal(events.at(-1).remaining_quantity, "0.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.deepEqual(
      book.asks.map((level) => [level.price, level.quantity]),
      [["92.00000000", "2.000000"]],
    );
  });

  test("a market sell sweeps bids from the top down", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "buy", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "3" }));
    const events = engine.submitOrder(marketOrder(3, { side: "sell", quantity: "4" }));
    const fills = events.filter((event) => event.order_id === ord(3) && event.fill_id !== undefined);
    assert.equal(fills[0].price, "91.00000000");
    assert.equal(fills[0].quantity, "3.000000");
    assert.equal(fills[1].price, "90.00000000");
    assert.equal(fills[1].quantity, "1.000000");
    assert.equal(events.at(-1).type, "filled");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids[0].quantity, "1.000000");
  });

  test("an empty opposite side rejects the whole order with insufficient_liquidity", () => {
    const engine = createMatchingEngine();
    const events = engine.submitOrder(marketOrder(1, { side: "buy", quantity: "5" }));
    assert.deepEqual(types(events), ["accepted", "rejected"]);
    const rejection = events[1];
    assert.equal(rejection.reason, "insufficient_liquidity");
    assert.equal(rejection.quantity, "5.000000");
    assert.equal(rejection.posting, "none");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids.length + book.asks.length, 0);
    const status = engine.orderStatus(ord(1));
    assert.equal(status.state, "rejected");
    assert.equal(status.order_type, "market");
    assert.equal(status.price, null);
    assert.equal(status.remaining_quantity, "5.000000");
  });

  test("a partial sweep then exhaustion rejects only the remainder", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "3" }));
    const events = engine.submitOrder(marketOrder(2, { side: "buy", quantity: "5" }));
    assert.deepEqual(types(events), ["accepted", "filled", "partially_filled", "rejected"]);
    const [makerFill, takerFill, rejection] = events.slice(1);
    assert.equal(makerFill.quantity, "3.000000");
    assert.equal(takerFill.quantity, "3.000000");
    assert.equal(takerFill.remaining_quantity, "2.000000");
    assert.equal(rejection.reason, "insufficient_liquidity");
    assert.equal(rejection.quantity, "2.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.asks.length, 0);
    const status = engine.orderStatus(ord(2));
    assert.equal(status.state, "rejected");
    assert.equal(status.remaining_quantity, "2.000000");
  });

  test("market orders never rest, so two market orders never cross", () => {
    const engine = createMatchingEngine();
    const sell = engine.submitOrder(marketOrder(1, { side: "sell", quantity: "5" }));
    assert.equal(sell[1].reason, "insufficient_liquidity");
    const buy = engine.submitOrder(marketOrder(2, { side: "buy", quantity: "4" }));
    assert.equal(buy[1].reason, "insufficient_liquidity");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids.length + book.asks.length, 0);
    // The first market order never entered the book, so a later limit order
    // crosses a fresh market taker, not it.
    engine.submitOrder(order(3, { side: "sell", price: "90", quantity: "4" }));
    const events = engine.submitOrder(marketOrder(4, { side: "buy", quantity: "4" }));
    assert.equal(events.at(-1).type, "filled");
    assert.equal(events.at(-1).price, "90.00000000");
    assert.equal(engine.orderStatus(ord(1)).state, "rejected");
    assert.equal(engine.orderStatus(ord(3)).state, "filled");
  });

  test("a filled market order is tracked with no price and never rests", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(marketOrder(2, { side: "buy", quantity: "2" }));
    const status = engine.orderStatus(ord(2));
    assert.equal(status.order_type, "market");
    assert.equal(status.price, null);
    assert.equal(status.state, "filled");
    const [cancelled] = engine.cancelOrder("USDT/RUB", ord(2));
    assert.equal(cancelled.type, "rejected");
    assert.equal(cancelled.reason, "order_not_resting");
  });

  test("self-trade policy applies to market takers", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5", owner: "desk-a" }));
    const events = engine.submitOrder(marketOrder(2, { side: "buy", quantity: "10", owner: "desk-a" }));
    assert.deepEqual(types(events), ["accepted", "rejected"]);
    const rejection = events[1];
    assert.equal(rejection.reason, "self_trade");
    assert.equal(rejection.quantity, "10.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.asks[0].quantity, "5.000000");
  });

  test("self-trade bites after honest fills on a market sweep", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "89", quantity: "2", owner: "desk-b" }));
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "5", owner: "desk-a" }));
    const events = engine.submitOrder(marketOrder(3, { side: "buy", quantity: "10", owner: "desk-a" }));
    assert.deepEqual(types(events), ["accepted", "filled", "partially_filled", "rejected"]);
    const rejection = events.at(-1);
    assert.equal(rejection.reason, "self_trade");
    assert.equal(rejection.quantity, "8.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.asks[0].price, "90.00000000");
    assert.equal(book.asks[0].quantity, "5.000000");
  });

  test("the same market transcript replays byte-identically", () => {
    const first = marketStream();
    const second = marketStream();
    assert.equal(JSON.stringify(second.journal), JSON.stringify(first.journal));
    for (const instrument of ["USDT/RUB", "TON/RUB"]) {
      assert.equal(
        JSON.stringify(second.engine.bookSnapshot(instrument)),
        JSON.stringify(first.engine.bookSnapshot(instrument)),
      );
    }
  });
});

describe("market orders through replay and restore", () => {
  test("live, replayed and restored engines agree byte-identically on market streams", () => {
    const { engine, journal } = marketStream();
    const replayed = replayMatchingEngine({ events: journal });
    const restored = restoreMatchingEngine(engine.snapshot());
    for (const instrument of ["USDT/RUB", "TON/RUB"]) {
      const expected = JSON.stringify(engine.bookSnapshot(instrument));
      assert.equal(JSON.stringify(replayed.bookSnapshot(instrument)), expected);
      assert.equal(JSON.stringify(restored.bookSnapshot(instrument)), expected);
    }
    for (const id of [1, 2, 3, 4, 5].map(ord)) {
      const expected = JSON.stringify(engine.orderStatus(id));
      assert.equal(JSON.stringify(replayed.orderStatus(id)), expected);
      assert.equal(JSON.stringify(restored.orderStatus(id)), expected);
    }
    assert.equal(JSON.stringify(replayed.journal()), JSON.stringify(journal));
    // Snapshots record market orders with order_type and a null price.
    const snapshot = engine.snapshot();
    const market = snapshot.orders.find((entry) => entry.order_id === ord(5));
    assert.equal(market.order_type, "market");
    assert.equal(market.price, null);
    assert.equal(market.state, "rejected");
    assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
  });

  test("rejects streams with a malformed market accepted shape", () => {
    const { journal } = marketStream();
    const acceptedIndex = journal.findIndex((event) => event.order_id === ord(3));
    assert.notEqual(acceptedIndex, -1);
    const accepted = plain([journal[acceptedIndex]])[0];

    const withPrice = plain(journal.slice(0, acceptedIndex));
    withPrice.push({ ...accepted, seq: withPrice.length + 1, price: "90.00000000" });
    assertStreamRejected(withPrice, /carry no price/);

    const badType = plain(journal.slice(0, acceptedIndex));
    badType.push({ ...accepted, seq: badType.length + 1, order_type: "ioc" });
    assertStreamRejected(badType, /invalid order_type/);

    const missingType = plain(journal.slice(0, acceptedIndex));
    const { order_type: _orderType, ...withoutType } = accepted;
    missingType.push({ ...withoutType, seq: missingType.length + 1 });
    assertStreamRejected(missingType, /invalid order_type/);
  });

  test("rejects a resting event for a market order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(marketOrder(1, { side: "sell", quantity: "5" }));
    const stream = plain(engine.journal()).slice(0, 1);
    stream.push({
      seq: 2,
      at: AT,
      type: "resting",
      order_id: ord(1),
      instrument: "USDT/RUB",
      side: "sell",
      price: "90.00000000",
      quantity: "5.000000",
      posting: "none",
    });
    assertStreamRejected(stream, /never rest/);
  });

  test("rejects insufficient_liquidity where the stream never earned it", () => {
    const { journal } = marketStream();
    const rejectedIndex = journal.findIndex(
      (event) => event.type === "rejected" && event.reason === "insufficient_liquidity",
    );
    assert.notEqual(rejectedIndex, -1);

    const wrongQuantity = plain(journal);
    wrongQuantity[rejectedIndex] = { ...wrongQuantity[rejectedIndex], quantity: "4.000000" };
    assertStreamRejected(wrongQuantity, /not the tracked remainder/);

    const renamedReason = plain(journal);
    renamedReason[rejectedIndex] = { ...renamedReason[rejectedIndex], reason: "no_liquidity" };
    assertStreamRejected(renamedReason, /unknown reject reason/);

    const limitVictim = plain(journal);
    limitVictim[rejectedIndex] = { ...limitVictim[rejectedIndex], order_id: ord(4), side: "buy" };
    assertStreamRejected(limitVictim, /only rejects market orders/);
  });

  test("rejects a fill whose maker is a market order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(marketOrder(1, { side: "sell", quantity: "5" }));
    const stream = plain(engine.journal()).slice(0, 1);
    stream.push(
      {
        seq: 2,
        at: AT,
        type: "accepted",
        order_id: ord(2),
        instrument: "USDT/RUB",
        side: "buy",
        order_type: "limit",
        price: "90.00000000",
        quantity: "5.000000",
        posting: "none",
      },
      {
        seq: 3,
        at: AT,
        type: "filled",
        order_id: ord(1),
        instrument: "USDT/RUB",
        side: "sell",
        fill_id: fll(1),
        maker_order_id: ord(1),
        taker_order_id: ord(2),
        price: null,
        quantity: "5.000000",
        remaining_quantity: "0.000000",
        posting: "none",
      },
    );
    assertStreamRejected(stream, /maker is not resting/);
  });
});
