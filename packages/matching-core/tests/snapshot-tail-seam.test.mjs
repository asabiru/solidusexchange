// Wave-77 snapshot+tail recovery seam. Two recovery paths compose: a
// canonical snapshot taken at a journal boundary plus the journal tail
// `snapshot.next_seq..M` must rebuild exactly the engine the full journal
// produces — `replay(journal[1..M]) ≡ replay(journal[N+1..M], base:
// snapshot(N))`. The tail fold keeps the wave-75 grammar untouched
// (operation atomicity, one timestamp per operation, earned rejections,
// sequential fill pairs) and extends its continuity rule from "seq from 1"
// to "seq from `base.next_seq`": a gap or an overlap across the seam fails
// like a broken stream.
//
// What this file reproduces from origin/main: `replayMatchingEngine`
// accepted no `base` option (`unknown option: base`), a journal tail could
// not begin at `seq > 1` (`seq must be contiguous from 1 with no gaps`),
// `journal()`-boundary snapshots were the only state the fold could not
// continue, `engine.snapshot()` could observe mid-operation state, and no
// store offered `loadAfter`. The grammar, boundary and store cases below
// pin the seam the implementation added.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSimulatedClock } from "../src/deterministic.mjs";
import { createMatchingEngine } from "../src/engine.mjs";
import { createMemoryJournalStore, validJournalStore } from "../src/journal-store.mjs";
import {
  replayMatchingEngine,
  replayMatchingJournalStore,
  restoreMatchingEngine,
} from "../src/replay.mjs";
import { fll, marketOrder, mixedScenario, ord, order } from "./helpers.mjs";

const AT = "2026-01-01T00:00:00Z";
const AT_LATE = "2026-01-01T00:01:00Z";
const INSTRUMENT_NAMES = ["USDT/RUB", "TON/RUB", "TON/USDT"];

/**
 * @param {unknown} value
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The boundary pin: at every recorded snapshot the journal tail folds onto
 * it byte-identically to the live engine — snapshot, per-instrument book
 * (intra-level FIFO survives the seam) and every order's status.
 *
 * @param {ReturnType<typeof createMatchingEngine>} live
 * @param {readonly ReturnType<ReturnType<typeof createMatchingEngine>["snapshot"]>[]} snapshots
 * @param {readonly object[]} journal
 */
function assertSeam(live, snapshots, journal) {
  const expected = JSON.stringify(live.snapshot());
  assert.equal(
    JSON.stringify(replayMatchingEngine({ events: journal }).snapshot()),
    expected,
    "the full replay must agree with the live engine before the seam can",
  );
  const orderIds = JSON.parse(expected).orders.map((entry) => entry.order_id);
  for (const [index, snapshot] of snapshots.entries()) {
    const tail = journal.slice(snapshot.next_seq - 1);
    const continued = replayMatchingEngine({ events: tail, base: snapshot });
    assert.equal(
      JSON.stringify(continued.snapshot()),
      expected,
      `tail replay from boundary ${index} (next_seq ${snapshot.next_seq}) diverged`,
    );
    assert.deepEqual(
      continued.journal(),
      tail,
      `a tail-restored journal holds exactly the tail at boundary ${index}`,
    );
    for (const instrument of INSTRUMENT_NAMES) {
      assert.deepEqual(
        continued.bookSnapshot(instrument),
        live.bookSnapshot(instrument),
        `book ${instrument} diverged from boundary ${index}`,
      );
    }
    for (const orderId of [...orderIds, ord(9999)]) {
      assert.deepEqual(continued.orderStatus(orderId), live.orderStatus(orderId));
    }
  }
}

/**
 * Drives `mixedScenario` op by op, capturing the canonical snapshot at
 * every operation boundary — the only points a tail can resume from.
 */
