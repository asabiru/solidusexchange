import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import { replayMatchingEngine, restoreMatchingEngine } from "../src/replay.mjs";
import { SNAPSHOT_KIND, SNAPSHOT_VERSION } from "../src/snapshot.mjs";
import { fll, ord, order } from "./helpers.mjs";

const AT = "2026-01-01T00:00:00Z";

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

/**
 * @param {unknown} snapshot
 */
function assertSnapshotRejected(snapshot) {
  assert.throws(() => restoreMatchingEngine(snapshot), (error) => {
    assert.equal(error instanceof TypeError, true);
    assert.match(error.message, /invalid engine snapshot/);
    return true;
  });
}

describe("submission atomicity", () => {
  test("a backwards clock fails a submission before any state is touched", () => {
    let current = 1000;
    const clock = { now: () => current };
    const engine = createMatchingEngine({ clock });
    engine.submitOrder(order(1));
    current = 500;
    assert.throws(() => engine.submitOrder(order(2)), RangeError);
    // The thrown submission left nothing behind: no tracked order, no
    // consumed order id, no journal entry.
    assert.equal(engine.orderStatus(ord(2)), null);
    assert.equal(
      engine.journal().filter((event) => event.order_id === ord(2)).length,
      0,
    );
    current = 2000;
    const events = engine.submitOrder(order(2));
    assert.equal(events[0].type, "accepted");
  });

  test("a non-integer clock fails a submission before any state is touched", () => {
    const engine = createMatchingEngine({ clock: { now: () => 1767225600.5 } });
    assert.throws(() => engine.submitOrder(order(1)), RangeError);
    assert.equal(engine.orderStatus(ord(1)), null);
    assert.equal(engine.journal().length, 0);
  });

  test("a thrown submission cannot ghost an order into the book via a snapshot", () => {
    let current = 1000;
    const clock = { now: () => current };
    const engine = createMatchingEngine({ clock });
    engine.submitOrder(order(1, { side: "sell", price: "90" }));
    current = 500;
    assert.throws(
      () => engine.submitOrder(order(2, { side: "sell", price: "77" })),
      RangeError,
    );
    current = 2000;
    engine.submitOrder(order(3, { side: "sell", price: "95" }));
    // Two rejected submissions keep the stream contiguous without touching
    // the book — the snapshot must not contain a 77 ask either way.
    engine.submitOrder(order(9, { price: "junk" }));
    engine.submitOrder(order(9, { price: "junk" }));
    const restored = restoreMatchingEngine(engine.snapshot());
    assert.deepEqual(
      restored.bookSnapshot("USDT/RUB").asks.map((level) => level.price),
      ["90.00000000", "95.00000000"],
    );
    assert.equal(restored.orderStatus(ord(2)), null);
  });

  test("a backwards clock fails a cancel before any state is touched", () => {
    let current = 1000;
    const clock = { now: () => current };
    const engine = createMatchingEngine({ clock });
    engine.submitOrder(order(1, { side: "sell", price: "90" }));
    current = 500;
    assert.throws(() => engine.cancelOrder("USDT/RUB", ord(1)), RangeError);
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
    assert.equal(engine.bookSnapshot("USDT/RUB").asks.length, 1);
    current = 2000;
    const [cancelled] = engine.cancelOrder("USDT/RUB", ord(1));
    assert.equal(cancelled.type, "cancelled");
  });
});

