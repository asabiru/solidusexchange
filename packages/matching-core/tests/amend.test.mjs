import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSimulatedClock, toIsoSeconds } from "../src/deterministic.mjs";
import { createMatchingEngine } from "../src/engine.mjs";
import { replayMatchingEngine, restoreMatchingEngine } from "../src/replay.mjs";
import { marketOrder, ord, order } from "./helpers.mjs";

const AT = "2026-01-01T00:00:00Z";
const INSTRUMENTS = ["USDT/RUB", "TON/RUB", "TON/USDT"];

/**
 * @param {readonly { type: string }[]} events
 */
function types(events) {
  return events.map((event) => event.type);
}

/**
 * An amend-heavy deterministic scenario: kept-slot decreases, re-queued
 * increases and price changes, crossed amends that sweep levels, a
 * self-trade rejection and rejected amends.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 */
function amendScenario(engine) {
  return [
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2", owner: "desk-a" })),
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "3", owner: "desk-b" })),
    engine.submitOrder(order(3, { side: "sell", price: "91", quantity: "5", owner: "desk-c" })),
    engine.submitOrder(order(4, { side: "buy", price: "88", quantity: "4", owner: "desk-d" })),
    engine.submitOrder(order(5, { side: "buy", price: "89", quantity: "6", owner: "desk-e" })),
    engine.amendOrder({ order_id: ord(3), quantity: "4" }),
    engine.amendOrder({ order_id: ord(2), quantity: "5" }),
    engine.amendOrder({ order_id: ord(4), price: "87" }),
    engine.amendOrder({ order_id: ord(5), price: "90" }),
    engine.amendOrder({ order_id: ord(9), quantity: "1" }),
    engine.submitOrder(order(6, { side: "buy", price: "92", quantity: "8", owner: "desk-f" })),
    engine.amendOrder({ order_id: ord(1), price: "95" }),
    engine.cancelOrder("USDT/RUB", ord(4)),
    engine.submitOrder(order(20, { instrument: "TON/RUB", side: "sell", price: "150", quantity: "2", owner: "desk-g" })),
    engine.submitOrder(order(21, { instrument: "TON/RUB", side: "buy", price: "149", quantity: "1", owner: "desk-h" })),
    engine.amendOrder({ order_id: ord(21), price: "150" }),
    engine.submitOrder(marketOrder(7, { side: "sell", quantity: "9", owner: "desk-i" })),
  ].flat();
}

