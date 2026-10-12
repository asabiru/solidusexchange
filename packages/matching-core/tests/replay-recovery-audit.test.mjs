// Wave-75 adversarial audit pins for the recovery fold: operation
// atomicity (a stream may not interleave events the live engine emits
// atomically), earned `resting`/`rejected` events (the fold re-checks the
// exact live triggers against book state), and per-reason rejection echo
// rules. Repro cases document defects fixed on this branch; the rest are
// negative pins for classes verified clean.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createMatchingEngine } from "../src/engine.mjs";
import { replayMatchingEngine } from "../src/replay.mjs";
import { fll, marketOrder, mixedScenario, ord, order } from "./helpers.mjs";

const AT = "2026-01-01T00:00:00Z";
const LATER = "2026-01-01T00:00:05Z";

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
const rejected = (seq, n, fields = {}) => ({
  seq, at: AT, type: "rejected", posting: "none",
  order_id: ord(n), instrument: "USDT/RUB", side: "sell",
  reason: "invalid_price", ...fields,
});

describe("operation atomicity — no interleaved events", () => {
  test("a second accepted cannot land while an order is in flight", () => {
    assertStreamRejected(
      [accepted(1, 1), accepted(2, 2), resting(3, 2), resting(4, 1)],
      /in flight/,
    );
  });

  test("swapped resting events cannot reorder a price level", () => {
    // Defect: B resting before A resolves left fold-time books [B,A] while
    // the live engine can only emit [A,B]; a following fill pair then
    // resolved the swapped head — a state no live stream reaches.
    const stream = [
      accepted(1, 1), accepted(2, 2),
      resting(3, 2), resting(4, 1),
      accepted(5, 3, { side: "buy" }),
      {
        seq: 6, at: AT, type: "filled", posting: "none",
        order_id: ord(2), instrument: "USDT/RUB", side: "sell",
        fill_id: fll(1), maker_order_id: ord(2), taker_order_id: ord(3),
        price: "90.00000000", quantity: "1.000000", remaining_quantity: "0.000000",
      },
      {
        seq: 7, at: AT, type: "filled", posting: "none",
        order_id: ord(3), instrument: "USDT/RUB", side: "buy",
        fill_id: fll(1), maker_order_id: ord(2), taker_order_id: ord(3),
        price: "90.00000000", quantity: "1.000000", remaining_quantity: "0.000000",
      },
    ];
    assertStreamRejected(stream, /in flight/);
  });

  test("a resting event for a different in-flight order is interleaved", () => {
    assertStreamRejected(
      [accepted(1, 1), resting(2, 2)],
      /in flight/,
    );
  });

  test("cancelled and amended events cannot land mid-operation", () => {
    const base = [accepted(1, 1), resting(2, 1), accepted(3, 2)];
    assertStreamRejected(
      [
        ...base,
        {
          seq: 4, at: AT, type: "cancelled", posting: "none",
          order_id: ord(1), instrument: "USDT/RUB", side: "sell",
          price: "90.00000000", quantity: "1.000000",
        },
        resting(5, 2),
      ],
      /in flight/,
    );
    assertStreamRejected(
      [
        ...base,
        {
          seq: 4, at: AT, type: "amended", posting: "none",
          order_id: ord(1), instrument: "USDT/RUB", side: "sell",
          previous_price: "90.00000000", previous_quantity: "1.000000",
          price: "91.00000000", quantity: "1.000000",
        },
        resting(5, 2),
      ],
      /in flight/,
    );
  });

  test("a validation rejection cannot land mid-operation", () => {
    assertStreamRejected(
      [
        accepted(1, 1),
        rejected(2, 9, { reason: "invalid_instrument", instrument: null, side: null, order_id: ord(9) }),
      ],
      /in flight/,
    );
  });

  test("timestamps may not drift inside one operation", () => {
    assertStreamRejected(
      [accepted(1, 1), resting(2, 1, { at: LATER })],
      /inside an operation/,
    );
    assertStreamRejected(
      [
        accepted(1, 1), resting(2, 1),
        accepted(3, 2, { side: "buy" }),
        { ...resting(4, 2, { side: "buy" }), at: LATER },
      ],
      /inside an operation/,
    );
  });

  test("equal timestamps across operation boundaries still fold", () => {
    const engine = replayMatchingEngine({
      events: [
        accepted(1, 1), resting(2, 1),
        accepted(3, 2, { side: "buy", price: "80.00000000" }),
        resting(4, 2, { side: "buy", price: "80.00000000" }),
      ],
    });
    assert.equal(engine.journal().length, 4);
  });

  test("a stream ending mid-operation is rejected", () => {
    assertStreamRejected([accepted(1, 1)], /mid-operation|snapshot/);
  });
});