describe("replay limit enforcement", () => {
  test("rejects a fill whose price is outside the taker's limit (buy)", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "95", quantity: "2" }));
    const stream = JSON.parse(JSON.stringify(engine.journal()));
    const seq = stream.length;
    // A buy limited to 90 could never fill a 95 ask: the live engine rests it.
    stream.push(
      {
        seq: seq + 1,
        at: AT,
        type: "accepted",
        order_id: ord(2),
        instrument: "USDT/RUB",
        side: "buy",
        order_type: "limit",
        price: "90.00000000",
        quantity: "2.000000",
        posting: "none",
      },
      {
        seq: seq + 2,
        at: AT,
        type: "filled",
        order_id: ord(1),
        instrument: "USDT/RUB",
        side: "sell",
        fill_id: fll(1),
        maker_order_id: ord(1),
        taker_order_id: ord(2),
        price: "95.00000000",
        quantity: "2.000000",
        remaining_quantity: "0.000000",
        posting: "none",
      },
      {
        seq: seq + 3,
        at: AT,
        type: "filled",
        order_id: ord(2),
        instrument: "USDT/RUB",
        side: "buy",
        fill_id: fll(1),
        maker_order_id: ord(1),
        taker_order_id: ord(2),
        price: "95.00000000",
        quantity: "2.000000",
        remaining_quantity: "0.000000",
        posting: "none",
      },
    );
    assertStreamRejected(stream, /limit/);
  });

  test("rejects a fill whose price is outside the taker's limit (sell)", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "buy", price: "90", quantity: "2" }));
    const stream = JSON.parse(JSON.stringify(engine.journal()));
    const seq = stream.length;
    // A sell limited to 92 could never fill a 90 bid.
    stream.push(
      {
        seq: seq + 1,
        at: AT,
        type: "accepted",
        order_id: ord(2),
        instrument: "USDT/RUB",
        side: "sell",
        order_type: "limit",
        price: "92.00000000",
        quantity: "2.000000",
        posting: "none",
      },
      {
        seq: seq + 2,
        at: AT,
        type: "filled",
        order_id: ord(1),
        instrument: "USDT/RUB",
        side: "buy",
        fill_id: fll(1),
        maker_order_id: ord(1),
        taker_order_id: ord(2),
        price: "90.00000000",
        quantity: "2.000000",
        remaining_quantity: "0.000000",
        posting: "none",
      },
      {
        seq: seq + 3,
        at: AT,
        type: "filled",
        order_id: ord(2),
        instrument: "USDT/RUB",
        side: "sell",
        fill_id: fll(1),
        maker_order_id: ord(1),
        taker_order_id: ord(2),
        price: "90.00000000",
        quantity: "2.000000",
        remaining_quantity: "0.000000",
        posting: "none",
      },
    );
    assertStreamRejected(stream, /limit/);
  });
});

describe("instrument registry input snapshotting", () => {
  test("a definition is snapshotted once: getters cannot flip fields after validation", () => {
    let reads = 0;
    const slippery = {
      instrument: "AAA/BBB",
      base_asset: "AAA",
      quote_asset: "BBB",
      quote_scale: 2,
      price_scale: 8,
      get base_scale() {
        reads += 1;
        return reads === 1 ? 6 : 0;
      },
    };
    const engine = createMatchingEngine({ instruments: [slippery] });
    // The definition validated at base_scale 6 is the one stored.
    const events = engine.submitOrder({
      order_id: ord(1),
      instrument: "AAA/BBB",
      side: "buy",
      price: "1",
      quantity: "1.5",
    });
    assert.equal(events[0].type, "accepted");
    assert.equal(reads, 1);
  });

  test("mutating the caller's instrument list after creation changes nothing", () => {
    const instruments = [
      {
        instrument: "AAA/BBB",
        base_asset: "AAA",
        quote_asset: "BBB",
        base_scale: 6,
        quote_scale: 2,
        price_scale: 8,
      },
    ];
    const engine = createMatchingEngine({ instruments });
    instruments.length = 0;
    const events = engine.submitOrder({
      order_id: ord(1),
      instrument: "AAA/BBB",
      side: "buy",
      price: "1",
      quantity: "1.5",
    });
    assert.equal(events[0].type, "accepted");
  });
});

describe("snapshot canonical form", () => {
  test("tracked orders must carry exact-scale decimals, not merely canonical ones", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "88", quantity: "1" }));
    const snapshot = JSON.parse(JSON.stringify(engine.snapshot()));
    for (const patch of [
      { price: "88" },
      { price: "88.000000" },
      { quantity: "1" },
      { quantity: "1.0" },
      { remaining: "1.00" },
    ]) {
      assertSnapshotRejected({
        ...snapshot,
        orders: snapshot.orders.map((entry, index) =>
          index === 0 ? { ...entry, ...patch } : entry,
        ),
      });
    }
  });
});

describe("pinned clean classes", () => {
  test("cyclic or self-referencing snapshot data is rejected as invalid input", () => {
    const cyclic = { kind: SNAPSHOT_KIND, version: SNAPSHOT_VERSION };
    cyclic.self = cyclic;
    assertSnapshotRejected(cyclic);
  });

  test("a v1 snapshot stays rejected: no silent migration", () => {
    const snapshot = JSON.parse(JSON.stringify(createMatchingEngine().snapshot()));
    snapshot.version = 1;
    assertSnapshotRejected(snapshot);
  });

  test("views cannot mutate engine state", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90" }));
    const book = engine.bookSnapshot("USDT/RUB");
    assert.throws(() => book.asks.push({ price: "1" }), TypeError);
    const journal = engine.journal();
    assert.throws(() => journal.push({}), TypeError);
    assert.throws(() => {
      journal[0].seq = 99;
    }, TypeError);
    const snapshot = engine.snapshot();
    assert.throws(() => {
      snapshot.orders[0].price = "1";
    }, TypeError);
  });
});
