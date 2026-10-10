import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createSimulatedClock, DEFAULT_EPOCH_SECONDS } from "../src/deterministic.mjs";
import { createMatchingEngine } from "../src/engine.mjs";
import { ord, order } from "./helpers.mjs";

/**
 * @param {ReturnType<typeof createMatchingEngine>} engine
 */
function transcript(engine) {
  const out = [];
  out.push(engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5" })));
  out.push(engine.submitOrder(order(2, { side: "sell", price: "91", quantity: "3" })));
  out.push(engine.submitOrder(order(3, { side: "buy", price: "91", quantity: "6" })));
  out.push(engine.submitOrder(order(4, { price: "junk" })));
  out.push(engine.cancelOrder("USDT/RUB", ord(2)));
  out.push(engine.submitOrder(order(5, { side: "buy", price: "0.00000001", quantity: "0.000001" })));
  return out.flat();
}

describe("determinism", () => {
  test("two fresh engines replay the same transcript byte-identically", () => {
    const first = transcript(createMatchingEngine());
    const second = transcript(createMatchingEngine());
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.deepEqual(second, first);
  });

  test("seq is strictly increasing across every emitted event", () => {
    const events = transcript(createMatchingEngine());
    const seqs = events.map((event) => event.seq);
    assert.deepEqual(seqs, seqs.map((_seq, index) => index + 1));
  });

  test("the default clock stamps the fixed simulated epoch", () => {
    const events = createMatchingEngine().submitOrder(order(1));
    for (const event of events) {
      assert.equal(event.at, "2026-01-01T00:00:00Z");
    }
    assert.equal(DEFAULT_EPOCH_SECONDS, 1_767_225_600);
  });

  test("an injected clock controls event timestamps monotonically", () => {
    const clock = createSimulatedClock();
    const engine = createMatchingEngine({ clock });
    const first = engine.submitOrder(order(1));
    clock.advance(90);
    const second = engine.submitOrder(order(2, { side: "sell", price: "90" }));
    clock.advance(0);
    assert.equal(first[0].at, "2026-01-01T00:00:00Z");
    assert.equal(second[0].at, "2026-01-01T00:01:30Z");
    const seqs = [...first, ...second].map((event) => event.seq);
    assert.deepEqual(seqs, seqs.map((_seq, index) => index + 1));
  });

  test("a clock moving backwards or returning junk fails closed", () => {
    const backwards = { now: () => DEFAULT_EPOCH_SECONDS - 1 };
    const engine = createMatchingEngine({ clock: backwards });
    engine.submitOrder(order(1));
    backwards.now = () => DEFAULT_EPOCH_SECONDS - 2;
    assert.throws(() => engine.submitOrder(order(2)), RangeError);
    const broken = { now: () => Number.NaN };
    const nan = createMatchingEngine({ clock: broken });
    assert.throws(() => nan.submitOrder(order(3)), RangeError);
  });

  test("engine options are validated", () => {
    assert.throws(() => createMatchingEngine(5), TypeError);
    assert.throws(() => createMatchingEngine({ clock: {} }), TypeError);
    assert.throws(() => createMatchingEngine({ instruments: "USDT/RUB" }), TypeError);
    assert.throws(() => createMatchingEngine({ unknown: true }), TypeError);
    assert.throws(
      () => createMatchingEngine({ instruments: [{ instrument: "X/Y" }] }),
      TypeError,
    );
    assert.throws(
      () =>
        createMatchingEngine({
          instruments: [
            { instrument: "AAA/BBB", base_asset: "AAA", quote_asset: "BBB", base_scale: 2, quote_scale: 2, price_scale: 8 },
            { instrument: "AAA/BBB", base_asset: "AAA", quote_asset: "BBB", base_scale: 2, quote_scale: 2, price_scale: 8 },
          ],
        }),
      TypeError,
    );
  });

  test("custom instruments work end to end", () => {
    const engine = createMatchingEngine({
      instruments: [
        { instrument: "AAA/BBB", base_asset: "AAA", quote_asset: "BBB", base_scale: 4, quote_scale: 2, price_scale: 6 },
      ],
    });
    engine.submitOrder({
      order_id: ord(1),
      instrument: "AAA/BBB",
      side: "sell",
      price: "1.5",
      quantity: "2.5",
    });
    const events = engine.submitOrder({
      order_id: ord(2),
      instrument: "AAA/BBB",
      side: "buy",
      price: "1.5",
      quantity: "2.5",
    });
    assert.equal(events.at(-1).price, "1.500000");
    assert.equal(events.at(-1).quantity, "2.5000");
  });
});