function scriptedRun() {
  const engine = createMatchingEngine();
  const snapshots = [engine.snapshot()];
  const spy = {
    submitOrder: (input) => {
      const out = engine.submitOrder(input);
      snapshots.push(engine.snapshot());
      return out;
    },
    cancelOrder: (instrument, orderId) => {
      const out = engine.cancelOrder(instrument, orderId);
      snapshots.push(engine.snapshot());
      return out;
    },
    amendOrder: (input) => {
      const out = engine.amendOrder(input);
      snapshots.push(engine.snapshot());
      return out;
    },
  };
  mixedScenario(spy);
  return { engine, snapshots, journal: engine.journal() };
}

/**
 * @param {number} seed
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Randomized deterministic operation stream over three instruments:
 * limit/market submissions, cancels, amends on every priority path and
 * malformed submissions, with shared owners so self-trades occur. Every op
 * boundary's snapshot is captured; the run always ends with a guaranteed
 * self-trade and — when any book side is empty — a liquidity rejection, so
 * the stream covers every event type.
 *
 * @param {number} seed
 * @param {number} [steps]
 */
function randomRun(seed, steps = 80) {
  const rand = mulberry32(seed);
  const pick = (n) => Math.floor(rand() * n);
  const clock = createSimulatedClock();
  const engine = createMatchingEngine({ clock });
  const snapshots = [engine.snapshot()];
  const defs = [
    { instrument: "USDT/RUB", mid: 90, quantityScale: 6 },
    { instrument: "TON/RUB", mid: 150, quantityScale: 9 },
    { instrument: "TON/USDT", mid: 3, quantityScale: 9 },
  ];
  const dec = (whole, frac, scale) => `${whole}.${String(frac).padStart(scale, "0")}`;
  const owners = ["desk-a", "desk-b", "desk-c", undefined];
  const submitted = [];
  let nextId = 1;
  const snap = () => snapshots.push(engine.snapshot());
  const restingNow = () =>
    submitted.filter((id) => engine.orderStatus(id)?.state === "resting");
  for (let step = 0; step < steps; step += 1) {
    clock.advance(pick(3));
    const def = defs[pick(defs.length)];
    const roll = rand();
    if (roll < 0.42) {
      const owner = owners[pick(owners.length)];
      engine.submitOrder(
        order(nextId, {
          instrument: def.instrument,
          side: rand() < 0.5 ? "buy" : "sell",
          price: dec(Math.max(1, def.mid + pick(5) - 2), pick(9), 8),
          quantity: dec(1 + pick(5), pick(9), def.quantityScale),
          ...(owner === undefined ? {} : { owner }),
        }),
      );
      submitted.push(ord(nextId));
      nextId += 1;
    } else if (roll < 0.54) {
      engine.submitOrder(
        marketOrder(nextId, {
          instrument: def.instrument,
          side: rand() < 0.5 ? "buy" : "sell",
          quantity: dec(1 + pick(8), pick(9), def.quantityScale),
          owner: pick(2) === 0 ? "desk-a" : "desk-m",
        }),
      );
      submitted.push(ord(nextId));
      nextId += 1;
    } else if (roll < 0.68) {
      const resting = restingNow();
      if (resting.length > 0 && rand() < 0.75) {
        engine.cancelOrder(def.instrument, resting[pick(resting.length)]);
      } else {
        engine.cancelOrder(def.instrument, ord(nextId + pick(50)));
      }
    } else if (roll < 0.84) {
      const resting = restingNow();
      if (resting.length === 0) {
        engine.amendOrder({ order_id: ord(nextId + pick(50)), price: "91.50000000" });
      } else {
        const id = resting[pick(resting.length)];
        const status = engine.orderStatus(id);
        const mode = pick(4);
        if (mode === 0) {
          engine.amendOrder({ order_id: id, price: status.price });
        } else if (mode === 1) {
          engine.amendOrder({
            order_id: id,
            quantity: dec(2 + pick(6), pick(9), def.quantityScale),
          });
        } else {
          engine.amendOrder({
            order_id: id,
            price: dec(Math.max(1, def.mid + pick(5) - 2), pick(9), 8),
          });
        }
      }
    } else {
      // Malformed submissions: exercise the validation rejection reasons.
      const mode = pick(6);
      if (mode === 0) {
        engine.submitOrder(order(nextId, { instrument: "FOO/BAR" }));
      } else if (mode === 1) {
        engine.submitOrder(order(nextId, { side: "hold" }));
      } else if (mode === 2) {
        engine.submitOrder(order(nextId, { price: "0.00000000" }));
      } else if (mode === 3) {
        engine.submitOrder(order(nextId, { quantity: "junk" }));
      } else if (mode === 4 && submitted.length > 0) {
        engine.submitOrder(order(submitted[pick(submitted.length)]));
      } else {
        engine.submitOrder({
          order_id: "bogus",
          instrument: def.instrument,
          side: "buy",
          price: "1.00000000",
          quantity: dec(1, 0, def.quantityScale),
        });
      }
      nextId += 1;
    }
    snap();
  }
  // Guarantee the two operation-triggered rejections appear: a same-owner
  // cross over an own resting head (self_trade) and a market taker against
  // an empty book side (insufficient_liquidity).
  clock.advance(1);
  engine.submitOrder(
    order(nextId, {
      instrument: "TON/USDT",
      side: "sell",
      price: "1.00000000",
      quantity: dec(2, 0, 9),
      owner: "desk-self",
    }),
  );
  submitted.push(ord(nextId));
  nextId += 1;
  snap();
  engine.submitOrder(
    order(nextId, {
      instrument: "TON/USDT",
      side: "buy",
      price: "1.00000000",
      quantity: dec(2, 0, 9),
      owner: "desk-self",
    }),
  );
  submitted.push(ord(nextId));
  nextId += 1;
  snap();
  const emptied = defs.find((def) => {
    const book = engine.bookSnapshot(def.instrument);
    return book.asks.length === 0 || book.bids.length === 0;
  });
  if (emptied !== undefined) {
    const side = engine.bookSnapshot(emptied.instrument).asks.length === 0 ? "buy" : "sell";
    engine.submitOrder(
      marketOrder(nextId, {
        instrument: emptied.instrument,
        side,
        quantity: dec(2, 0, emptied.quantityScale),
      }),
    );
    nextId += 1;
    snap();
  }
  return { engine, snapshots, journal: engine.journal() };
}

