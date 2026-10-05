import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBankSimulator,
  createKycSimulator,
  createKytSimulator,
  createQuoteSimulator,
  createSeededRandom,
  createSimulatedClock,
} from "../src/index.mjs";
import { freshKey } from "./helpers.mjs";

const SIMULATORS = {
  kyc: {
    create: createKycSimulator,
    scenarios: ["approve", "reject", "needs_more_data", "pending_timeout", "duplicate_callback", "out_of_order_callback", "late_callback"],
    run: (simulator, index) => simulator.submitApplicant({ applicant_ref: `sim-applicant-${index}`, level: "basic", idempotency_key: `idem-det-${index}-0` }),
  },
  kyt: {
    create: createKytSimulator,
    scenarios: ["low", "medium", "high", "severe", "sanctions_hit", "pending_timeout", "duplicate_callback", "out_of_order_callback", "late_callback"],
    run: (simulator, index) => simulator.screenTransfer({ asset: "TON", network: "TON_TESTNET", direction: "inbound", address: `sim-wallet-${index}`, amount: "3.000000000", idempotency_key: `idem-det-${index}-0` }),
  },
  bank: {
    create: createBankSimulator,
    scenarios: ["payment_found", "payment_not_found", "partial_payment", "duplicate_payment", "reversed_payment", "duplicate_callback", "out_of_order_callback", "late_callback"],
    run: (simulator, index) => simulator.createPaymentIntent({ intent_ref: `sim-intent-${index}`, amount: "777.77", currency: "RUB", method: "sbp", idempotency_key: `idem-det-${index}-0` }),
  },
};

const SCENARIO_FIELDS = { kyc: "applicant", kyt: "wallet", bank: "intent" };

async function transcript(domain, seed, key) {
  const spec = SIMULATORS[domain];
  const clock = createSimulatedClock();
  const scenarios = Object.fromEntries(spec.scenarios.map((scenario, index) => [`sim-${SCENARIO_FIELDS[domain]}-${index}`, scenario]));
  const simulator = spec.create({ seed, key, clock, scenarios });
  const responses = [];
  for (let index = 0; index < spec.scenarios.length; index += 1) {
    responses.push(await spec.run(simulator, index));
  }
  clock.advance(7200);
  const deliveries = simulator.drainCallbacks().map((delivery) => ({ ...delivery, body: delivery.body.toString("utf8") }));
  return { responses, deliveries };
}

async function quoteTranscript(seed, key) {
  const simulator = createQuoteSimulator({ seed, key, scenarios: { "TON/RUB": "stale_price", "TON/USDT": "expired_quote" } });
  const quotes = [];
  for (const pair of ["USDT/RUB", "TON/RUB", "TON/USDT"]) {
    for (const side of ["buy", "sell"]) {
      const quote = await simulator.requestQuote({ pair, side, base_amount: pair.startsWith("TON") ? "4.000000000" : "50.000000", idempotency_key: `idem-${pair.replace("/", "-")}-${side}` });
      const signed = simulator.exportSignedQuote(quote.quote_id);
      quotes.push({ quote, headers: signed.headers, body: signed.body.toString("utf8") });
    }
  }
  return quotes;
}

describe("determinism", () => {
  for (const domain of Object.keys(SIMULATORS)) {
    test(`${domain}: same seed and key give byte-identical records and signatures`, async () => {
      const key = freshKey();
      const first = await transcript(domain, "det-seed", key);
      const second = await transcript(domain, "det-seed", key);
      assert.ok(first.deliveries.length > 0);
      assert.deepEqual(second, first);
    });

    test(`${domain}: same seed with a fresh key changes only signatures; another seed changes ids`, async () => {
      const first = await transcript(domain, "det-seed", freshKey());
      const rekeyed = await transcript(domain, "det-seed", freshKey("hmac-sha256"));
      assert.deepEqual(rekeyed.responses, first.responses);
      assert.deepEqual(rekeyed.deliveries.map((delivery) => [delivery.deliverAt, delivery.body, delivery.headers["x-sim-nonce"]]), first.deliveries.map((delivery) => [delivery.deliverAt, delivery.body, delivery.headers["x-sim-nonce"]]));
      assert.notDeepEqual(rekeyed.deliveries.map((delivery) => delivery.headers["x-sim-signature"]), first.deliveries.map((delivery) => delivery.headers["x-sim-signature"]));
      const other = await transcript(domain, "other-seed", freshKey());
      assert.notDeepEqual(other.responses, first.responses);
    });
  }

  test("quote: same seed and key give identical quotes and signed bodies", async () => {
    const key = freshKey();
    assert.deepEqual(await quoteTranscript("det-seed", key), await quoteTranscript("det-seed", key));
    const other = await quoteTranscript("other-seed", key);
    assert.notDeepEqual(other.map((entry) => entry.quote.mid_price), (await quoteTranscript("det-seed", key)).map((entry) => entry.quote.mid_price));
  });

  test("seeded random stream is stable, labelled and validated", () => {
    const first = createSeededRandom("seed-1");
    const second = createSeededRandom("seed-1");
    const values = [first.hex("a", 16), first.int("b", 1, 6), first.id("x", "c")];
    assert.deepEqual([second.hex("a", 16), second.int("b", 1, 6), second.id("x", "c")], values);
    assert.match(values[2], /^x_[0-9a-f]{32}$/);
    assert.notEqual(createSeededRandom("seed-2").hex("a", 16), values[0]);
    for (const seed of ["", "seed with space", "s\u00e9ed", 1, "x".repeat(129)]) {
      assert.throws(() => createSeededRandom(seed), TypeError);
    }
  });
});
