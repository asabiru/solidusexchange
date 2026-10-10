import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSimulatedClock, toIsoSeconds } from "../src/deterministic.mjs";
import { createMatchingEngine } from "../src/engine.mjs";
import { replayMatchingEngine, restoreMatchingEngine } from "../src/replay.mjs";
import { fll, mixedScenario, ord, order } from "./helpers.mjs";

const AT = "2026-01-01T00:00:00Z";
const SCENARIO_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21].map(ord);
const INSTRUMENTS = ["USDT/RUB", "TON/RUB", "TON/USDT"];

/**
 * @param {readonly object[]} events
 */
function plain(events) {
  return events.map((event) => JSON.parse(JSON.stringify(event)));
}

/**
 * @param {readonly { type: string }[]} events
 */
function firstFillPairStart(events) {
  return events.findIndex(
    (event, index) =>
      (event.type === "filled" || event.type === "partially_filled") &&
      index + 1 < events.length &&
      event.order_id === event.maker_order_id,
  );
}

function scenarioJournal() {
  const engine = createMatchingEngine();
  mixedScenario(engine);
  return { engine, journal: engine.journal() };
}

/**
 * @param {readonly unknown[]} events
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

describe("replayMatchingEngine", () => {
  test("replaying a full journal reproduces the engine byte-identically", () => {
    const { engine, journal } = scenarioJournal();
    const replayed = replayMatchingEngine({ events: journal });
    for (const instrument of INSTRUMENTS) {
      assert.equal(
        JSON.stringify(replayed.bookSnapshot(instrument)),
        JSON.stringify(engine.bookSnapshot(instrument)),
      );
    }
    for (const id of SCENARIO_IDS) {
      assert.equal(JSON.stringify(replayed.orderStatus(id)), JSON.stringify(engine.orderStatus(id)));
    }
    assert.equal(JSON.stringify(replayed.journal()), JSON.stringify(journal));
  });

  test("live, replayed and restored engines agree byte-identically on the mixed scenario", () => {
    const live = createMatchingEngine();
    mixedScenario(live);
    const replayed = replayMatchingEngine({ events: live.journal() });
    const restored = restoreMatchingEngine(live.snapshot());
    for (const instrument of INSTRUMENTS) {
      const expected = JSON.stringify(live.bookSnapshot(instrument));
      assert.equal(JSON.stringify(replayed.bookSnapshot(instrument)), expected);
      assert.equal(JSON.stringify(restored.bookSnapshot(instrument)), expected);
    }
    for (const id of SCENARIO_IDS) {
      const expected = JSON.stringify(live.orderStatus(id));
      assert.equal(JSON.stringify(replayed.orderStatus(id)), expected);
      assert.equal(JSON.stringify(restored.orderStatus(id)), expected);
    }
  });

  test("replaying an empty stream yields a genesis engine", () => {
    const replayed = replayMatchingEngine({ events: [] });
    assert.equal(replayed.journal().length, 0);
    assert.equal(
      JSON.stringify(replayed.bookSnapshot("USDT/RUB")),
      JSON.stringify(createMatchingEngine().bookSnapshot("USDT/RUB")),
    );
    assert.equal(replayed.submitOrder(order(1))[0].seq, 1);
  });

  test("submissions after replay continue seq and fill numbering", () => {
    const { journal } = scenarioJournal();
    const fillCount = new Set(journal.filter((event) => event.fill_id).map((event) => event.fill_id)).size;
    const replayed = replayMatchingEngine({ events: journal });
    const resting = replayed.submitOrder(order(30, { side: "sell", price: "97", quantity: "1" }));
    assert.equal(resting[0].seq, journal.length + 1);
    const crossing = replayed.submitOrder(order(31, { side: "buy", price: "97", quantity: "1" }));
    assert.equal(crossing[0].seq, journal.length + 3);
    assert.equal(crossing[1].fill_id, fll(fillCount + 1));
    assert.equal(replayed.journal().length, journal.length + 5);
  });

  test("a replayed engine emits further events stamped no earlier than the stream", () => {
    const clock = createSimulatedClock();
    clock.advance(90);
    const live = createMatchingEngine({ clock });
    live.submitOrder(order(1));
    const replayed = replayMatchingEngine({ events: live.journal() });
    assert.throws(() => replayed.submitOrder(order(2)), RangeError);
    const replayedOnTime = replayMatchingEngine({ events: live.journal(), clock });
    assert.equal(replayedOnTime.submitOrder(order(2))[0].at, toIsoSeconds(clock.now()));
  });

  test("rejects streams that are not event arrays", () => {
    assertStreamRejected(undefined);
    assertStreamRejected("events");
    assertStreamRejected({});
    assertStreamRejected([null]);
    assertStreamRejected([[]]);
    assert.throws(() => replayMatchingEngine(), TypeError);
    assert.throws(() => replayMatchingEngine(5), TypeError);
    assert.throws(() => replayMatchingEngine({ events: [], bogus: true }), TypeError);
    assert.throws(() => replayMatchingEngine({ events: [], instruments: "USDT/RUB" }), TypeError);
  });

  test("rejects out-of-order, gapped and non-canonical streams", () => {
    const { journal } = scenarioJournal();
    const cases = [
      plain(journal).slice(1),
      plain(journal).filter((_, index) => index !== 5),
      plain(journal).toReversed(),
      plain(journal).map((event, index) => (index === 0 ? { ...event, seq: 0 } : event)),
      plain(journal).map((event, index) => (index === 0 ? { ...event, seq: 2 } : event)),
      plain(journal).map((event, index) => (index === 2 ? { ...event, type: "exploded" } : event)),
      plain(journal).map((event, index) => (index === 3 ? { ...event, at: "soon" } : event)),
      plain(journal).map((event, index) => (index === 3 ? { ...event, at: "2020-01-01T00:00:00Z" } : event)),
      plain(journal).map((event, index) => (index === 0 ? { ...event, posting: "ledger" } : event)),
      plain(journal).map((event, index) => (index === 0 ? { ...event, extra: true } : event)),
      plain(journal).map(({ seq, at, ...rest }, index) => (index === 0 ? { seq, at } : { seq, at, ...rest })),
    ];
    for (const stream of cases) {
      assertStreamRejected(stream);
    }
  });

  test("rejects fills, cancels and rejections the stream never earned", () => {
    const { journal } = scenarioJournal();
    const next = journal.length + 1;
    const fillCount = new Set(journal.filter((event) => event.fill_id).map((event) => event.fill_id)).size;

    const unacceptedFill = [
      ...plain(journal),
      {
        seq: next,
        at: AT,
        type: "filled",
        order_id: ord(42),
        instrument: "USDT/RUB",
        side: "sell",
        posting: "none",
        fill_id: fll(fillCount + 1),
        maker_order_id: ord(42),
        taker_order_id: ord(41),
        price: "90.00000000",
        quantity: "1.000000",
        remaining_quantity: "0.000000",
      },
    ];
    assertStreamRejected(unacceptedFill, /never accepted/);

    const ghostSelfTrade = [
      ...plain(journal),
      {
        seq: next,
        at: AT,
        type: "rejected",
        order_id: ord(42),
        instrument: "USDT/RUB",
        side: "buy",
        posting: "none",
        reason: "self_trade",
        quantity: "1.000000",
      },
    ];
    assertStreamRejected(ghostSelfTrade, /never accepted/);

    const ghostCancel = [
      ...plain(journal),
      {
        seq: next,
        at: AT,
        type: "cancelled",
        order_id: ord(1),
        instrument: "USDT/RUB",
        side: "sell",
        posting: "none",
        quantity: "1.000000",
      },
    ];
    assertStreamRejected(ghostCancel, /not resting/);

    const pairStart = firstFillPairStart(journal);
    assert.notEqual(pairStart, -1);
    assertStreamRejected(plain(journal).slice(0, pairStart + 1), /fill pair/);

    const skippedFill = plain(journal).map((event, index) =>
      index === pairStart ? { ...event, fill_id: fll(fillCount + 5) } : event,
    );
    assertStreamRejected(skippedFill, /sequential/);

    const swappedPair = plain(journal);
    const swap = swappedPair[pairStart];
    swappedPair[pairStart] = swappedPair[pairStart + 1];
    swappedPair[pairStart + 1] = swap;
    assertStreamRejected(swappedPair);

    const badRemainder = plain(journal).map((event, index) =>
      index === pairStart ? { ...event, remaining_quantity: "7.000000" } : event,
    );
    assertStreamRejected(badRemainder);
  });

  test("rejects accepted events that drift from a tracked order", () => {
    const { journal } = scenarioJournal();
    const secondAccept = journal.findIndex((event, index) => index > 0 && event.type === "accepted");
    assert.notEqual(secondAccept, -1);
    const duplicate = plain(journal);
    duplicate[secondAccept] = { ...duplicate[0], seq: duplicate[secondAccept].seq };
    assertStreamRejected(duplicate, /duplicate/);

    const driftedResting = plain(journal).map((event) =>
      event.type === "resting" ? { ...event, quantity: "9.000000" } : event,
    );
    assertStreamRejected(driftedResting);
  });

  test("rejects a stream whose instruments do not cover its events", () => {
    const custom = [
      {
        instrument: "SOL/RUB",
        base_asset: "SOL",
        quote_asset: "RUB",
        base_scale: 9,
        quote_scale: 2,
        price_scale: 8,
      },
    ];
    const live = createMatchingEngine({ instruments: custom });
    live.submitOrder(order(1, { instrument: "SOL/RUB", side: "sell", price: "5", quantity: "1" }));
    const replayed = replayMatchingEngine({ instruments: custom, events: live.journal() });
    assert.equal(
      JSON.stringify(replayed.bookSnapshot("SOL/RUB")),
      JSON.stringify(live.bookSnapshot("SOL/RUB")),
    );
    assertStreamRejected(live.journal(), /unknown instrument/);
  });
});
