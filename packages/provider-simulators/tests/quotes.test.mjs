import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assessQuote,
  canonicalStringify,
  computeQuoteAmounts,
  createNonceStore,
  createQuoteSimulator,
  createQuoteVerifier,
  createSimulatedClock,
  DEFAULT_EPOCH_SECONDS,
  formatAmount,
  maxBaseForQuoteBudget,
  parseAmount,
  parseDecimal,
  QUOTE_SCENARIOS,
  validateSignedQuote,
} from "../src/index.mjs";
import { epochOf, freshKey, keyringOf, nextNonce, signRaw } from "./helpers.mjs";

const request = { pair: "USDT/RUB", side: "buy", base_amount: "100.000000", idempotency_key: "idem-quote-0001" };
const now = DEFAULT_EPOCH_SECONDS;

describe("quote simulator", () => {
  test("covers the documented scenarios", () => {
    assert.deepEqual(Object.keys(QUOTE_SCENARIOS), ["fresh_quote", "expired_quote", "stale_price", "provider_outage"]);
  });

  test("fresh quote has TTL, spread and fee in exact decimals and is never executable", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey(), spreadBps: 50, feeBps: 30, ttlSeconds: 30 });
    const quote = await simulator.requestQuote(request);
    assert.equal(quote.status, "indicative");
    assert.equal(quote.execution, "not_supported");
    assert.equal(quote.ttl_seconds, 30);
    assert.equal(epochOf(quote.expires_at) - epochOf(quote.issued_at), 30);
    assert.equal(quote.spread_bps, 50);
    assert.equal(quote.fee_bps, 30);
    for (const field of ["base_amount", "mid_price", "price", "quote_amount", "fee_amount", "total_quote_amount"]) {
      assert.equal(typeof quote[field], "string", field);
    }
    assert.match(quote.quote_amount, /^[0-9]+\.[0-9]{2}$/);
    assert.match(quote.base_amount, /^[0-9]+\.[0-9]{6}$/);
    const mid = parseDecimal(quote.mid_price, 8);
    const price = parseDecimal(quote.price, 8);
    assert.ok(price > mid, "buy price includes half the spread above mid");
    const amounts = computeQuoteAmounts({ pair: "USDT/RUB", side: "buy", baseAmount: 100_000_000n, mid, spreadBps: 50, feeBps: 30 });
    assert.equal(quote.total_quote_amount, formatAmount("RUB", amounts.quoteUnits + amounts.fee));
    assert.equal(validateSignedQuote(quote), null);
    assert.deepEqual(assessQuote(quote, { now }), { displayable: true, reason: null, executable: false });
  });

  test("hand-computed example: TON/USDT sell with zero jitter math", () => {
    const amounts = computeQuoteAmounts({ pair: "TON/USDT", side: "sell", baseAmount: 2_500_000_000n, mid: 320_000_000n, spreadBps: 50, feeBps: 30 });
    assert.equal(amounts.price, 319_200_000n);
    assert.equal(formatAmount("USDT", amounts.quoteUnits), "7.980000");
    assert.equal(formatAmount("USDT", amounts.fee), "0.023940");
    assert.equal(formatAmount("USDT", amounts.total), "7.956060");
    const buy = computeQuoteAmounts({ pair: "TON/RUB", side: "buy", baseAmount: 1n, mid: 30_000_000_000n, spreadBps: 50, feeBps: 30 });
    assert.equal(formatAmount("RUB", buy.quoteUnits), "0.01");
  });

  test("quote expires exactly at its TTL", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey() });
    const quote = await simulator.requestQuote(request);
    const expiresAt = epochOf(quote.expires_at);
    assert.equal(assessQuote(quote, { now: expiresAt - 1 }).displayable, true);
    assert.deepEqual(assessQuote(quote, { now: expiresAt }), { displayable: false, reason: "expired", executable: false });
    assert.equal(assessQuote(quote, { now: now - 1 }).reason, "not_yet_valid");
  });

  test("expired quote scenario", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "expired_quote" });
    const quote = await simulator.requestQuote(request);
    assert.ok(epochOf(quote.expires_at) <= now);
    assert.deepEqual(assessQuote(quote, { now }), { displayable: false, reason: "expired", executable: false });
  });

  test("stale price scenario", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey(), scenarios: { "TON/RUB": "stale_price" } });
    const quote = await simulator.requestQuote({ ...request, pair: "TON/RUB", base_amount: "2.000000000" });
    assert.ok(epochOf(quote.issued_at) - epochOf(quote.price_observed_at) > 60);
    assert.equal(assessQuote(quote, { now }).reason, "stale_price");
    assert.equal(assessQuote(quote, { now, maxPriceAgeSeconds: 3600 }).displayable, true);
    assert.equal((await simulator.requestQuote({ ...request, idempotency_key: "idem-quote-0002" })).pair, "USDT/RUB");
  });

  test("provider outage", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "provider_outage" });
    await assert.rejects(simulator.requestQuote(request), (error) => error.code === "provider_unavailable" && error.retryable);
  });

  test("signed quote verifies; tampering and re-signing a changed price is still rejected", async () => {
    const key = freshKey();
    const clock = createSimulatedClock();
    const simulator = createQuoteSimulator({ seed: "seed-1", key, clock });
    const quote = await simulator.requestQuote({ ...request, side: "sell" });
    const signed = simulator.exportSignedQuote(quote.quote_id);
    const verify = createQuoteVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() });
    const result = verify({ headers: signed.headers, body: signed.body, now });
    assert.equal(result.ok, true);
    assert.deepEqual({ ...result.payload }, { ...quote });
    for (const change of [{ price: "1.00000000" }, { total_quote_amount: "1.00" }, { execution: "enabled" }, { status: "firm" }, { ttl_seconds: 3600 }, { rounding: "up" }, { base_asset: "TON" }, { spread_bps: 5000 }]) {
      const body = canonicalStringify({ ...quote, ...change });
      const forged = signRaw({ key, domain: "quote", body, timestamp: now, nonce: nextNonce() });
      assert.equal(verify({ headers: forged.headers, body: forged.body, now }).reason, "invalid_payload", JSON.stringify(change));
    }
    assert.equal(assessQuote({ ...quote, price: "1.00000000" }, { now }).reason, "invalid_quote");
  });

  test("base mode records the fixed base amount and no spend budget", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey() });
    const quote = await simulator.requestQuote(request);
    assert.equal(quote.schema, "solidchange.sim.quote.v2");
    assert.equal(quote.amount_mode, "base");
    assert.equal(quote.requested_quote_amount, null);
    assert.equal(validateSignedQuote({ ...quote, requested_quote_amount: "100.00" }), "requested_quote_amount must be null in base mode");
    assert.equal(validateSignedQuote({ ...quote, amount_mode: "fixed" }), "quote amount mode is buy only");
  });

  test("buy with quote_amount quotes the largest base amount within the spend budget", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey(), spreadBps: 50, feeBps: 30 });
    for (const [pair, budget] of [["USDT/RUB", "10000.00"], ["TON/RUB", "2500.55"], ["TON/USDT", "7.000001"], ["USDT/RUB", "0.92"]]) {
      const quote = await simulator.requestQuote({ pair, side: "buy", quote_amount: budget, idempotency_key: `idem-spend-${pair.replace("/", "-")}-${budget}` });
      const [base, quoteAsset] = pair.split("/");
      assert.equal(quote.amount_mode, "quote");
      assert.equal(quote.requested_quote_amount, budget);
      assert.equal(quote.rounding, "up");
      assert.equal(validateSignedQuote(quote), null);
      const budgetUnits = parseAmount(quoteAsset, budget);
      const baseUnits = parseAmount(base, quote.base_amount);
      const mid = parseDecimal(quote.mid_price, 8);
      assert.ok(parseAmount(quoteAsset, quote.total_quote_amount) <= budgetUnits, `${pair} total fits budget`);
      const next = computeQuoteAmounts({ pair, side: "buy", baseAmount: baseUnits + 1n, mid, spreadBps: 50, feeBps: 30 });
      assert.ok(next.total > budgetUnits, `${pair} one more base unit exceeds budget`);
      assert.equal(maxBaseForQuoteBudget({ pair, mid, spreadBps: 50, feeBps: 30, budget: budgetUnits }), baseUnits);
      assert.deepEqual(assessQuote(quote, { now }), { displayable: true, reason: null, executable: false });
    }
  });

  test("quote mode is buy only, exclusive with base_amount and rejects dust budgets", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey() });
    const spend = { pair: "USDT/RUB", side: "buy", quote_amount: "1000.00", idempotency_key: "idem-spend-0001" };
    for (const candidate of [
      { ...spend, side: "sell" },
      { ...spend, base_amount: "10.000000" },
      { pair: "USDT/RUB", side: "buy", idempotency_key: "idem-spend-0001" },
      { ...spend, quote_amount: "1000.0" },
      { ...spend, quote_amount: 1000 },
      { ...spend, quote_amount: "0.00" },
      { ...spend, pair: "TON/RUB", quote_amount: "0.01", idempotency_key: "idem-spend-dust" },
    ]) {
      await assert.rejects(simulator.requestQuote(candidate), (error) => error.code === "invalid_request", JSON.stringify(candidate));
    }
    const quote = await simulator.requestQuote(spend);
    assert.deepEqual(await simulator.requestQuote({ ...spend }), quote);
    await assert.rejects(simulator.requestQuote({ ...spend, quote_amount: "1000.01" }), (error) => error.code === "idempotency_conflict");
  });

  test("signed quote-mode quote rejects a forged budget or a base amount that is not maximal", async () => {
    const key = freshKey();
    const simulator = createQuoteSimulator({ seed: "seed-1", key });
    const quote = await simulator.requestQuote({ pair: "USDT/RUB", side: "buy", quote_amount: "5000.00", idempotency_key: "idem-spend-sign" });
    const signed = simulator.exportSignedQuote(quote.quote_id);
    const verify = createQuoteVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() });
    assert.equal(verify({ headers: signed.headers, body: signed.body, now }).ok, true);
    const budget = parseAmount("RUB", quote.requested_quote_amount);
    for (const change of [
      { requested_quote_amount: formatAmount("RUB", budget * 2n) },
      { requested_quote_amount: formatAmount("RUB", parseAmount("RUB", quote.total_quote_amount) - 1n) },
      { requested_quote_amount: null },
      { side: "sell", rounding: "down" },
      { amount_mode: "base" },
    ]) {
      const body = canonicalStringify({ ...quote, ...change });
      const forged = signRaw({ key, domain: "quote", body, timestamp: now, nonce: nextNonce() });
      assert.equal(verify({ headers: forged.headers, body: forged.body, now }).reason, "invalid_payload", JSON.stringify(change));
    }
  });

  test("requests are validated and idempotent", async () => {
    const simulator = createQuoteSimulator({ seed: "seed-1", key: freshKey() });
    const first = await simulator.requestQuote(request);
    assert.deepEqual(await simulator.requestQuote({ ...request }), first);
    assert.deepEqual(await simulator.getQuote(first.quote_id), first);
    await assert.rejects(simulator.requestQuote({ ...request, side: "sell" }), (error) => error.code === "idempotency_conflict");
    for (const overrides of [{ pair: "BTC/RUB" }, { pair: "RUB/USDT" }, { side: "short" }, { base_amount: 100 }, { base_amount: "100.00" }, { base_amount: "0.000000" }, { order_type: "market" }]) {
      await assert.rejects(simulator.requestQuote({ ...request, idempotency_key: "idem-quote-9999", ...overrides }), (error) => error.code === "invalid_request", JSON.stringify(overrides));
    }
    await assert.rejects(simulator.requestQuote({ ...request, pair: "TON/RUB", side: "sell", base_amount: "0.000000001", idempotency_key: "idem-quote-tiny" }), (error) => error.code === "invalid_request");
    await assert.rejects(simulator.getQuote("quote_missing"), (error) => error.code === "not_found");
    assert.throws(() => simulator.exportSignedQuote("quote_missing"), (error) => error.code === "not_found");
    assert.throws(() => createQuoteSimulator({ seed: "seed-1", key: freshKey(), ttlSeconds: 1 }), RangeError);
    assert.throws(() => createQuoteSimulator({ seed: "seed-1", key: freshKey(), feeBps: 1.5 }), RangeError);
    assert.throws(() => createQuoteSimulator({ seed: "seed-1", key: freshKey(), scenarios: { "BTC/RUB": "fresh_quote" } }), TypeError);
  });
});
