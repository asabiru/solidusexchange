import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createQuoteSimulator,
  ProviderError,
} from "../src/index.mjs";
import { freshKey } from "./helpers.mjs";

function simulator(options = {}) {
  return createQuoteSimulator({ seed: "audit-72", key: freshKey(), ttlSeconds: 30, ...options });
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(
      error instanceof ProviderError,
      `expected ProviderError(${code}), got ${error}`,
    );
    assert.equal(error.code, code);
    return true;
  });
}

describe("quotes simulator audit (wave 72)", () => {
  test("derived amounts past the 18-integer-digit wall surface invalid_request, never a raw RangeError", async () => {
    const sim = simulator();
    // Sell arm: an 18-digit base amount prices out to a ~20-digit quote
    // amount. Before the fix the unrepresentable formatDecimal call escaped
    // as RangeError instead of the contract's invalid_request.
    await rejectsWith(
      sim.requestQuote({
        pair: "USDT/RUB",
        side: "sell",
        base_amount: "999999999999999999.000000",
        idempotency_key: "audit72-overflow-sell",
      }),
      "invalid_request",
    );
    // Buy arm: base mode fixes base_amount and derives quote + fee + total.
    await rejectsWith(
      sim.requestQuote({
        pair: "USDT/RUB",
        side: "buy",
        base_amount: "999999999999999999.000000",
        idempotency_key: "audit72-overflow-buy",
      }),
      "invalid_request",
    );
    // TON/RUB (scale 9 base, ~300x price) overflows on a 17-digit input too.
    await rejectsWith(
      sim.requestQuote({
        pair: "TON/RUB",
        side: "sell",
        base_amount: "99999999999999999.999999999",
        idempotency_key: "audit72-overflow-ton",
      }),
      "invalid_request",
    );
  });

  test("overflow rejection is deterministic and leaks no state into the idempotency map", async () => {
    const sim = simulator();
    const request = {
      pair: "USDT/RUB",
      side: "sell",
      base_amount: "999999999999999999.000000",
      idempotency_key: "audit72-overflow-repeat",
    };
    await rejectsWith(sim.requestQuote(request), "invalid_request");
    // Same request replays to the same error (not a capacity/not_found ghost).
    await rejectsWith(sim.requestQuote(request), "invalid_request");
    // A well-formed request afterwards still issues a quote.
    const quote = await sim.requestQuote({
      pair: "USDT/RUB",
      side: "sell",
      base_amount: "100.000000",
      idempotency_key: "audit72-recovery",
    });
    assert.equal(quote.status, "indicative");
  });

  test("quote-mode budgets are capped below the wall by construction", async () => {
    const sim = simulator();
    // maxBaseForQuoteBudget pins total <= budget, so a quote-mode request can
    // never derive an unrepresentable amount even at the grammar ceiling.
    const quote = await sim.requestQuote({
      pair: "USDT/RUB",
      side: "buy",
      quote_amount: "999999999999999999.00",
      idempotency_key: "audit72-budget-ceiling",
    });
    assert.equal(quote.amount_mode, "quote");
    assert.equal(quote.status, "indicative");
    assert.ok(
      quote.total_quote_amount.replace(".", "").replace(/^0+/, "").length <=
        18 + 2,
      "total stays inside the canonical decimal wall",
    );
  });
});