/**
 * Asserts a replay — tail or full — fails closed with the wave-75 error
 * shape.
 *
 * @param {readonly object[]} events
 * @param {Record<string, unknown>} options
 * @param {RegExp} reason
 */
function invalidStream(events, options, reason) {
  assert.throws(
    () => replayMatchingEngine({ events, ...options }),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.match(error.message, /invalid event stream/);
      assert.match(error.message, reason);
      return true;
    },
  );
}

describe("snapshot+tail seam: composition is byte-identical to full replay", () => {
  test("a scripted mixed stream folds identically at every operation boundary", () => {
    const run = scriptedRun();
    const types = new Set(run.journal.map((event) => event.type));
    for (const type of ["accepted", "resting", "partially_filled", "filled", "cancelled", "amended", "rejected"]) {
      assert.ok(types.has(type), `scripted stream must cover ${type}`);
    }
    assertSeam(run.engine, run.snapshots, run.journal);
  });

  for (const seed of [7, 42, 1053]) {
    test(`a randomized stream (seed ${seed}) folds identically at every boundary`, () => {
      const run = randomRun(seed);
      const types = new Set(run.journal.map((event) => event.type));
      for (const type of ["accepted", "resting", "partially_filled", "filled", "cancelled", "amended", "rejected"]) {
        assert.ok(types.has(type), `seed ${seed} must cover ${type}`);
      }
      assertSeam(run.engine, run.snapshots, run.journal);
    });
  }

  test("an empty tail on a base reproduces the snapshot exactly", () => {
    const { snapshots } = scriptedRun();
    const base = snapshots.at(-1);
    const continued = replayMatchingEngine({ events: [], base });
    assert.equal(JSON.stringify(continued.snapshot()), JSON.stringify(base));
    assert.deepEqual(continued.journal(), []);
  });

  test("an empty (genesis) snapshot plus the full journal equals a full replay", () => {
    const engine = createMatchingEngine();
    const genesis = engine.snapshot();
    mixedScenario(engine);
    const tail = replayMatchingEngine({ events: engine.journal(), base: genesis });
    const full = replayMatchingEngine({ events: engine.journal() });
    assert.equal(JSON.stringify(tail.snapshot()), JSON.stringify(full.snapshot()));
  });

  test("a tail-restored engine continues the journal and fills contiguously", () => {
    const { engine, snapshots, journal } = scriptedRun();
    const base = snapshots[10];
    const continued = replayMatchingEngine({
      events: journal.slice(base.next_seq - 1),
      base,
    });
    const before = continued.journal().length;
    const emitted = continued.submitOrder(
      order(777, { side: "buy", price: "1.00000000", quantity: "1.000000" }),
    );
    assert.equal(emitted[0].seq, journal.length + 1);
    assert.equal(continued.journal().length, before + emitted.length);
    // The live engine's next seq is one past its last event; the tail
    // replay must land the same submission at the same seq and reach the
    // same state.
    const liveNext = engine.submitOrder(order(777, { side: "buy", price: "1.00000000", quantity: "1.000000" }));
    assert.equal(liveNext[0].seq, emitted[0].seq);
    assert.deepEqual(emitted, liveNext);
    assert.equal(
      JSON.stringify(continued.snapshot()),
      JSON.stringify(engine.snapshot()),
    );
  });
});

