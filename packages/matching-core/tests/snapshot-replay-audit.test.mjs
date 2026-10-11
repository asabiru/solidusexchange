// Wave-59 adversarial audit pins for the snapshot/restore + replay
// machinery: hostile snapshot rejection before any book state, byte-
// identical restore through every path, adversarial fold streams,
// seq/counter boundaries, clock invariants, and journal-store parity.
// Repro cases document defects fixed on this branch; the rest are
// negative pins for classes verified clean.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createMatchingEngine } from "../src/engine.mjs";
import { createMemoryJournalStore, StoreError } from "../src/journal-store.mjs";
import {
  replayMatchingEngine,
  restoreMatchingEngine,
} from "../src/replay.mjs";
import { marketOrder, mixedScenario, ord, fll, order } from "./helpers.mjs";

const AT = "2026-01-01T00:00:00Z";
const EPOCH = 1767225600;

function snapshotOf(engine) {
  return JSON.parse(JSON.stringify(engine.snapshot()));
}

function invalidStream(events) {
  assert.throws(() => replayMatchingEngine({ events }), /invalid event stream/);
}

function invalidSnapshot(snapshot) {
  assert.throws(() => restoreMatchingEngine(snapshot), /invalid engine snapshot/);
}

// Minimal hand-built stream fragments. Every event is a plain object with
// canonical emission field order, mirroring what the engine emits.
const accepted = (seq, n, fields = {}) => ({
  seq, at: AT, type: "accepted", posting: "none",
  order_id: ord(n), instrument: "USDT/RUB", side: "sell",
  order_type: "limit", price: "90.00000000", quantity: "1.000000",
  ...fields,
});
const resting = (seq, n, fields = {}) => ({
  seq, at: AT, type: "resting", posting: "none",
  order_id: ord(n), instrument: "USDT/RUB", side: "sell",
  price: "90.00000000", quantity: "1.000000", ...fields,
});
const cancelled = (seq, n, fields = {}) => ({
  seq, at: AT, type: "cancelled", posting: "none",
  order_id: ord(n), instrument: "USDT/RUB", side: "sell",
  price: "90.00000000", quantity: "1.000000", ...fields,
});
const fillMaker = (seq, fillN, n, takerN, fields = {}) => ({
  seq, at: AT, type: "filled", posting: "none",
  order_id: ord(n), instrument: "USDT/RUB", side: "sell",
  fill_id: fll(fillN), maker_order_id: ord(n), taker_order_id: ord(takerN),
  price: "90.00000000", quantity: "1.000000", remaining_quantity: "0.000000",
  ...fields,
});
const fillTaker = (seq, fillN, n, makerN, fields = {}) => ({
  seq, at: AT, type: "filled", posting: "none",
  order_id: ord(n), instrument: "USDT/RUB", side: "buy",
  fill_id: fll(fillN), maker_order_id: ord(makerN), taker_order_id: ord(n),
  price: "90.00000000", quantity: "1.000000", remaining_quantity: "0.000000",
  ...fields,
});

describe("snapshot restore validation — crossed books", () => {
  const crossedBook = (bidPrice) => {
    const snap = snapshotOf(createMatchingEngine());
    snap.orders.push(
      { order_id: ord(1), instrument: "USDT/RUB", side: "sell", order_type: "limit", owner: null, price: "90.00000000", quantity: "1.000000", remaining: "1.000000", state: "resting" },
      { order_id: ord(2), instrument: "USDT/RUB", side: "buy", order_type: "limit", owner: null, price: bidPrice, quantity: "1.000000", remaining: "1.000000", state: "resting" },
    );
    snap.resting.push(ord(1), ord(2));
    snap.next_seq = 5;
    snap.last_at = EPOCH;
    return snap;
  };

  test("a resting bid above a resting ask is rejected before book state", () => {
    invalidSnapshot(crossedBook("91.00000000"));
  });

  test("a resting bid equal to a resting ask is rejected", () => {
    invalidSnapshot(crossedBook("90.00000000"));
  });

  test("a crossing in any instrument is rejected", () => {
    const snap = crossedBook("91.00000000");
    snap.orders.push(
      { order_id: ord(3), instrument: "TON/RUB", side: "sell", order_type: "limit", owner: null, price: "150.00000000", quantity: "1.000000000", remaining: "1.000000000", state: "resting" },
      { order_id: ord(4), instrument: "TON/RUB", side: "buy", order_type: "limit", owner: null, price: "151.00000000", quantity: "1.000000000", remaining: "1.000000000", state: "resting" },
    );
    snap.resting.push(ord(3), ord(4));
    snap.next_seq = 9;
    invalidSnapshot(snap);
  });

  test("a non-crossed multi-level book still restores", () => {
    const snap = crossedBook("89.00000000");
    restoreMatchingEngine(snap);
    const book = restoreMatchingEngine(snap).bookSnapshot("USDT/RUB");
    assert.deepEqual(book.bids.map((l) => l.price), ["89.00000000"]);
    assert.deepEqual(book.asks.map((l) => l.price), ["90.00000000"]);
  });
});

