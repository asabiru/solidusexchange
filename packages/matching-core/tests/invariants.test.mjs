import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseScaledDecimal } from "../src/decimal.mjs";
import { createMatchingEngine } from "../src/engine.mjs";
import { marketOrder, ord, order } from "./helpers.mjs";

const BASE_SCALE = 6;
const PRICE_SCALE = 8;

/**
 * A busy deterministic scenario exercising fills at several levels, partial
 * fills, cancels and a self-trade rejection.
 *
 * @param {ReturnType<typeof createMatchingEngine>} engine
 */
function scenario(engine) {
  const submissions = [
    order(1, { side: "sell", price: "90", quantity: "2", owner: "desk-a" }),
    order(2, { side: "sell", price: "90", quantity: "3", owner: "desk-b" }),
    order(3, { side: "sell", price: "91", quantity: "5", owner: "desk-c" }),
    order(4, { side: "sell", price: "92", quantity: "4", owner: "desk-a" }),
    order(5, { side: "buy", price: "88", quantity: "7", owner: "desk-d" }),
    order(6, { side: "buy", price: "89", quantity: "1", owner: "desk-e" }),
  ];
  const outputs = submissions.map((submission) => engine.submitOrder(submission));
  outputs.push(engine.submitOrder(order(7, { side: "buy", price: "92", quantity: "9", owner: "desk-e" })));
  outputs.push(engine.cancelOrder("USDT/RUB", ord(6)));
  outputs.push(engine.submitOrder(order(8, { side: "sell", price: "88", quantity: "6", owner: "desk-c" })));
  outputs.push(engine.submitOrder(order(9, { side: "buy", price: "95", quantity: "20", owner: "desk-a" })));
  outputs.push(engine.cancelOrder("USDT/RUB", ord(5)));
  outputs.push(engine.submitOrder(order(10, { side: "buy", price: "94", quantity: "0.000001", owner: "desk-f" })));
  // A market sell sweeps whatever bids remain and its leftover is rejected.
  outputs.push(engine.submitOrder(marketOrder(11, { side: "sell", quantity: "30", owner: "desk-g" })));
  return outputs.flat();
}

/**
 * @param {readonly { order_id: string | null, type: string, quantity?: string, remaining_quantity?: string }[]} events
 */
function conserved(events) {
  const submitted = new Map();
  const filledBy = new Map();
  const remainder = new Map();
  for (const event of events) {
    if (event.order_id === null) {
      continue;
    }
    if (event.type === "accepted") {
      submitted.set(event.order_id, parseScaledDecimal(event.quantity, BASE_SCALE));
      remainder.set(event.order_id, parseScaledDecimal(event.quantity, BASE_SCALE));
      filledBy.set(event.order_id, 0n);
    }
    if (event.type === "filled" || event.type === "partially_filled") {
      filledBy.set(
        event.order_id,
        filledBy.get(event.order_id) + parseScaledDecimal(event.quantity, BASE_SCALE),
      );
      remainder.set(event.order_id, parseScaledDecimal(event.remaining_quantity, BASE_SCALE));
    }
    if (event.type === "resting" || event.type === "cancelled") {
      remainder.set(event.order_id, parseScaledDecimal(event.quantity, BASE_SCALE));
    }
    if (event.type === "rejected" && event.quantity !== undefined) {
      remainder.set(event.order_id, 0n);
      filledBy.set(
        event.order_id,
        filledBy.get(event.order_id) + parseScaledDecimal(event.quantity, BASE_SCALE),
      );
    }
  }
  for (const [orderId, original] of submitted) {
    const fills = filledBy.get(orderId);
    const rest = remainder.get(orderId);
    if (fills + rest !== original) {
      return `conservation broken for ${orderId}: fills ${fills} + remainder ${rest} != ${original}`;
    }
  }
  return null;
}

describe("matching invariants", () => {
  test("conservation: fills plus remainder always equal the original quantity", () => {
    const engine = createMatchingEngine();
    assert.equal(conserved(scenario(engine)), null);
  });

  test("no fill is worse than the limit price", () => {
    const engine = createMatchingEngine();
    const limits = new Map();
    const events = scenario(engine);
    for (const event of events) {
      if (event.type === "accepted" && event.price !== undefined) {
        limits.set(event.order_id, {
          side: event.side,
          price: parseScaledDecimal(event.price, PRICE_SCALE),
        });
      }
      if (event.fill_id !== undefined && event.side !== null) {
        const limit = limits.get(event.order_id);
        const fillPrice = parseScaledDecimal(event.price, PRICE_SCALE);
        if (limit === undefined) {
          // Market orders have no limit: the pin does not apply to them.
          continue;
        }
        if (event.side === "buy") {
          assert.equal(fillPrice <= limit.price, true, `buy fill ${event.price} above limit`);
        } else {
          assert.equal(fillPrice >= limit.price, true, `sell fill ${event.price} below limit`);
        }
      }
    }
  });

  test("the book never holds crossed levels and depths stay coherent", () => {
    const engine = createMatchingEngine();
    scenario(engine);
    for (const instrument of ["USDT/RUB", "TON/RUB", "TON/USDT"]) {
      const book = engine.bookSnapshot(instrument);
      const bid = book.bids.at(0)?.price;
      const ask = book.asks.at(0)?.price;
      assert.equal(bid === undefined || ask === undefined || bid < ask, true);
      for (const level of [...book.bids, ...book.asks]) {
        assert.equal(parseScaledDecimal(level.quantity, BASE_SCALE) > 0n, true);
        assert.equal(level.order_count > 0, true);
      }
    }
  });

  test("deterministic replay: the same inputs replay byte-identically", () => {
    const first = createMatchingEngine();
    const second = createMatchingEngine();
    const firstEvents = scenario(first);
    const secondEvents = scenario(second);
    assert.equal(JSON.stringify(firstEvents), JSON.stringify(secondEvents));
    assert.deepEqual(secondEvents, firstEvents);
    for (const instrument of ["USDT/RUB", "TON/RUB", "TON/USDT"]) {
      assert.equal(
        JSON.stringify(second.bookSnapshot(instrument)),
        JSON.stringify(first.bookSnapshot(instrument)),
      );
    }
  });

  test("fill ids are unique and sequential across the scenario", () => {
    const engine = createMatchingEngine();
    const events = scenario(engine);
    const fillIds = [...new Set(events.filter((event) => event.fill_id !== undefined).map((event) => event.fill_id))];
    assert.deepEqual(
      fillIds,
      fillIds.map((_id, index) => `fll_${(index + 1).toString(16).padStart(24, "0")}`),
    );
  });
});