describe("resting events must be earned by the book", () => {
  test("a resting order may not cross the opposite head — even masked", () => {
    // Defect: the buy would have filled against the ask at 90 — live could
    // never emit its resting. A later cancel left the end state consistent,
    // so only a per-event check sees the fabrication.
    const crossed = [
      accepted(1, 1), resting(2, 1),
      accepted(3, 2, { side: "buy", price: "91.00000000" }),
      resting(4, 2, { side: "buy", price: "91.00000000" }),
    ];
    assertStreamRejected(crossed, /cross the book/);
    assertStreamRejected(
      [
        ...crossed,
        {
          seq: 5, at: AT, type: "cancelled", posting: "none",
          order_id: ord(2), instrument: "USDT/RUB", side: "buy",
          price: "91.00000000", quantity: "1.000000",
        },
      ],
      /cross the book/,
    );
  });

  test("a resting sell may not cross the best bid", () => {
    assertStreamRejected(
      [
        accepted(1, 1, { side: "buy", price: "92.00000000" }),
        resting(2, 1, { side: "buy", price: "92.00000000" }),
        accepted(3, 2),
        resting(4, 2),
      ],
      /cross the book/,
    );
  });

  test("a resting order priced through empty space still folds", () => {
    const engine = replayMatchingEngine({
      events: [
        accepted(1, 1), resting(2, 1),                          // ask 90
        accepted(3, 2, { side: "buy", price: "80.00000000" }), // bid 80 < 90
        resting(4, 2, { side: "buy", price: "80.00000000" }),
      ],
    });
    assert.deepEqual(engine.bookSnapshot("USDT/RUB").bids, [
      { price: "80.00000000", quantity: "1.000000", order_count: 1 },
    ]);
  });
});