describe("snapshot restore validation — counter correlation", () => {
  test("last_at null with next_seq above one is rejected", () => {
    invalidSnapshot({ ...snapshotOf(createMatchingEngine()), next_seq: 5 });
  });

  test("next_seq one with a recorded last_at is rejected", () => {
    invalidSnapshot({ ...snapshotOf(createMatchingEngine()), last_at: EPOCH });
  });

  test("next_seq one with consumed fills is rejected", () => {
    invalidSnapshot({ ...snapshotOf(createMatchingEngine()), next_fill: 5 });
  });

  test("non-integer last_at is rejected", () => {
    invalidSnapshot({ ...snapshotOf(createMatchingEngine()), next_seq: 2, last_at: 1.5 });
  });

  test("a snapshot past the safe-integer seq boundary is rejected", () => {
    invalidSnapshot({
      ...snapshotOf(createMatchingEngine()),
      next_seq: Number.MAX_SAFE_INTEGER + 1,
      last_at: EPOCH,
    });
  });

  test("a snapshot past the safe-integer fill boundary is rejected", () => {
    invalidSnapshot({
      ...snapshotOf(createMatchingEngine()),
      next_seq: 2,
      next_fill: Number.MAX_SAFE_INTEGER + 1,
      last_at: EPOCH,
    });
  });

  test("hostile nesting inside order records is rejected", () => {
    const snap = snapshotOf(createMatchingEngine());
    snap.orders.push([[ord(1)]]);
    invalidSnapshot(snap);
  });

  test("an order state that is a nested object is rejected", () => {
    const snap = snapshotOf(createMatchingEngine());
    snap.orders.push({
      order_id: ord(1), instrument: "USDT/RUB", side: "sell", order_type: "limit",
      owner: null, price: "90.00000000", quantity: "1.000000", remaining: "1.000000",
      state: { nested: { deep: "resting" } },
    });
    invalidSnapshot(snap);
  });

  test("an instrument definition carrying a symbol key is refused", () => {
    const definition = {
      instrument: "AAA/BBB", base_asset: "AAA", quote_asset: "BBB",
      base_scale: 6, quote_scale: 2, price_scale: 8,
      [Symbol("smuggled")]: "payload",
    };
    assert.throws(() => createMatchingEngine({ instruments: [definition] }), TypeError);
  });
});

describe("emission counter bounds", () => {
  test("an engine at the seq boundary refuses new operations atomically", () => {
    const restored = restoreMatchingEngine({
      ...snapshotOf(createMatchingEngine()),
      next_seq: Number.MAX_SAFE_INTEGER,
      last_at: EPOCH,
    });
    assert.throws(() => restored.submitOrder(order(1)), /journal sequence space exhausted/);
    assert.equal(restored.journal().length, 0);
    assert.equal(restored.orderStatus(order(1).order_id), null);
  });

  test("a mid-operation seq exhaustion leaves the journal on an operation boundary", () => {
    const restored = restoreMatchingEngine({
      ...snapshotOf(createMatchingEngine()),
      next_seq: Number.MAX_SAFE_INTEGER - 1,
      last_at: EPOCH,
    });
    assert.throws(
      () => restored.submitOrder(order(1, { side: "sell", price: "90" })),
      /journal sequence space exhausted/,
    );
    assert.deepEqual(restored.journal(), []);
    replayMatchingEngine({ events: restored.journal() });
  });

  test("an engine at the fill boundary refuses fills", () => {
    const restored = restoreMatchingEngine({
      ...snapshotOf(createMatchingEngine()),
      next_seq: 100,
      next_fill: Number.MAX_SAFE_INTEGER,
      last_at: EPOCH,
    });
    restored.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    assert.throws(
      () => restored.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" })),
      /fill id space exhausted/,
    );
    assert.equal(restored.journal().length, 2);
  });

  test("the journal stays a contiguous valid stream across a dead operation", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const restored = restoreMatchingEngine({
      ...snapshotOf(engine),
      next_fill: Number.MAX_SAFE_INTEGER,
    });
    assert.throws(
      () => restored.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" })),
      /fill id space exhausted/,
    );
    replayMatchingEngine({ events: restored.journal() });
  });
});