describe("amend validation", () => {
  test("non-object and wrong-shape inputs are rejected", () => {
    const engine = createMatchingEngine();
    for (const input of [null, undefined, 5, "x", [1], () => {}]) {
      const [event] = engine.amendOrder(input);
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "invalid_order");
      assert.equal(event.posting, "none");
    }
    for (const bad of [
      {},
      { order_id: ord(1) },
      { price: "90", quantity: "1" },
      { order_id: ord(1), side: "buy" },
      { order_id: ord(1), instrument: "USDT/RUB", price: "90" },
      { order_id: ord(1), price: "90", extra: true },
    ]) {
      const [event] = engine.amendOrder(bad);
      assert.equal(event.reason, "invalid_order", JSON.stringify(bad));
    }
  });

  test("malformed order ids are rejected", () => {
    const engine = createMatchingEngine();
    for (const id of ["", "x", `ORD_${"0".repeat(24)}`, `ord_${"z".repeat(24)}`, 7]) {
      const [event] = engine.amendOrder({ order_id: id, quantity: "1" });
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "invalid_order_id", String(id));
    }
  });

  test("bad prices and quantities are rejected", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5" }));
    const cases = [
      [{ price: "abc" }, "invalid_price"],
      [{ price: "-5" }, "invalid_price"],
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
    for (const [patch, reason] of cases) {
      const [event] = engine.amendOrder({ order_id: ord(1), ...patch });
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, reason, JSON.stringify(patch));
      assert.equal(event.order_id, ord(1));
      assert.equal(event.instrument, "USDT/RUB");
      assert.equal(event.side, "sell");
    }
  });

  test("amends on non-resting ids are rejected with order_not_resting", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "2" }));
    engine.submitOrder(order(3, { side: "sell", price: "95", quantity: "1" }));
    engine.cancelOrder("USDT/RUB", ord(3));
    engine.submitOrder(order(4, { price: "junk" }));
    // ord 1 filled, ord 2 filled, ord 3 cancelled, ord 4 never accepted,
    // ord 9 unknown — every non-resting id rejects the same way.
    for (const id of [ord(1), ord(2), ord(3), ord(4), ord(9)]) {
      const [event] = engine.amendOrder({ order_id: id, quantity: "9" });
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "order_not_resting", id);
    }
  });

  test("market orders can never be amended", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(marketOrder(2, { side: "buy", quantity: "2" }));
    // The market order filled without resting: a tracked order exists but
    // is not resting, so its amend is rejected like any other non-resting.
    const [event] = engine.amendOrder({ order_id: ord(2), quantity: "3" });
    assert.equal(event.type, "rejected");
    assert.equal(event.reason, "order_not_resting");
    assert.equal(engine.orderStatus(ord(2)).order_type, "market");
  });

  test("an amend that changes nothing is rejected with no_change", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5" }));
    for (const input of [
      { order_id: ord(1), price: "90" },
      { order_id: ord(1), quantity: "5" },
      { order_id: ord(1), price: "90.00000000", quantity: "5.000000" },
    ]) {
      const [event] = engine.amendOrder(input);
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "no_change", JSON.stringify(input));
      assert.equal(event.order_id, ord(1));
    }
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });

  test("a total quantity at or below the filled part is rejected", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "10" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "4" }));
    // ord 1 has executed 4 of 10: totals of 4 or less leave nothing open.
    for (const total of ["4", "2", "0.000001"]) {
      const [event] = engine.amendOrder({ order_id: ord(1), quantity: total });
      assert.equal(event.type, "rejected");
      assert.equal(event.reason, "quantity_below_filled", total);
    }
    const [kept] = engine.amendOrder({ order_id: ord(1), quantity: "5" });
    assert.equal(kept.type, "amended");
    assert.equal(engine.orderStatus(ord(1)).remaining_quantity, "1.000000");
  });
});