describe("terminal rejections must be earned", () => {
  test("self_trade requires the same owner on a matchable head", () => {
    // Different owners: live would have filled, never rejected.
    assertStreamRejected(
      [
        accepted(1, 1, { owner: "desk-a" }), resting(2, 1),
        accepted(3, 2, { side: "buy", owner: "desk-b" }),
        rejected(4, 2, { side: "buy", reason: "self_trade", quantity: "1.000000" }),
      ],
      /not earned/,
    );
    // Same owner but the price never crosses: live would have rested.
    assertStreamRejected(
      [
        accepted(1, 1, { owner: "desk-a" }), resting(2, 1),
        accepted(3, 2, { side: "buy", price: "80.00000000", owner: "desk-a" }),
        rejected(4, 2, { side: "buy", reason: "self_trade", quantity: "1.000000" }),
      ],
      /not earned/,
    );
    // No opposite order at all.
    assertStreamRejected(
      [
        accepted(1, 1, { owner: "desk-a" }), resting(2, 1),
        {
          seq: 3, at: AT, type: "accepted", posting: "none",
          order_id: ord(2), instrument: "TON/RUB", side: "buy",
          order_type: "limit", price: "150.00000000", quantity: "1.000000000",
          owner: "desk-a",
        },
        {
          seq: 4, at: AT, type: "rejected", posting: "none",
          order_id: ord(2), instrument: "TON/RUB", side: "buy",
          reason: "self_trade", quantity: "1.000000000",
        },
      ],
      /not earned/,
    );
    // Maker without an owner cannot self-trade an owned taker.
    assertStreamRejected(
      [
        accepted(1, 1), resting(2, 1),
        accepted(3, 2, { side: "buy", owner: "desk-a" }),
        rejected(4, 2, { side: "buy", reason: "self_trade", quantity: "1.000000" }),
      ],
      /not earned/,
    );
  });

  test("a genuine self_trade rejection still folds", () => {
    const live = createMatchingEngine();
    live.submitOrder(order(1, { side: "sell", price: "90", owner: "desk-a" }));
    live.submitOrder(order(2, { side: "buy", price: "90", owner: "desk-a" }));
    assert.equal(live.journal().at(-1).reason, "self_trade");
    const engine = replayMatchingEngine({ events: live.journal() });
    assert.equal(engine.orderStatus(ord(2)).state, "rejected");
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });

  test("insufficient_liquidity requires an empty opposite book", () => {
    assertStreamRejected(
      [
        accepted(1, 1), resting(2, 1),
        {
          seq: 3, at: AT, type: "accepted", posting: "none",
          order_id: ord(2), instrument: "USDT/RUB", side: "buy",
          order_type: "market", quantity: "1.000000",
        },
        rejected(4, 2, { side: "buy", reason: "insufficient_liquidity", quantity: "1.000000" }),
      ],
      /not earned/,
    );
  });

  test("a market taker rejected on an empty book still folds", () => {
    const live = createMatchingEngine();
    live.submitOrder(order(1, { side: "sell", price: "90" }));
    live.submitOrder(marketOrder(2, { side: "sell", quantity: "1" }));
    const journal = live.journal();
    assert.equal(journal.at(-1).reason, "insufficient_liquidity");
    const engine = replayMatchingEngine({ events: journal });
    assert.equal(engine.orderStatus(ord(2)).state, "rejected");
  });
});

describe("validation rejections must be earned", () => {
  const streamWith = (event) => [accepted(1, 1), resting(2, 1), event];

  test("duplicate_order_id requires a tracked order", () => {
    assertStreamRejected(
      [rejected(1, 9, { reason: "duplicate_order_id", instrument: "USDT/RUB", side: "buy" })],
      /not earned/,
    );
    // A resubmitted live id can echo fields unrelated to the tracked order.
    const engine = replayMatchingEngine({
      events: [
        accepted(1, 1), resting(2, 1),
        rejected(3, 1, { reason: "duplicate_order_id", side: "buy" }),
      ],
    });
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });

  test("order_not_resting requires a non-resting target", () => {
    assertStreamRejected(
      streamWith(rejected(3, 1, { reason: "order_not_resting", side: null, instrument: "USDT/RUB" })),
      /not earned/,
    );
    assertStreamRejected(
      streamWith(rejected(3, 1, { reason: "order_not_resting", order_id: "junk", side: null, instrument: "USDT/RUB" })),
      /not earned/,
    );
    // Cancel-shaped echo on an untracked id stays emittable.
    const engine = replayMatchingEngine({
      events: [
        accepted(1, 1), resting(2, 1),
        rejected(3, 9, { reason: "order_not_resting", side: null, instrument: "USDT/RUB" }),
      ],
    });
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });

  test("no_change and quantity_below_filled require a resting echo match", () => {
    assertStreamRejected(
      streamWith(rejected(3, 1, { reason: "no_change", side: "buy" })),
      /not earned/,
    );
    assertStreamRejected(
      streamWith(rejected(3, 9, { reason: "no_change" })),
      /not earned/,
    );
    // Nothing executed yet: below-filled cannot have fired.
    assertStreamRejected(
      streamWith(rejected(3, 1, { reason: "quantity_below_filled" })),
      /not earned/,
    );
    // A resting order amended with its own values is a live no_change.
    const engine = replayMatchingEngine({
      events: streamWith(rejected(3, 1, { reason: "no_change" })),
    });
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });

  test("submit-path rejections pin which echo fields can be present", () => {
    const cases = [
      // instrument echo is always null on invalid_instrument.
      rejected(3, 1, { reason: "invalid_instrument", instrument: "USDT/RUB" }),
      // unknown_instrument needs an actual unknown instrument string.
      rejected(3, 1, { reason: "unknown_instrument", instrument: "USDT/RUB" }),
      // a valid-pattern id cannot echo an invalid_order_id rejection.
      rejected(3, 1, { reason: "invalid_order_id" }),
      // side validation is only reached with a valid id and instrument.
      rejected(3, "junk", { reason: "invalid_side", order_id: "junk", side: "junk" }),
      // owner/type/price/quantity rejections echo a validated id, known
      // instrument and valid side.
      rejected(3, "junk", { reason: "invalid_owner", order_id: "junk" }),
      rejected(3, 1, { reason: "invalid_price", instrument: "EVIL/COIN" }),
      rejected(3, 1, { reason: "invalid_quantity", side: "junk" }),
    ];
    for (const event of cases) {
      assertStreamRejected(streamWith(event), /not earned/);
    }
  });

  test("emittable validation rejections still fold", () => {
    const engine = replayMatchingEngine({
      events: [
        accepted(1, 1), resting(2, 1),
        rejected(3, 1, { reason: "invalid_price", side: "sell" }),
        rejected(4, 1, { reason: "invalid_owner", side: "sell" }),
        rejected(5, "junk", { reason: "invalid_order_id", order_id: "junk", side: "buy", instrument: "USDT/RUB" }),
        rejected(6, 1, { reason: "invalid_instrument", order_id: null, instrument: null, side: null }),
        rejected(7, 1, { reason: "unknown_instrument", order_id: null, instrument: "EVIL/COIN", side: null }),
        rejected(8, 9, { reason: "invalid_side", side: "hold" }),
        rejected(9, 1, { reason: "invalid_order", order_id: null, instrument: "USDT/RUB", side: "buy" }),
      ],
    });
    assert.equal(engine.orderStatus(ord(1)).state, "resting");
  });
});