describe("snapshot+tail seam: the wave-75 grammar holds across the seam", () => {
  test("seq continuity is enforced from the snapshot boundary — gap and overlap reject", () => {
    const { snapshots, journal } = scriptedRun();
    const base = snapshots[5];
    const overlap = journal.slice(base.next_seq - 2);
    invalidStream(overlap, { base }, /seq must continue the snapshot at \d+ with no gaps/);
    const gap = journal.slice(base.next_seq);
    invalidStream(gap, { base }, /seq must continue the snapshot at \d+ with no gaps/);
    const doctored = plain(journal.slice(base.next_seq - 1));
    doctored[0].seq = 1;
    invalidStream(doctored, { base }, /seq must continue the snapshot at 1/);
  });

  test("a tail cannot open mid-operation — non-intake first events reject", () => {
    const { snapshots, journal } = scriptedRun();
    // Boundary after the first op (a resting limit): re-delivering its
    // `resting` as a tail head would double-apply the queue entry.
    const base = snapshots[1];
    const restated = plain(journal[1]);
    restated.seq = base.next_seq;
    invalidStream([restated], { base }, /resting|in flight/);
    // A cancellation of the resting order IS a valid operation open.
    const cancel = plain(journal[1]);
    const folded = replayMatchingEngine({
      events: [
        {
          seq: base.next_seq,
          at: cancel.at,
          type: "cancelled",
          posting: "none",
          order_id: cancel.order_id,
          instrument: cancel.instrument,
          side: cancel.side,
          price: cancel.price,
          quantity: cancel.quantity,
        },
      ],
      base,
    });
    assert.equal(folded.orderStatus(cancel.order_id).state, "cancelled");
  });

  test("operation atomicity: an event for another order cannot interleave an in-flight one", () => {
    const { snapshots } = scriptedRun();
    const base = snapshots[0];
    invalidStream(
      [
        { seq: 1, at: AT, type: "accepted", posting: "none", order_id: ord(1), instrument: "USDT/RUB", side: "buy", order_type: "limit", price: "91.00000000", quantity: "1.000000" },
        { seq: 2, at: AT, type: "accepted", posting: "none", order_id: ord(2), instrument: "USDT/RUB", side: "buy", order_type: "limit", price: "91.00000000", quantity: "1.000000" },
      ],
      { base },
      /in flight/,
    );
  });

  test("per-operation timestamp uniformity holds at the seam", () => {
    const { snapshots } = scriptedRun();
    const base = snapshots[0];
    invalidStream(
      [
        { seq: 1, at: AT, type: "accepted", posting: "none", order_id: ord(1), instrument: "USDT/RUB", side: "buy", order_type: "limit", price: "91.00000000", quantity: "1.000000" },
        { seq: 2, at: AT_LATE, type: "resting", posting: "none", order_id: ord(1), instrument: "USDT/RUB", side: "buy", price: "91.00000000", quantity: "1.000000" },
      ],
      { base },
      /inside an operation/,
    );
  });

  test("a tail timestamp cannot step back behind the snapshot's last_at", () => {
    const clock = createSimulatedClock();
    const engine = createMatchingEngine({ clock });
    clock.advance(120);
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const base = engine.snapshot();
    invalidStream(
      [
        {
          seq: base.next_seq,
          at: AT,
          type: "cancelled",
          posting: "none",
          order_id: ord(1),
          instrument: "USDT/RUB",
          side: "sell",
          price: "90.00000000",
          quantity: "2.000000",
        },
      ],
      { base },
      /must not go backwards/,
    );
  });

  test("a resting event that would cross the snapshot's book rejects", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const base = engine.snapshot();
    invalidStream(
      [
        { seq: base.next_seq, at: AT_LATE, type: "accepted", posting: "none", order_id: ord(2), instrument: "USDT/RUB", side: "buy", order_type: "limit", price: "91.00000000", quantity: "1.000000" },
        { seq: base.next_seq + 1, at: AT_LATE, type: "resting", posting: "none", order_id: ord(2), instrument: "USDT/RUB", side: "buy", price: "91.00000000", quantity: "1.000000" },
      ],
      { base },
      /cross the book/,
    );
  });

  test("earned rejections are judged against the snapshot's state", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "buy", price: "89", quantity: "1", owner: "desk-b" }));
    const base = engine.snapshot();
    // self_trade unearned: the head bid belongs to another owner.
    invalidStream(
      [
        { seq: base.next_seq, at: AT, type: "accepted", posting: "none", order_id: ord(9), instrument: "USDT/RUB", side: "sell", order_type: "limit", owner: "desk-c", price: "89.00000000", quantity: "1.000000" },
        { seq: base.next_seq + 1, at: AT, type: "rejected", posting: "none", order_id: ord(9), instrument: "USDT/RUB", side: "sell", reason: "self_trade", quantity: "1.000000" },
      ],
      { base },
      /self_trade rejection is not earned/,
    );
    // duplicate_order_id earned across the seam: ord(1) is snapshot state.
    const duplicate = replayMatchingEngine({
      events: [
        { seq: base.next_seq, at: AT, type: "rejected", posting: "none", order_id: ord(1), instrument: "USDT/RUB", side: "buy", reason: "duplicate_order_id" },
      ],
      base,
    });
    assert.equal(duplicate.orderStatus(ord(1)).state, "resting");
    // …and unearned when the id is unknown to the snapshot.
    invalidStream(
      [
        { seq: base.next_seq, at: AT, type: "rejected", posting: "none", order_id: ord(555), instrument: "USDT/RUB", side: "buy", reason: "duplicate_order_id" },
      ],
      { base },
      /duplicate_order_id rejection is not earned/,
    );
  });

  test("fill ids continue the snapshot's counter — the seam rejects a fill restart", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
    const base = engine.snapshot();
    assert.equal(base.next_fill, 2);
    const makeFillTail = (fillId) => [
      { seq: base.next_seq, at: AT_LATE, type: "accepted", posting: "none", order_id: ord(3), instrument: "USDT/RUB", side: "buy", order_type: "limit", price: "90.00000000", quantity: "1.000000" },
      { seq: base.next_seq + 1, at: AT_LATE, type: "filled", posting: "none", order_id: ord(1), instrument: "USDT/RUB", side: "sell", fill_id: fillId, maker_order_id: ord(1), taker_order_id: ord(3), price: "90.00000000", quantity: "1.000000", remaining_quantity: "0.000000" },
      { seq: base.next_seq + 2, at: AT_LATE, type: "filled", posting: "none", order_id: ord(3), instrument: "USDT/RUB", side: "buy", fill_id: fillId, maker_order_id: ord(1), taker_order_id: ord(3), price: "90.00000000", quantity: "1.000000", remaining_quantity: "0.000000" },
    ];
    invalidStream(makeFillTail(fll(1)), { base }, /fill ids must be sequential/);
    invalidStream(makeFillTail(fll(9)), { base }, /fill ids must be sequential/);
    const folded = replayMatchingEngine({ events: makeFillTail(fll(2)), base });
    assert.equal(folded.orderStatus(ord(1)).state, "filled");
  });

  test("a stream ending mid-operation rejects at the seam", () => {
    const { snapshots } = scriptedRun();
    invalidStream(
      [
        { seq: 1, at: AT, type: "accepted", posting: "none", order_id: ord(1), instrument: "USDT/RUB", side: "buy", order_type: "limit", price: "91.00000000", quantity: "1.000000" },
      ],
      { base: snapshots[0] },
      /mid-operation/,
    );
  });
});