describe("amendment semantics", () => {
  test("the amended event is frozen data carrying old and new totals", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5", owner: "desk-a" }));
    const [event] = engine.amendOrder({ order_id: ord(1), price: "91", quantity: "7" });
    assert.equal(event.type, "amended");
    assert.equal(event.order_id, ord(1));
    assert.equal(event.instrument, "USDT/RUB");
    assert.equal(event.side, "sell");
    assert.equal(event.previous_price, "90.00000000");
    assert.equal(event.previous_quantity, "5.000000");
    assert.equal(event.price, "91.00000000");
    assert.equal(event.quantity, "7.000000");
    assert.equal(event.posting, "none");
    assert.equal(Object.isFrozen(event), true);
    // quantity is the new TOTAL, and the tracked order kept its identity.
    const status = engine.orderStatus(ord(1));
    assert.equal(status.order_id, ord(1));
    assert.equal(status.price, "91.00000000");
    assert.equal(status.quantity, "7.000000");
    assert.equal(status.order_type, "limit");
    assert.equal(status.state, "resting");
  });

  test("a non-crossing price amend emits amended then resting at the new level", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const events = engine.amendOrder({ order_id: ord(1), price: "92" });
    assert.deepEqual(types(events), ["amended", "resting"]);
    const [amended, resting] = events;
    assert.equal(amended.price, "92.00000000");
    assert.equal(resting.price, "92.00000000");
    assert.equal(resting.quantity, "2.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.deepEqual(book.asks.map((level) => level.price), ["92.00000000"]);
    // The book never holds a crossed level: amending down is symmetric.
    const reprice = engine.amendOrder({ order_id: ord(1), price: "89" });
    assert.deepEqual(types(reprice), ["amended", "resting"]);
    assert.equal(engine.bookSnapshot("USDT/RUB").asks[0].price, "89.00000000");
  });

  test("a quantity decrease keeps the order's slot in its level's FIFO", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "3" }));
    engine.submitOrder(order(3, { side: "sell", price: "90", quantity: "4" }));
    const events = engine.amendOrder({ order_id: ord(2), quantity: "1" });
    assert.deepEqual(types(events), ["amended"]);
    // ord 2 kept its queue slot: a 3-unit taker fills ord 1 then ord 2.
    const fills = engine
      .submitOrder(order(4, { side: "buy", price: "90", quantity: "3" }))
      .filter((event) => event.fill_id !== undefined && event.order_id === event.maker_order_id);
    assert.deepEqual(
      fills.map((event) => event.order_id),
      [ord(1), ord(2)],
    );
    assert.deepEqual(
      engine.bookSnapshot("USDT/RUB").asks.map((level) => level.quantity),
      ["4.000000"],
    );
  });

  test("a quantity increase re-queues at the level's tail", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "3" }));
    engine.submitOrder(order(3, { side: "sell", price: "90", quantity: "4" }));
    const events = engine.amendOrder({ order_id: ord(1), quantity: "5" });
    assert.deepEqual(types(events), ["amended", "resting"]);
    // ord 1 moved behind ords 2 and 3: the taker hits them first.
    const fills = engine
      .submitOrder(order(4, { side: "buy", price: "90", quantity: "7" }))
      .filter((event) => event.fill_id !== undefined && event.order_id === event.maker_order_id);
    assert.deepEqual(
      fills.map((event) => event.order_id),
      [ord(2), ord(3)],
    );
    assert.equal(engine.orderStatus(ord(1)).remaining_quantity, "5.000000");
  });

  test("a price change re-queues at the new level's tail", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "3" }));
    engine.submitOrder(order(3, { side: "sell", price: "91", quantity: "4" }));
    engine.amendOrder({ order_id: ord(1), price: "91" });
    // ord 1 is behind ord 3 at 91 now: ord 2 fills first at 90, then ord 3.
    const fills = engine
      .submitOrder(order(4, { side: "buy", price: "91", quantity: "7" }))
      .filter((event) => event.fill_id !== undefined && event.order_id === event.maker_order_id);
    assert.deepEqual(
      fills.map((event) => event.order_id),
      [ord(2), ord(3)],
    );
    assert.deepEqual(
      engine.bookSnapshot("USDT/RUB").asks.map((level) => [level.price, level.quantity]),
      [["91.00000000", "2.000000"]],
    );
  });

  test("a decrease on a partially filled order keeps priority", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "10" }));
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "5" }));
    engine.submitOrder(order(3, { side: "buy", price: "90", quantity: "4" }));
    // ord 1 executed 4 and holds 6 ahead of ord 2; amending the total to 8
    // leaves 4 open and must not give up the slot.
    const events = engine.amendOrder({ order_id: ord(1), quantity: "8" });
    assert.deepEqual(types(events), ["amended"]);
    const fills = engine
      .submitOrder(order(4, { side: "buy", price: "90", quantity: "5" }))
      .filter((event) => event.fill_id !== undefined && event.order_id === event.maker_order_id);
    assert.deepEqual(
      fills.map((event) => event.order_id),
      [ord(1), ord(2)],
    );
    assert.equal(engine.orderStatus(ord(1)).state, "filled");
  });

  test("a crossed amend sweeps the book at maker prices in the same call", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "sell", price: "91", quantity: "3" }));
    engine.submitOrder(order(3, { side: "buy", price: "85", quantity: "10" }));
    const events = engine.amendOrder({ order_id: ord(3), price: "91" });
    assert.deepEqual(types(events), [
      "amended",
      "filled",
      "partially_filled",
      "filled",
      "partially_filled",
      "resting",
    ]);
    const makerFills = events.filter(
      (event) => event.fill_id !== undefined && event.order_id === event.maker_order_id,
    );
    assert.deepEqual(
      makerFills.map((event) => [event.order_id, event.price, event.quantity]),
      [
        [ord(1), "90.00000000", "2.000000"],
        [ord(2), "91.00000000", "3.000000"],
      ],
    );
    // The amended taker rests the remainder at its new limit — never crossed.
    const resting = events.at(-1);
    assert.equal(resting.order_id, ord(3));
    assert.equal(resting.price, "91.00000000");
    assert.equal(resting.quantity, "5.000000");
    const book = engine.bookSnapshot("USDT/RUB");
    assert.equal(book.bids[0].price, "91.00000000");
    assert.equal(book.asks.length, 0);
  });

  test("a crossed amend that fills completely ends with the taker filled", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5" }));
    engine.submitOrder(order(2, { side: "buy", price: "85", quantity: "5" }));
    const events = engine.amendOrder({ order_id: ord(2), price: "90" });
    assert.deepEqual(types(events), ["amended", "filled", "filled"]);
    assert.equal(engine.orderStatus(ord(2)).state, "filled");
    assert.equal(engine.bookSnapshot("USDT/RUB").bids.length, 0);
  });

  test("a crossed sell amend sweeps bids from the top down", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "buy", price: "91", quantity: "3" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "2" }));
    engine.submitOrder(order(3, { side: "sell", price: "95", quantity: "4" }));
    const events = engine.amendOrder({ order_id: ord(3), price: "90" });
    const makerFills = events.filter(
      (event) => event.fill_id !== undefined && event.order_id === event.maker_order_id,
    );
    assert.deepEqual(
      makerFills.map((event) => [event.order_id, event.price, event.quantity]),
      [
        [ord(1), "91.00000000", "3.000000"],
        [ord(2), "90.00000000", "1.000000"],
      ],
    );
    assert.equal(events.at(-1).type, "filled");
    assert.equal(engine.bookSnapshot("USDT/RUB").bids[0].quantity, "1.000000");
  });

  test("a priority-losing amend respects the self-trade policy", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5", owner: "desk-a" }));
    engine.submitOrder(order(2, { side: "buy", price: "85", quantity: "5", owner: "desk-a" }));
    const events = engine.amendOrder({ order_id: ord(2), price: "91" });
    assert.deepEqual(types(events), ["amended", "rejected"]);
    const rejection = events.at(-1);
    assert.equal(rejection.reason, "self_trade");
    assert.equal(rejection.quantity, "5.000000");
    assert.equal(engine.orderStatus(ord(2)).state, "rejected");
    assert.equal(engine.bookSnapshot("USDT/RUB").asks[0].quantity, "5.000000");
  });

  test("a self-trade bites only after honest fills mid-amend", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2", owner: "desk-b" }));
    engine.submitOrder(order(2, { side: "sell", price: "91", quantity: "5", owner: "desk-a" }));
    engine.submitOrder(order(3, { side: "buy", price: "85", quantity: "10", owner: "desk-a" }));
    const events = engine.amendOrder({ order_id: ord(3), price: "92" });
    assert.deepEqual(types(events), [
      "amended",
      "filled",
      "partially_filled",
      "rejected",
    ]);
    const rejection = events.at(-1);
    assert.equal(rejection.reason, "self_trade");
    assert.equal(rejection.quantity, "8.000000");
    assert.equal(engine.bookSnapshot("USDT/RUB").asks[0].price, "91.00000000");
  });

  test("identity survives every amend path and re-pricing", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "4", owner: "desk-a" }));
    engine.amendOrder({ order_id: ord(1), price: "91" });
    engine.amendOrder({ order_id: ord(1), quantity: "6" });
    engine.amendOrder({ order_id: ord(1), price: "89", quantity: "3" });
    const status = engine.orderStatus(ord(1));
    assert.equal(status.order_id, ord(1));
    assert.equal(status.price, "89.00000000");
    assert.equal(status.quantity, "3.000000");
    assert.equal(status.remaining_quantity, "3.000000");
    assert.equal(status.state, "resting");
    // The id stays consumed: resubmitting it is a duplicate.
    const [event] = engine.submitOrder(order(1, { side: "buy" }));
    assert.equal(event.reason, "duplicate_order_id");
  });

  test("one amend operation stamps all of its events at one clock read", () => {
    const clock = createSimulatedClock();
    const engine = createMatchingEngine({ clock });
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "buy", price: "85", quantity: "2" }));
    clock.advance(30);
    const events = engine.amendOrder({ order_id: ord(2), price: "90" });
    assert.equal(events.length > 1, true);
    for (const event of events) {
      assert.equal(event.at, toIsoSeconds(clock.now()));
    }
  });
});