describe("amend in-flight reconstruction", () => {
  test("a re-queued amend resolves through its own fill pair", () => {
    const live = createMatchingEngine();
    live.submitOrder(order(1, { side: "sell", price: "90", quantity: "3" }));
    live.submitOrder(order(2, { side: "sell", price: "90", quantity: "1" }));
    live.amendOrder({ order_id: ord(1), quantity: "4" });
    const journal = live.journal();
    assert.equal(
      journal.filter((e) => e.type === "amended").length,
      1,
      "amend emitted",
    );
    const engine = replayMatchingEngine({ events: journal });
    assert.equal(
      JSON.stringify(engine.snapshot()),
      JSON.stringify(live.snapshot()),
    );
  });

  test("a re-queued amend cannot share its operation with another order", () => {
    const stream = [
      accepted(1, 1), resting(2, 1),
      {
        seq: 3, at: AT, type: "amended", posting: "none",
        order_id: ord(1), instrument: "USDT/RUB", side: "sell",
        previous_price: "90.00000000", previous_quantity: "1.000000",
        price: "91.00000000", quantity: "2.000000",
      },
      accepted(4, 2),
      resting(5, 1, { price: "91.00000000", quantity: "2.000000" }),
      resting(6, 2),
    ];
    assertStreamRejected(stream, /in flight/);
  });
});

describe("live journals still fold byte-identically", () => {
  test("the mixed scenario replays to the same snapshot and counters", () => {
    const live = createMatchingEngine();
    mixedScenario(live);
    const engine = replayMatchingEngine({ events: live.journal() });
    assert.equal(
      JSON.stringify(engine.snapshot()),
      JSON.stringify(live.snapshot()),
    );
    assert.equal(
      JSON.stringify(engine.journal()),
      JSON.stringify(live.journal()),
    );
    // The resumed engine continues seq and fill ids where the stream ends.
    const batch = engine.submitOrder(order(50, { side: "sell", price: "100", quantity: "1" }));
    assert.equal(batch[0].seq, live.journal().length + 1);
  });
});
