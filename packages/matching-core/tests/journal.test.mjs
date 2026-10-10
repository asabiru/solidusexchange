import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import { mixedScenario, ord, order } from "./helpers.mjs";

describe("engine journal", () => {
  test("captures every emitted event in contiguous seq order", () => {
    const engine = createMatchingEngine();
    const emitted = mixedScenario(engine);
    const journal = engine.journal();
    assert.equal(journal.length, emitted.length);
    assert.equal(JSON.stringify(journal), JSON.stringify(emitted));
    assert.deepEqual(
      journal.map((event) => event.seq),
      journal.map((_, index) => index + 1),
    );
  });

  test("rejected submissions and cancels consume seqs just like fills", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1, { price: "junk" }));
    engine.submitOrder(order(1));
    engine.cancelOrder("USDT/RUB", ord(1));
    engine.cancelOrder("USDT/RUB", ord(1));
    const journal = engine.journal();
    assert.deepEqual(
      journal.map((event) => event.seq),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      journal.map((event) => event.type),
      ["rejected", "accepted", "resting", "cancelled", "rejected"],
    );
  });

  test("the journal and its entries are frozen and reads cannot mutate them", () => {
    const engine = createMatchingEngine();
    engine.submitOrder(order(1));
    const first = engine.journal();
    assert.equal(Object.isFrozen(first), true);
    assert.equal(
      first.every((event) => Object.isFrozen(event)),
      true,
    );
    assert.throws(() => first.push({ seq: 99 }), TypeError);
    assert.equal(engine.journal() === first, false);
    assert.equal(engine.journal()[0] === first[0], true);
    engine.submitOrder(order(2));
    assert.equal(engine.journal().length, first.length + 2);
    assert.equal(first.length, 2);
    assert.equal(JSON.stringify(engine.journal().slice(0, 2)), JSON.stringify(first));
  });

  test("journals are per engine and start empty", () => {
    const one = createMatchingEngine();
    const two = createMatchingEngine();
    assert.equal(one.journal().length, 0);
    one.submitOrder(order(1));
    assert.equal(one.journal().length, 2);
    assert.equal(two.journal().length, 0);
  });

  test("a journal is JSON-serialisable plain data", () => {
    const engine = createMatchingEngine();
    mixedScenario(engine);
    const journal = engine.journal();
    assert.equal(JSON.stringify(JSON.parse(JSON.stringify(journal))), JSON.stringify(journal));
  });
});