describe("replay restores owner state", () => {
  test("a replayed engine snapshots byte-identically to the live engine", () => {
    const engine = createMatchingEngine();
    const events = mixedScenario(engine);
    const replayed = replayMatchingEngine({ events });
    assert.equal(
      JSON.stringify(replayed.snapshot()),
      JSON.stringify(engine.snapshot()),
    );
  });

  test("self-trade protection survives replay", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2", owner: "desk-a" }));
    const replayed = replayMatchingEngine({ events: engine.journal() });
    const events = replayed.submitOrder(order(2, { side: "buy", price: "91", quantity: "1", owner: "desk-a" }));
    assert.deepEqual(events.map((e) => e.type), ["accepted", "rejected"]);
    assert.equal(events[1].reason, "self_trade");
  });

  test("legacy accepted events without owner still fold", () => {
    const events = engine0Ownerless();
    const replayed = replayMatchingEngine({ events });
    const snap = replayed.snapshot();
    assert.equal(snap.orders[0].owner, null);
  });

  test("an accepted event with a malformed owner is rejected", () => {
    invalidStream([accepted(1, 1, { owner: "not an owner" })]);
  });

  function engine0Ownerless() {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }));
    return engine.journal().map((event) => {
      const clone = { ...event };
      delete clone.owner;
      return clone;
    });
  }
});

describe("replay-fold adversarial streams", () => {
  const fullFill = () => [
    accepted(1, 1), resting(2, 1), accepted(3, 2, { side: "buy" }),
    fillMaker(4, 1, 1, 2), fillTaker(5, 1, 2, 1),
  ];

  test("a resting event inside a fill pair is rejected", () => {
    invalidStream([
      accepted(1, 1), resting(2, 1), accepted(3, 2, { side: "buy" }),
      fillMaker(4, 1, 1, 2), resting(5, 2, { side: "buy" }),
    ]);
  });

  test("a cancelled event inside a fill pair is rejected", () => {
    invalidStream([
      accepted(1, 1), resting(2, 1), accepted(3, 2, { side: "buy" }),
      fillMaker(4, 1, 1, 2), cancelled(5, 1),
    ]);
  });

  test("a fill pair ending with the wrong taker is rejected", () => {
    invalidStream([
      accepted(1, 1), resting(2, 1), accepted(3, 2, { side: "buy" }),
      fillMaker(4, 1, 1, 2), fillTaker(5, 1, 2, 1, { taker_order_id: ord(3) }),
    ]);
  });

  test("a fill whose maker was never rested is rejected", () => {
    invalidStream([
      accepted(1, 1), accepted(2, 2, { side: "buy" }),
      fillMaker(3, 1, 1, 2), fillTaker(4, 1, 2, 1),
    ]);
  });

  test("a fill for an already-filled order is rejected", () => {
    invalidStream([...fullFill(), fillMaker(6, 2, 1, 2)]);
  });

  test("a resting event for an order already in the book is rejected", () => {
    invalidStream([accepted(1, 1), resting(2, 1), resting(3, 1)]);
  });

  test("a resting event for a market order is rejected", () => {
    invalidStream([
      accepted(1, 1, { order_type: "market", price: undefined }),
      resting(2, 1),
    ]);
  });

  test("an amended event on an in-flight order is rejected", () => {
    invalidStream([
      accepted(1, 1),
      {
        seq: 2, at: AT, type: "amended", posting: "none",
        order_id: ord(1), instrument: "USDT/RUB", side: "sell",
        previous_price: "90.00000000", previous_quantity: "1.000000",
        price: "91.00000000", quantity: "1.000000",
      },
    ]);
  });

  test("an amended event below the filled amount is rejected", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "2" }));
    const stream = engine.journal();
    invalidStream([
      ...stream,
      {
        seq: stream.length + 1, at: AT, type: "amended", posting: "none",
        order_id: ord(1), instrument: "USDT/RUB", side: "sell",
        previous_price: "90.00000000", previous_quantity: "5.000000",
        price: "90.00000000", quantity: "2.000000",
      },
    ]);
  });

  test("a cancelled event on a filled order is rejected", () => {
    invalidStream([...fullFill(), cancelled(6, 1)]);
  });

  test("an amended event on a cancelled order is rejected", () => {
    invalidStream([
      accepted(1, 1), resting(2, 1), cancelled(3, 1),
      {
        seq: 4, at: AT, type: "amended", posting: "none",
        order_id: ord(1), instrument: "USDT/RUB", side: "sell",
        previous_price: "90.00000000", previous_quantity: "1.000000",
        price: "91.00000000", quantity: "1.000000",
      },
    ]);
  });

  test("a fill whose maker and taker are the same order is rejected", () => {
    invalidStream([
      accepted(1, 1), resting(2, 1),
      fillMaker(3, 1, 1, 1),
    ]);
  });

  test("a rejected event carrying quantity on a validation reason is rejected", () => {
    invalidStream([
      {
        seq: 1, at: AT, type: "rejected", posting: "none",
        order_id: ord(1), instrument: "USDT/RUB", side: "sell",
        reason: "invalid_price", quantity: "1.000000",
      },
    ]);
  });

  test("a malformed timestamp inside the stream is rejected", () => {
    invalidStream([
      accepted(1, 1),
      resting(2, 1, { at: "2026-02-30T00:00:00Z" }),
    ]);
  });

  test("the engine emits fill ids up to exactly the fold-accepted bound", () => {
    // MAX_FILL_NUMBER (2^53-2) is the largest fill number replay folds;
    // the engine never allocates past it.
    const restored = restoreMatchingEngine({
      ...snapshotOf(createMatchingEngine()),
      next_seq: 100,
      next_fill: Number.MAX_SAFE_INTEGER - 1,
      last_at: EPOCH,
    });
    restored.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const events = restored.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
    const fill = events.find((e) => e.type === "filled");
    assert.equal(fill?.fill_id, `fll_${(Number.MAX_SAFE_INTEGER - 1).toString(16).padStart(24, "0")}`);
    restored.submitOrder(order(3, { side: "sell", price: "90", quantity: "1" }));
    assert.throws(
      () => restored.submitOrder(order(4, { side: "buy", price: "90", quantity: "1" })),
      /fill id space exhausted/,
    );
  });

  test("a fill past the maximum fill number is rejected", () => {
    invalidStream([
      accepted(1, 1), resting(2, 1), accepted(3, 2, { side: "buy" }),
      fillMaker(4, Number.MAX_SAFE_INTEGER, 1, 2),
    ]);
  });
});