describe("snapshot+tail seam: base snapshots validate like journal versions", () => {
  test("a malformed or foreign base fails closed", () => {
    for (const bad of [null, 7, "snap", [], { kind: "matching-engine-snapshot" }]) {
      assert.throws(
        () => replayMatchingEngine({ events: [], base: bad }),
        (error) => {
          assert.equal(error instanceof TypeError, true);
          assert.match(error.message, /invalid engine snapshot|invalid event stream/);
          return true;
        },
      );
    }
  });

  test("a snapshot from an older schema version fails loud, like the journal store", () => {
    const { snapshots } = scriptedRun();
    const stale = plain(snapshots[5]);
    stale.version = 1;
    assert.throws(() => replayMatchingEngine({ events: [], base: stale }), /unsupported snapshot version/);
  });

  test("a tampered base fails canonical validation before any event folds", () => {
    const { snapshots, journal } = scriptedRun();
    const tampered = plain(snapshots[8]);
    tampered.resting = tampered.resting.slice(1);
    assert.throws(
      () => replayMatchingEngine({ events: journal.slice(tampered.next_seq - 1), base: tampered }),
      /invalid engine snapshot/,
    );
  });

  test("base and instruments are mutually exclusive", () => {
    const { snapshots } = scriptedRun();
    assert.throws(
      () => replayMatchingEngine({ events: [], base: snapshots[0], instruments: [] }),
      /instrument registry/,
    );
  });

  test("an unknown option still fails fast", () => {
    assert.throws(() => replayMatchingEngine({ events: [], tail: [] }), /unknown option: tail/);
  });

  test("the same frozen snapshot can seed many replays", () => {
    const { snapshots, journal } = scriptedRun();
    const base = snapshots[12];
    const tail = journal.slice(base.next_seq - 1);
    const first = replayMatchingEngine({ events: tail, base });
    const second = replayMatchingEngine({ events: tail, base });
    assert.equal(JSON.stringify(first.snapshot()), JSON.stringify(second.snapshot()));
  });
});