describe("amend replay", () => {
  test("live, replayed and restored engines agree byte-identically on the amend scenario", () => {
    const live = createMatchingEngine();
    const events = amendScenario(live);
    assert.equal(events.some((event) => event.type === "amended"), true);
    assert.equal(JSON.stringify(events), JSON.stringify(live.journal()));
    const replayed = replayMatchingEngine({ events: live.journal() });
    const restored = restoreMatchingEngine(live.snapshot());
    for (const instrument of INSTRUMENTS) {
      const expected = JSON.stringify(live.bookSnapshot(instrument));
      assert.equal(JSON.stringify(replayed.bookSnapshot(instrument)), expected);
      assert.equal(JSON.stringify(restored.bookSnapshot(instrument)), expected);
    }
    for (const id of [1, 2, 3, 4, 5, 6, 7, 20, 21].map(ord)) {
      const expected = JSON.stringify(live.orderStatus(id));
      assert.equal(JSON.stringify(replayed.orderStatus(id)), expected);
      assert.equal(JSON.stringify(restored.orderStatus(id)), expected);
    }
    // Snapshots carry owners, which accepted events do not record: the
    // replay agrees everywhere except owner fields, so byte-equality is
    // pinned on the restored engine instead.
    assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(live.snapshot()));
  });

  test("the amend scenario is byte-identical across engines", () => {
    const first = createMatchingEngine();
    const second = createMatchingEngine();
    assert.equal(JSON.stringify(amendScenario(first)), JSON.stringify(amendScenario(second)));
    assert.equal(JSON.stringify(first.journal()), JSON.stringify(second.journal()));
  });

  test("snapshot round-trips through amended orders", () => {
    const engine = createMatchingEngine();
    amendScenario(engine);
    const snapshot = JSON.parse(JSON.stringify(engine.snapshot()));
    const restored = restoreMatchingEngine(snapshot);
    assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
  });

  test("submissions and amends after replay continue seq numbering", () => {
    const engine = createMatchingEngine();
    amendScenario(engine);
    const replayed = replayMatchingEngine({ events: engine.journal() });
    const base = engine.journal().length;
    const [amended] = replayed.amendOrder({ order_id: ord(20), quantity: "3" });
    assert.equal(amended.seq, base + 1);
    const [accepted] = replayed.submitOrder(order(30, { side: "sell", price: "97" }));
    assert.equal(accepted.seq, base + 3);
  });
});

