import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSimulatedClock, toIsoSeconds } from "../src/deterministic.mjs";
import { createMatchingEngine } from "../src/engine.mjs";
import { restoreMatchingEngine } from "../src/replay.mjs";
import { SNAPSHOT_KIND, SNAPSHOT_VERSION } from "../src/snapshot.mjs";
import { fll, mixedScenario, ord, order } from "./helpers.mjs";

const SCENARIO_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21].map(ord);
const INSTRUMENTS = ["USDT/RUB", "TON/RUB", "TON/USDT"];

function scenarioEngine() {
  const engine = createMatchingEngine();
  mixedScenario(engine);
  return engine;
}

function scenarioSnapshot() {
  return JSON.parse(JSON.stringify(scenarioEngine().snapshot()));
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

describe("engine snapshot + restoreMatchingEngine", () => {
  test("snapshot is canonical plain data that JSON round-trips", () => {
    const snapshot = scenarioEngine().snapshot();
    assert.equal(snapshot.kind, SNAPSHOT_KIND);
    assert.equal(snapshot.version, SNAPSHOT_VERSION);
    assert.deepEqual(Object.keys(snapshot), [
      "kind",
      "version",
      "instruments",
      "orders",
      "resting",
      "next_seq",
      "next_fill",
      "last_at",
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(
      snapshot.orders.every((entry) => Object.isFrozen(entry)),
      true,
    );
  });

  test("restore reproduces books and order statuses byte-identically", () => {
    const engine = scenarioEngine();
    const restored = restoreMatchingEngine(engine.snapshot());
    for (const instrument of INSTRUMENTS) {
      assert.equal(
        JSON.stringify(restored.bookSnapshot(instrument)),
        JSON.stringify(engine.bookSnapshot(instrument)),
      );
    }
    for (const id of SCENARIO_IDS) {
      assert.equal(JSON.stringify(restored.orderStatus(id)), JSON.stringify(engine.orderStatus(id)));
    }
  });

  test("restore accepts a JSON round-tripped snapshot and snapshots back identically", () => {
    const snapshot = scenarioSnapshot();
    const restored = restoreMatchingEngine(snapshot);
    assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
    const reRestored = restoreMatchingEngine(restored.snapshot());
    for (const instrument of INSTRUMENTS) {
      assert.equal(
        JSON.stringify(reRestored.bookSnapshot(instrument)),
        JSON.stringify(restored.bookSnapshot(instrument)),
      );
    }
  });

  test("restored engines start with an empty journal that keeps appending", () => {
    const restored = restoreMatchingEngine(scenarioSnapshot());
    assert.equal(restored.journal().length, 0);
    restored.submitOrder(order(30, { side: "sell", price: "97", quantity: "1" }));
    assert.equal(restored.journal().length, 2);
  });

  test("submissions after restore continue seq and fill numbering", () => {
    const engine = scenarioEngine();
    const fillCount = new Set(
      engine
        .journal()
        .filter((event) => event.fill_id)
        .map((event) => event.fill_id),
    ).size;
    const restored = restoreMatchingEngine(engine.snapshot());
    const resting = restored.submitOrder(order(30, { side: "sell", price: "97", quantity: "1" }));
    assert.equal(resting[0].seq, engine.journal().length + 1);
    const crossing = restored.submitOrder(order(31, { side: "buy", price: "97", quantity: "1" }));
    assert.equal(crossing[0].seq, engine.journal().length + 3);
    assert.equal(crossing[1].fill_id, fll(fillCount + 1));
  });

  test("post-restore submissions emit byte-identical events to the live engine", () => {
    const engine = scenarioEngine();
    const restored = restoreMatchingEngine(engine.snapshot());
    const followUp = order(30, { side: "sell", price: "97", quantity: "1" });
    assert.equal(
      JSON.stringify(restored.submitOrder(followUp)),
      JSON.stringify(engine.submitOrder(followUp)),
    );
  });

  test("restore keeps last_at: submissions cannot stamp earlier than the snapshot", () => {
    const clock = createSimulatedClock();
    clock.advance(90);
    const engine = createMatchingEngine({ clock });
    engine.submitOrder(order(1));
    const snapshot = engine.snapshot();
    const restored = restoreMatchingEngine(snapshot);
    assert.throws(() => restored.submitOrder(order(2)), RangeError);
    const restoredOnTime = restoreMatchingEngine(snapshot, { clock });
    assert.equal(restoredOnTime.submitOrder(order(2))[0].at, toIsoSeconds(clock.now()));
  });

  test("a genesis snapshot restores to an empty engine", () => {
    const restored = restoreMatchingEngine(createMatchingEngine().snapshot());
    assert.equal(restored.journal().length, 0);
    assert.equal(
      JSON.stringify(restored.bookSnapshot("USDT/RUB")),
      JSON.stringify(createMatchingEngine().bookSnapshot("USDT/RUB")),
    );
    assert.equal(restored.submitOrder(order(1))[0].seq, 1);
  });

  test("rejects snapshots that are not the canonical document", () => {
    const snapshot = scenarioSnapshot();
    const cases = [
      null,
      "snapshot",
      5,
      [],
      { ...snapshot, extra: true },
      { ...snapshot, kind: "other" },
      { ...snapshot, version: 2 },
      { ...snapshot, instruments: "USDT/RUB" },
      { ...snapshot, instruments: [] },
      { ...snapshot, instruments: [...snapshot.instruments, snapshot.instruments[0]] },
      { ...snapshot, instruments: [{ name: "USDT/RUB" }] },
      { ...snapshot, orders: "orders" },
      { ...snapshot, orders: [null] },
      { ...snapshot, orders: [...snapshot.orders, snapshot.orders[0]] },
      { ...snapshot, orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, extra: 1 } : o)) },
      { ...snapshot, orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, order_id: "x" } : o)) },
      {
        ...snapshot,
        orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, instrument: "SOL/RUB" } : o)),
      },
      { ...snapshot, orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, side: "hold" } : o)) },
      { ...snapshot, orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, owner: 42 } : o)) },
      { ...snapshot, orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, price: "-1" } : o)) },
      {
        ...snapshot,
        orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, quantity: "0.000000" } : o)),
      },
      {
        ...snapshot,
        orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, remaining: "99.000000" } : o)),
      },
      {
        ...snapshot,
        orders: snapshot.orders.map((o) =>
          o.state === "filled" ? { ...o, remaining: "1.000000" } : o,
        ),
      },
      {
        ...snapshot,
        orders: snapshot.orders.map((o) =>
          o.state === "resting" ? { ...o, remaining: "0.000000" } : o,
        ),
      },
      {
        ...snapshot,
        orders: snapshot.orders.map((o, i) => (i === 0 ? { ...o, state: "exploded" } : o)),
      },
      { ...snapshot, resting: "resting" },
      { ...snapshot, resting: [] },
      { ...snapshot, resting: [...snapshot.resting, snapshot.resting[0]] },
      { ...snapshot, resting: [ord(88)] },
      { ...snapshot, resting: [snapshot.orders[0].order_id] },
      { ...snapshot, next_seq: 1 },
      { ...snapshot, next_seq: 0 },
      { ...snapshot, next_seq: 1.5 },
      { ...snapshot, next_seq: "37" },
      { ...snapshot, next_fill: 1 },
      { ...snapshot, next_fill: 0 },
      { ...snapshot, last_at: "soon" },
      { ...snapshot, last_at: -5 },
      { ...snapshot, last_at: 1.5 },
    ];
    for (const candidate of cases) {
      assertSnapshotRejected(candidate);
    }
  });

  test("rejects resting lists that drift from tracked resting orders", () => {
    const snapshot = scenarioSnapshot();
    assert.notEqual(snapshot.resting.length, 0);

    const restingMarkedFilled = {
      ...snapshot,
      orders: snapshot.orders.map((o) => (o.state === "resting" ? { ...o, state: "filled" } : o)),
    };
    assertSnapshotRejected(restingMarkedFilled);

    const filledMarkedResting = {
      ...snapshot,
      orders: snapshot.orders.map((o, i) =>
        o.state === "filled" && i === 0 ? { ...o, state: "resting" } : o,
      ),
      resting: [snapshot.orders[0].order_id, ...snapshot.resting],
    };
    assertSnapshotRejected(filledMarkedResting);
  });

  test("pins the resting list to book-insertion order", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { side: "sell", price: "95" }));
    engine.submitOrder(order(2, { side: "sell", price: "96" }));
    engine.submitOrder(order(3, { side: "buy", price: "80" }));
    const snapshot = JSON.parse(JSON.stringify(engine.snapshot()));
    assert.equal(snapshot.resting.length, 3);
    assertSnapshotRejected({ ...snapshot, resting: [...snapshot.resting].reverse() });
    assertSnapshotRejected({ ...snapshot, resting: [snapshot.resting[0], snapshot.resting[0], snapshot.resting[2]] });
    assertSnapshotRejected({ ...snapshot, resting: [ord(88), snapshot.resting[1], snapshot.resting[2]] });
    const restored = restoreMatchingEngine(snapshot);
    assert.equal(
      JSON.stringify(restored.bookSnapshot("USDT/RUB")),
      JSON.stringify(engine.bookSnapshot("USDT/RUB")),
    );
  });

  test("rejects options that are not a clock bag", () => {
    const snapshot = scenarioSnapshot();
    assert.throws(() => restoreMatchingEngine(snapshot, { bogus: true }), TypeError);
    assert.throws(() => restoreMatchingEngine(snapshot, { clock: 5 }), TypeError);
    assert.throws(() => restoreMatchingEngine(snapshot, 5), TypeError);
  });
});