describe("snapshot+tail seam: journal stores serve bounded tails", () => {
  test("replayMatchingJournalStore folds a store's tail onto a snapshot", async () => {
    const store = createMemoryJournalStore();
    const engine = createMatchingEngine({ journalStore: store });
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const mid = engine.snapshot();
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
    engine.cancelOrder("USDT/RUB", ord(1));
    await store.load();

    const continued = await replayMatchingJournalStore(store, { base: mid });
    assert.equal(
      JSON.stringify(continued.snapshot()),
      JSON.stringify(engine.snapshot()),
    );
    assert.deepEqual(continued.journal(), engine.journal().slice(mid.next_seq - 1));

    // And the full path still agrees — same fold, longer stream.
    const full = await replayMatchingJournalStore(store);
    assert.equal(
      JSON.stringify(full.snapshot()),
      JSON.stringify(engine.snapshot()),
    );
  });

  test("a store without loadAfter falls back to load() filtered by seq", async () => {
    const backing = createMemoryJournalStore();
    const engine = createMatchingEngine({ journalStore: backing });
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const mid = engine.snapshot();
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
    const recorded = await backing.load();
    let loads = 0;
    const store = {
      kind: "noslice",
      append() {},
      async load() {
        loads += 1;
        return recorded;
      },
      async close() {},
    };
    validJournalStore(store);
    const continued = await replayMatchingJournalStore(store, { base: mid });
    assert.equal(loads, 1);
    assert.equal(
      JSON.stringify(continued.snapshot()),
      JSON.stringify(engine.snapshot()),
    );
  });

  test("a slicing store is asked for exactly the tail — and replay never writes", async () => {
    const backing = createMemoryJournalStore();
    const engine = createMatchingEngine({ journalStore: backing });
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const mid = engine.snapshot();
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
    const recorded = await backing.load();
    const calls = { load: 0, loadAfter: [], append: 0 };
    const store = {
      kind: "recording",
      append() {
        calls.append += 1;
      },
      async load() {
        calls.load += 1;
        return recorded;
      },
      async loadAfter(seq) {
        calls.loadAfter.push(seq);
        return recorded.filter((event) => event.seq > seq);
      },
      async close() {},
    };
    const continued = await replayMatchingJournalStore(store, { base: mid });
    assert.deepEqual(calls, { load: 0, loadAfter: [mid.next_seq - 1], append: 0 });
    assert.equal(
      JSON.stringify(continued.snapshot()),
      JSON.stringify(engine.snapshot()),
    );
    // The restored engine writes its continuation through the same store.
    continued.submitOrder(order(3, { side: "buy", price: "1.00000000", quantity: "1.000000" }));
    assert.equal(calls.append, 1);
  });

  test("replayMatchingJournalStore validates options like the fold does", async () => {
    const store = createMemoryJournalStore();
    await assert.rejects(
      async () => replayMatchingJournalStore(store, { bogus: true }),
      /unknown option: bogus/,
    );
    const { snapshots } = scriptedRun();
    await assert.rejects(
      async () => replayMatchingJournalStore(store, { base: snapshots[0], instruments: [] }),
      /instrument registry/,
    );
  });

  test("validJournalStore accepts loadAfter as an optional capability", () => {
    const store = createMemoryJournalStore();
    assert.equal(typeof store.loadAfter, "function");
    assert.throws(
      () => validJournalStore({ kind: "x", append() {}, load() {}, close() {}, loadAfter: "nope" }),
      /journal store must be an object/,
    );
  });
});