describe("amend stream validation", () => {
  /**
   * @param {readonly unknown[]} events
   * @param {RegExp | undefined} message
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

  function amendJournal() {
    const engine = createMatchingEngine();
    amendScenario(engine);
    return engine.journal().map((event) => JSON.parse(JSON.stringify(event)));
  }

  test("rejects amends of never-accepted and non-resting orders", () => {
    const journal = amendJournal();
    const next = journal.length + 1;
    const neverAccepted = [
      ...journal,
      {
        seq: next,
        at: AT,
        type: "amended",
        order_id: ord(42),
        instrument: "USDT/RUB",
        side: "sell",
        previous_price: "90.00000000",
        previous_quantity: "1.000000",
        price: "91.00000000",
        quantity: "1.000000",
        posting: "none",
      },
    ];
    assertStreamRejected(neverAccepted, /never accepted/);
    // ord 1 is long filled by the end of the scenario.
    const filledOrder = [
      ...journal,
      {
        seq: next,
        at: AT,
        type: "amended",
        order_id: ord(1),
        instrument: "USDT/RUB",
        side: "sell",
        previous_price: "95.00000000",
        previous_quantity: "2.000000",
        price: "96.00000000",
        quantity: "2.000000",
        posting: "none",
      },
    ];
    assertStreamRejected(filledOrder, /not resting/);
  });

  test("rejects amends whose previous values drift from tracked state", () => {
    const journal = amendJournal();
    const wrongPrice = journal.map((event) =>
      event.type === "amended" ? { ...event, previous_price: "1.00000000" } : event,
    );
    assertStreamRejected(wrongPrice, /previous price/);
    const wrongQuantity = journal.map((event) =>
      event.type === "amended" ? { ...event, previous_quantity: "9.000000" } : event,
    );
    assertStreamRejected(wrongQuantity, /previous quantity/);
  });

  test("rejects malformed amend payloads", () => {
    const journal = amendJournal();
    const index = journal.findIndex((event) => event.type === "amended");
    assert.notEqual(index, -1);
    const cases = [
      { ...journal[index], price: "0.00000000" },
      { ...journal[index], price: "junk" },
      { ...journal[index], quantity: "0.000000" },
      { ...journal[index], quantity: "junk" },
      { ...journal[index], extra: true },
      { ...journal[index], order_id: "bogus" },
      { ...journal[index], instrument: "TON/RUB" },
      { ...journal[index], price: journal[index].previous_price, quantity: journal[index].previous_quantity },
    ];
    for (const bad of cases) {
      const stream = journal.map((event, eventIndex) => (eventIndex === index ? bad : event));
      assertStreamRejected(stream, undefined);
    }
    // A missing previous_price / price is caught the same way.
    for (const key of ["previous_price", "previous_quantity", "price", "quantity"]) {
      const dropped = { ...journal[index] };
      delete dropped[key];
      const stream = journal.map((event, eventIndex) => (eventIndex === index ? dropped : event));
      assertStreamRejected(stream, undefined);
    }
  });

  test("rejects an amend that lands mid fill pair", () => {
    const journal = amendJournal();
    const pairStart = journal.findIndex(
      (event, index) =>
        (event.type === "filled" || event.type === "partially_filled") &&
        index + 1 < journal.length &&
        event.order_id === event.maker_order_id,
    );
    assert.notEqual(pairStart, -1);
    // Insert an amend event between the maker and taker halves of a pair.
    const mid = journal[pairStart];
    const stream = [
      ...journal.slice(0, pairStart + 1),
      {
        seq: mid.seq + 1,
        at: mid.at,
        type: "amended",
        order_id: ord(4),
        instrument: "USDT/RUB",
        side: "buy",
        previous_price: "87.00000000",
        previous_quantity: "4.000000",
        price: "86.00000000",
        quantity: "4.000000",
        posting: "none",
      },
      ...journal.slice(pairStart + 1),
    ].map((event, index) => ({ ...event, seq: index + 1 }));
    assertStreamRejected(stream, /fill pair/);
  });

  test("rejects a stream ending right after a re-queueing amend", () => {
    const journal = amendJournal();
    // ord 5's price amend re-queues it: the stream must carry its follow-up.
    const index = journal.findIndex(
      (event) => event.type === "amended" && event.order_id === ord(5),
    );
    assert.notEqual(index, -1);
    assert.equal(journal[index + 1].type === "resting" || journal[index + 1].fill_id !== undefined, true);
    assertStreamRejected(journal.slice(0, index + 1));
  });

  test("rejects a resting event for a still-resting amended order", () => {
    const journal = amendJournal();
    // ord 3's decrease kept its slot: a resting event on top is impossible.
    const index = journal.findIndex(
      (event) => event.type === "amended" && event.order_id === ord(3),
    );
    assert.notEqual(index, -1);
    const amended = journal[index];
    const stream = [
      ...journal.slice(0, index + 1),
      {
        seq: amended.seq + 1,
        at: amended.at,
        type: "resting",
        order_id: ord(3),
        instrument: "USDT/RUB",
        side: "sell",
        price: "91.00000000",
        quantity: "4.000000",
        posting: "none",
      },
    ].map((event, position) => ({ ...event, seq: position + 1 }));
    assertStreamRejected(stream, /not in flight/);
  });
});