describe("journal-store continuation parity (memory backend)", () => {
  const engine = createMatchingEngine();
  engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }));
  const batch = engine.journal();

  test("a batch with a string seq is rejected", () => {
    const store = createMemoryJournalStore();
    assert.throws(
      () => store.append(batch.map((e) => ({ ...e, seq: String(e.seq) }))),
      StoreError,
    );
  });

  test("a batch with a float seq is rejected", () => {
    const store = createMemoryJournalStore();
    assert.throws(
      () => store.append(batch.map((e) => ({ ...e, seq: e.seq + 0.5 }))),
      StoreError,
    );
  });

  test("a batch with a zero seq is rejected", () => {
    const store = createMemoryJournalStore();
    assert.throws(
      () => store.append(batch.map((e, i) => ({ ...e, seq: i }))),
      StoreError,
    );
  });

  test("a batch with an internal gap is rejected", () => {
    const store = createMemoryJournalStore();
    store.append(batch);
    assert.throws(
      () => store.append(batch.map((e, i) => ({ ...e, seq: e.seq + (i === 0 ? 0 : 9) }))),
      StoreError,
    );
  });

  test("a rejected batch leaves the recorded stream untouched", async () => {
    const store = createMemoryJournalStore();
    store.append(batch);
    assert.throws(() => store.append([{ ...batch[0], seq: 1 }]), StoreError);
    assert.deepEqual(await store.load(), batch);
  });
});

describe("restore round-trip stability", () => {
  test("a snapshot of a restored engine restores again identically", () => {
    const engine = createMatchingEngine();
    mixedScenario(engine);
    const snap = engine.snapshot();
    const restored = restoreMatchingEngine(snap);
    const snap2 = restored.snapshot();
    assert.equal(JSON.stringify(snap2), JSON.stringify(snap));
    restoreMatchingEngine(snap2);
  });

  test("replay -> snapshot -> restore -> snapshot is byte-identical", () => {
    const engine = createMatchingEngine();
    mixedScenario(engine);
    const replayed = replayMatchingEngine({ events: engine.journal() });
    const snapA = JSON.stringify(replayed.snapshot());
    const snapB = JSON.stringify(restoreMatchingEngine(replayed.snapshot()).snapshot());
    assert.equal(snapA, snapB);
  });
});

describe("clock invariants on restore", () => {
  test("a far-future last_at forces later operations to fail closed", () => {
    const restored = restoreMatchingEngine({
      ...snapshotOf(createMatchingEngine()),
      next_seq: 2,
      last_at: 253_402_300_799, // MAX_EPOCH_SECONDS — a far-future stamp
    });
    assert.throws(
      () => restored.submitOrder(order(1)),
      /clock must not go backwards/,
    );
  });

  test("a snapshot claiming no events but a stale journal is self-consistent", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(marketOrder(1, { quantity: "1" }));
    const snap = snapshotOf(engine);
    const restored = restoreMatchingEngine(snap);
    assert.equal(restored.snapshot().next_seq, snap.next_seq);
  });
});