describe("snapshot+tail seam: capture is atomic — snapshots land only on boundaries", () => {
  test("snapshot() refuses inside an operation (the append hook proves it)", () => {
    let midOperationError;
    const probe = {
      kind: "probe",
      append() {
        // Inside finish(): books already mutated, counters not yet
        // committed — the capture must refuse rather than snapshot a state
        // no journal prefix can produce.
        try {
          engine.snapshot();
        } catch (error) {
          midOperationError = error;
        }
      },
      async load() {
        return [];
      },
      async close() {},
    };
    const engine = createMatchingEngine({ journalStore: probe });
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    assert.equal(midOperationError instanceof RangeError, true);
    assert.match(midOperationError.message, /cannot snapshot inside a matching operation/);
    // The operation still committed cleanly, and the boundary snapshot works.
    assert.equal(engine.journal().length, 2);
    const boundary = engine.snapshot();
    assert.equal(boundary.next_seq, 3);
  });

  test("snapshot() between operations is the only boundary the fold needs", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
    const mid = engine.snapshot();
    engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
    const continued = replayMatchingEngine({
      events: engine.journal().slice(mid.next_seq - 1),
      base: mid,
    });
    assert.equal(JSON.stringify(continued.snapshot()), JSON.stringify(engine.snapshot()));
    assert.equal(
      JSON.stringify(restoreMatchingEngine(mid).snapshot()),
      JSON.stringify(mid),
    );
  });
});
