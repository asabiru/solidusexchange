import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import { EVENT_TYPES, POSTING, REJECT_REASONS, SELF_TRADE_POLICY } from "../src/events.mjs";
import * as api from "../src/index.mjs";
import { ord, order } from "./helpers.mjs";

const MONEY_MOVING_NAME =
  /^(?:approve|broadcast|charge|confirm|credit|custod|debit|deposit[A-Z]|execute|journal|ledger|mint|pay(?!ment)|payout|post|refund|release|serve|settle|sign[A-Z](?!ature)|transfer|withdraw)/;
const MONEY_MOVING_WORD =
  /(?:Broadcast|Custod|Deposit|Journal|Ledger|Posting|Payout|Settlement|Settle|Signature|Signer|Transfer|Withdraw)/;

describe("library boundary", () => {
  test("the exported surface carries no money-moving or serving names", () => {
    for (const name of Object.keys(api)) {
      assert.equal(MONEY_MOVING_NAME.test(name), false, name);
      assert.equal(MONEY_MOVING_WORD.test(name), false, name);
    }
  });

  test("policy pins stay deny-by-default", () => {
    assert.equal(SELF_TRADE_POLICY, "reject");
    assert.equal(POSTING, "none");
    assert.deepEqual(EVENT_TYPES, [
      "accepted",
      "resting",
      "partially_filled",
      "filled",
      "cancelled",
      "rejected",
    ]);
  });

  test("every emitted event is data with posting none and a known shape", () => {
    const engine = createMatchingEngine();
    const events = [
      ...engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "5", owner: "a" })),
      ...engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "6", owner: "a" })),
      ...engine.submitOrder(order(3, { side: "buy", price: "x" })),
      ...engine.cancelOrder("USDT/RUB", ord(1)),
      ...engine.submitOrder(order(4)),
      ...engine.cancelOrder("USDT/RUB", ord(4)),
    ];
    for (const event of events) {
      assert.equal(event.posting, "none", event.type);
      assert.equal(EVENT_TYPES.includes(event.type), true, event.type);
      assert.equal(Object.isFrozen(event), true);
      assert.equal(Number.isSafeInteger(event.seq), true);
      if (event.type === "rejected") {
        assert.equal(REJECT_REASONS.includes(event.reason), true, event.reason);
      }
      if (event.fill_id !== undefined) {
        assert.match(event.fill_id, /^fll_[0-9a-f]{24}$/u);
      }
      if (event.order_id !== null) {
        assert.match(event.order_id, /^ord_[0-9a-f]{24}$/u);
      }
    }
  });
});
