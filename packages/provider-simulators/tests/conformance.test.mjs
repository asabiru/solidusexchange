import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertProviderAdapter,
  BANK_SCENARIOS,
  canonicalStringify,
  CHECKS_SCENARIOS,
  createBankCallbackVerifier,
  createBankSimulator,
  createChecksCallbackVerifier,
  createChecksSimulator,
  createKycCallbackVerifier,
  createKycSimulator,
  createKytCallbackVerifier,
  createKytSimulator,
  createNonceStore,
  createQuoteSimulator,
  createQuoteVerifier,
  createSimulatedClock,
  IdempotencyRegistry,
  KYC_SCENARIOS,
  KYT_SCENARIOS,
  ProviderError,
  QUOTE_SCENARIOS,
  SIMULATOR_DOMAINS,
  SIMULATOR_ENVIRONMENT,
} from "../src/index.mjs";
import { validateScenarioPlan } from "../src/simulator-core.mjs";
import { epochOf, freshKey, keyringOf } from "./helpers.mjs";

/**
 * Cross-domain conformance: every simulator domain declares its shared-contract
 * surface once in DOMAINS and the same invariant tests run against all of them.
 * Everything is dev-only and synthetic; no network, provider or ledger access.
 */
const SEED = "conformance-seed-1";
const FOREIGN_SEED = "conformance-seed-2";
const BOGUS_SCENARIO = "bogus_scenario";

const KYC_REQUEST = {
  applicant_ref: "sim-applicant-1",
  level: "basic",
  idempotency_key: "idem-kyc-0001",
};
const KYC_REQUEST_2 = { ...KYC_REQUEST, applicant_ref: "sim-applicant-2", idempotency_key: "idem-kyc-0002" };

const KYT_REQUEST = {
  asset: "USDT",
  network: "TRON_TESTNET",
  direction: "inbound",
  address: "sim-wallet-1",
  tx_ref: "sim-tx-1",
  amount: "250.000000",
  idempotency_key: "idem-kyt-0001",
};
const KYT_REQUEST_2 = { ...KYT_REQUEST, address: "sim-wallet-2", tx_ref: "sim-tx-2", idempotency_key: "idem-kyt-0002" };

const BANK_REQUEST = {
  intent_ref: "sim-intent-1",
  amount: "1500.00",
  currency: "RUB",
  method: "sbp",
  idempotency_key: "idem-bank-0001",
};
const BANK_REQUEST_2 = { ...BANK_REQUEST, intent_ref: "sim-intent-2", idempotency_key: "idem-bank-0002" };

const QUOTE_REQUEST = {
  pair: "USDT/RUB",
  side: "buy",
  base_amount: "100.000000",
  idempotency_key: "idem-quote-0001",
};
const QUOTE_REQUEST_2 = { ...QUOTE_REQUEST, side: "sell", idempotency_key: "idem-quote-0002" };

const CHECKS_MEMBERS = {
  "sim-sender-1": { kyc_verified: true },
  "sim-recipient-1": { kyc_verified: true },
};
const UNVERIFIED_SENDER_MEMBERS = {
  "sim-sender-1": { kyc_verified: false },
  "sim-recipient-1": { kyc_verified: true },
};
const CHECKS_REQUEST = {
  check_ref: "sim-check-1",
  check_type: "personal",
  sender_ref: "sim-sender-1",
  recipient_ref: "sim-recipient-1",
  amount: "25.000000",
  asset: "USDT",
  claim_reference: "claimref-0000000000000001",
  idempotency_key: "idem-check-0001",
};
const CHECKS_ISSUE = (outputs) => ({
  check_id: outputs[0].check_id,
  member_ref: "sim-sender-1",
  idempotency_key: "idem-issue-0001",
});
const CHECKS_CLAIM = (outputs) => ({
  check_id: outputs[0].check_id,
  member_ref: "sim-recipient-1",
  claim_reference: "claimref-0000000000000001",
  idempotency_key: "idem-claim-0001",
});

/** Drains the shared delivery queue after advancing the simulated clock. */
const queuedCollect = (advanceSeconds) => ({ simulator, clock }) => {
  clock.advance(advanceSeconds);
  return simulator
    .drainCallbacks()
    .map(({ deliverAt, headers, body }) => ({ headers, body, now: deliverAt }));
};

const resolveArg = (arg, outputs) => (typeof arg === "function" ? arg(outputs) : arg);

/**
 * Runs a domain's command program on a fresh simulator and returns every
 * emitted output plus the normalized signed deliveries it produced.
 */
async function runProgram(spec, { seed = SEED, key } = {}) {
  const clock = createSimulatedClock();
  const simulator = spec.create({ seed, key, clock, defaultScenario: spec.defaultScenario });
  const outputs = [];
  for (const command of spec.commands) {
    outputs.push(await simulator[command.method](resolveArg(command.arg, outputs)));
  }
  const deliveries = spec
    .collect({ simulator, clock, outputs })
    .map((delivery) => ({ headers: delivery.headers, body: Buffer.from(delivery.body), now: delivery.now }));
  return { simulator, clock, outputs, deliveries };
}

const transcriptOf = ({ outputs, deliveries }) =>
  canonicalStringify({
    outputs,
    deliveries: deliveries.map((delivery) => ({
      headers: delivery.headers,
      body: delivery.body.toString("utf8"),
      now: delivery.now,
    })),
  });

/** Recursively collects every [key, value] pair of a parsed JSON object. */
function collectFields(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFields(item, found);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.push([key, child]);
      collectFields(child, found);
    }
  }
  return found;
}

const DOMAINS = [
  {
    name: "kyc",
    scenarios: KYC_SCENARIOS,
    defaultScenario: "approve",
    create: (options) => createKycSimulator(options),
    verifier: (key) => createKycCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() }),
    schema: "solidchange.sim.kyc.callback.v1",
    subjectField: "provider_reference",
    commands: [
      { method: "submitApplicant", arg: KYC_REQUEST },
      { method: "submitApplicant", arg: KYC_REQUEST_2 },
    ],
    collect: queuedCollect(1_000),
    probe: (simulator, outputs) => simulator.getApplicantStatus(outputs[0].provider_reference),
    pending: (simulator) => simulator.pendingCallbacks(),
    idempotent: [{ method: "submitApplicant", arg: KYC_REQUEST, output: 0, conflict: { level: "enhanced" } }],
    contract: {},
    badScenarioPlans: [{ "sim-x-1": BOGUS_SCENARIO }, { "real-person-1": "approve" }],
    denials: [
      {
        name: "non-synthetic applicant_ref",
        code: "invalid_request",
        run: (simulator) => simulator.submitApplicant({ ...KYC_REQUEST, applicant_ref: "real-person-1" }),
      },
      {
        name: "unseeded applicant status",
        code: "not_found",
        run: (simulator) => simulator.getApplicantStatus("kycref_missing"),
      },
      {
        name: "unknown request member",
        code: "invalid_request",
        run: (simulator) => simulator.submitApplicant({ ...KYC_REQUEST, unsupported_field: 1 }),
      },
      {
        name: "applicant without a configured scenario",
        code: "scenario_not_configured",
        options: { scenarios: { "sim-other-1": "approve" }, defaultScenario: null },
        run: (simulator) => simulator.submitApplicant(KYC_REQUEST),
      },
    ],
  },
  {
    name: "kyt",
    scenarios: KYT_SCENARIOS,
    defaultScenario: "medium",
    create: (options) => createKytSimulator(options),
    verifier: (key) => createKytCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() }),
    schema: "solidchange.sim.kyt.callback.v1",
    subjectField: "assessment_id",
    commands: [
      { method: "screenTransfer", arg: KYT_REQUEST },
      { method: "screenTransfer", arg: KYT_REQUEST_2 },
    ],
    collect: queuedCollect(200),
    probe: (simulator, outputs) => simulator.getAssessment(outputs[0].assessment_id),
    pending: (simulator) => simulator.pendingCallbacks(),
    idempotent: [{ method: "screenTransfer", arg: KYT_REQUEST, output: 0, conflict: { amount: "251.000000" } }],
    contract: {},
    badScenarioPlans: [{ "sim-x-1": BOGUS_SCENARIO }, { "real-wallet-1": "medium" }],
    denials: [
      {
        name: "non-synthetic address",
        code: "invalid_request",
        run: (simulator) => simulator.screenTransfer({ ...KYT_REQUEST, address: "TXyz0000realLookingAddress" }),
      },
      {
        name: "unlisted asset",
        code: "invalid_request",
        run: (simulator) => simulator.screenTransfer({ ...KYT_REQUEST, asset: "DOGE" }),
      },
      {
        name: "unseeded assessment",
        code: "not_found",
        run: (simulator) => simulator.getAssessment("kytasm_missing"),
      },
      {
        name: "unknown request member",
        code: "invalid_request",
        run: (simulator) => simulator.screenTransfer({ ...KYT_REQUEST, unsupported_field: 1 }),
      },
      {
        name: "address without a configured scenario",
        code: "scenario_not_configured",
        options: { scenarios: { "sim-other-1": "medium" }, defaultScenario: null },
        run: (simulator) => simulator.screenTransfer(KYT_REQUEST),
      },
    ],
  },
  {
    name: "bank",
    scenarios: BANK_SCENARIOS,
    defaultScenario: "reversed_payment",
    create: (options) => createBankSimulator(options),
    verifier: (key) => createBankCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() }),
    schema: "solidchange.sim.bank.callback.v1",
    subjectField: "intent_id",
    commands: [
      { method: "createPaymentIntent", arg: BANK_REQUEST },
      { method: "createPaymentIntent", arg: BANK_REQUEST_2 },
    ],
    collect: queuedCollect(1_000),
    probe: (simulator, outputs) => simulator.getPaymentStatus(outputs[0].intent_id),
    pending: (simulator) => simulator.pendingCallbacks(),
    idempotent: [{ method: "createPaymentIntent", arg: BANK_REQUEST, output: 0, conflict: { amount: "1600.00" } }],
    contract: { posting: "none" },
    badScenarioPlans: [{ "sim-x-1": BOGUS_SCENARIO }, { "real-intent-1": "payment_found" }],
    denials: [
      {
        name: "non-synthetic intent_ref",
        code: "invalid_request",
        run: (simulator) => simulator.createPaymentIntent({ ...BANK_REQUEST, intent_ref: "real-intent-1" }),
      },
      {
        name: "unlisted currency",
        code: "invalid_request",
        run: (simulator) => simulator.createPaymentIntent({ ...BANK_REQUEST, currency: "USD" }),
      },
      {
        name: "unseeded payment intent",
        code: "not_found",
        run: (simulator) => simulator.getPaymentStatus("bankint_missing"),
      },
      {
        name: "unknown request member",
        code: "invalid_request",
        run: (simulator) => simulator.createPaymentIntent({ ...BANK_REQUEST, unsupported_field: 1 }),
      },
      {
        name: "intent without a configured scenario",
        code: "scenario_not_configured",
        options: { scenarios: { "sim-other-1": "payment_found" }, defaultScenario: null },
        run: (simulator) => simulator.createPaymentIntent(BANK_REQUEST),
      },
    ],
  },
  {
    name: "quote",
    scenarios: QUOTE_SCENARIOS,
    defaultScenario: "fresh_quote",
    create: (options) => createQuoteSimulator(options),
    verifier: (key) => createQuoteVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() }),
    schema: "solidchange.sim.quote.v2",
    subjectField: null,
    commands: [
      { method: "requestQuote", arg: QUOTE_REQUEST },
      { method: "requestQuote", arg: QUOTE_REQUEST_2 },
    ],
    collect: ({ simulator, outputs }) =>
      outputs.map((quote) => {
        const signed = simulator.exportSignedQuote(quote.quote_id);
        return { headers: signed.headers, body: signed.body, now: epochOf(quote.issued_at) };
      }),
    probe: (simulator, outputs) => simulator.getQuote(outputs[0].quote_id),
    pending: null,
    idempotent: [{ method: "requestQuote", arg: QUOTE_REQUEST, output: 0, conflict: { side: "sell" } }],
    contract: { status: "indicative", execution: "not_supported" },
    badScenarioPlans: [{ "USDT/RUB": BOGUS_SCENARIO }, { "sim-x-1": "fresh_quote" }],
    denials: [
      {
        name: "unlisted pair",
        code: "invalid_request",
        run: (simulator) => simulator.requestQuote({ ...QUOTE_REQUEST, pair: "BTC/RUB" }),
      },
      {
        name: "quote_amount on a sell",
        code: "invalid_request",
        run: (simulator) =>
          simulator.requestQuote({ pair: "USDT/RUB", side: "sell", quote_amount: "100.00", idempotency_key: "idem-quote-x001" }),
      },
      {
        name: "unseeded quote",
        code: "not_found",
        run: (simulator) => simulator.getQuote("quote_missing"),
      },
      {
        name: "unknown request member",
        code: "invalid_request",
        run: (simulator) => simulator.requestQuote({ ...QUOTE_REQUEST, unsupported_field: 1 }),
      },
      {
        name: "pair pinned to provider outage",
        code: "provider_unavailable",
        options: { scenarios: { "USDT/RUB": "provider_outage" }, defaultScenario: null },
        run: (simulator) => simulator.requestQuote(QUOTE_REQUEST),
      },
    ],
  },
  {
    name: "checks",
    scenarios: CHECKS_SCENARIOS,
    defaultScenario: "delivered",
    create: (options) => createChecksSimulator({ members: CHECKS_MEMBERS, ...options }),
    verifier: (key) => createChecksCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() }),
    schema: "solidchange.sim.checks.callback.v1",
    subjectField: "check_id",
    commands: [
      { method: "createCheck", arg: CHECKS_REQUEST },
      { method: "issueCheck", arg: CHECKS_ISSUE },
      { method: "claimCheck", arg: CHECKS_CLAIM },
    ],
    collect: queuedCollect(60),
    probe: (simulator, outputs) => simulator.getCheckStatus(outputs[0].check_id),
    pending: (simulator) => simulator.pendingCallbacks(),
    idempotent: [
      { method: "createCheck", arg: CHECKS_REQUEST, output: 0, conflict: { amount: "30.000000" } },
      { method: "issueCheck", arg: CHECKS_ISSUE, output: 1, conflict: { member_ref: "sim-recipient-1" } },
    ],
    contract: { posting: "none" },
    badScenarioPlans: [{ "sim-x-1": BOGUS_SCENARIO }, { "real-check-1": "delivered" }],
    denials: [
      {
        name: "non-synthetic check_ref",
        code: "invalid_request",
        run: (simulator) => simulator.createCheck({ ...CHECKS_REQUEST, check_ref: "real-check-1" }),
      },
      {
        name: "member outside the directory",
        code: "invalid_request",
        match: /unknown member/,
        run: (simulator) => simulator.createCheck({ ...CHECKS_REQUEST, sender_ref: "sim-stranger-1" }),
      },
      {
        name: "unverified sender",
        code: "invalid_request",
        options: { members: UNVERIFIED_SENDER_MEMBERS },
        run: (simulator) => simulator.createCheck(CHECKS_REQUEST),
      },
      {
        name: "unseeded check",
        code: "not_found",
        run: (simulator) => simulator.getCheckStatus("chk_missing"),
      },
      {
        name: "malformed check id",
        code: "invalid_request",
        run: (simulator) => simulator.getCheckStatus("BAD CHECK"),
      },
      {
        name: "unknown request member",
        code: "invalid_request",
        run: (simulator) => simulator.createCheck({ ...CHECKS_REQUEST, unsupported_field: 1 }),
      },
      {
        name: "check without a configured scenario",
        code: "scenario_not_configured",
        options: { scenarios: { "sim-other-1": "delivered" }, defaultScenario: null },
        run: (simulator) => simulator.createCheck(CHECKS_REQUEST),
      },
    ],
  },
];

const LEDGER_FIELD = /posting|settle|ledger|payout|execut/i;

for (const spec of DOMAINS) {
  test(`${spec.name}: satisfies the shared adapter contract`, () => {
    const simulator = spec.create({ seed: SEED, key: freshKey() });
    assert.equal(simulator.providerId, "simulator");
    assert.equal(assertProviderAdapter(spec.name, simulator), true);
    assert.ok(SIMULATOR_DOMAINS.includes(spec.name));
  });

  test(`${spec.name}: same seed produces byte-identical output`, async () => {
    const key = freshKey();
    const first = await runProgram(spec, { key });
    const second = await runProgram(spec, { key });
    assert.equal(transcriptOf(second), transcriptOf(first), `${spec.name} must be deterministic`);
    const divergent = await runProgram(spec, { key, seed: FOREIGN_SEED });
    assert.notEqual(transcriptOf(divergent), transcriptOf(first), `${spec.name} must react to the seed`);
  });

  test(`${spec.name}: emits only callbacks the shared verifier accepts`, async () => {
    const key = freshKey();
    const { deliveries } = await runProgram(spec, { key });
    assert.ok(deliveries.length > 0, `${spec.name} must emit signed output`);
    const verify = spec.verifier(key);
    const sequencesBySubject = new Map();
    for (const delivery of deliveries) {
      const result = verify({ headers: delivery.headers, body: delivery.body, now: delivery.now });
      assert.equal(result.ok, true, result.ok ? "" : result.reason);
      const payload = result.payload;
      assert.equal(payload.schema, spec.schema);
      assert.equal(payload.domain, spec.name);
      assert.equal(payload.environment, SIMULATOR_ENVIRONMENT);
      if (spec.subjectField === null) {
        assert.equal("sequence" in payload, false, "quote payloads carry no sequence");
      } else {
        const subject = payload[spec.subjectField];
        const sequences = sequencesBySubject.get(subject) ?? [];
        sequences.push(payload.sequence);
        sequencesBySubject.set(subject, sequences);
      }
    }
    for (const [subject, sequences] of sequencesBySubject) {
      assert.deepEqual(
        sequences,
        sequences.map((_, index) => index + 1),
        `${spec.name} sequences for ${subject} must be contiguous from 1`,
      );
    }
    const foreign = spec.verifier(freshKey("ed25519", key.keyId));
    const refused = foreign({ headers: deliveries[0].headers, body: deliveries[0].body, now: deliveries[0].now });
    assert.deepEqual({ ok: refused.ok, reason: refused.ok ? null : refused.reason }, { ok: false, reason: "signature_mismatch" });
  });

  test(`${spec.name}: replays idempotent commands without side effects`, async () => {
    const { simulator, outputs } = await runProgram(spec, { key: freshKey() });
    for (const step of spec.idempotent) {
      const arg = resolveArg(step.arg, outputs);
      const stateBefore = canonicalStringify(await spec.probe(simulator, outputs));
      const pendingBefore = spec.pending === null ? null : spec.pending(simulator);
      const replay = await simulator[step.method](arg);
      assert.equal(
        canonicalStringify(replay),
        canonicalStringify(outputs[step.output]),
        `${spec.name} replay must return the stored result`,
      );
      assert.equal(
        canonicalStringify(await spec.probe(simulator, outputs)),
        stateBefore,
        `${spec.name} replay must not add a state transition`,
      );
      if (pendingBefore !== null) {
        assert.equal(spec.pending(simulator), pendingBefore, `${spec.name} replay must not enqueue a duplicate callback`);
      }
      await assert.rejects(
        simulator[step.method]({ ...arg, ...step.conflict }),
        (error) => error instanceof ProviderError && error.code === "idempotency_conflict",
        `${spec.name} must reject reuse of an idempotency key with a different request`,
      );
    }
  });

  test(`${spec.name}: refuses unknown or unseeded references`, async () => {
    for (const denial of spec.denials) {
      const options = { seed: SEED, key: freshKey(), defaultScenario: spec.defaultScenario, ...(denial.options ?? {}) };
      if (options.defaultScenario === null) {
        delete options.defaultScenario;
      }
      const simulator = spec.create(options);
      await assert.rejects(
        denial.run(simulator),
        (error) =>
          error instanceof ProviderError
          && error.code === denial.code
          && (denial.match === undefined || denial.match.test(error.message)),
        `${spec.name} ${denial.name}`,
      );
    }
  });

  test(`${spec.name}: never emits ledger postings`, async () => {
    const { outputs, deliveries } = await runProgram(spec, { key: freshKey() });
    const payloads = deliveries.map((delivery) => JSON.parse(delivery.body.toString("utf8")));
    const emitted = [...outputs, ...payloads];
    assert.ok(emitted.length > 0);
    for (const object of emitted) {
      for (const [field, constant] of Object.entries(spec.contract)) {
        assert.equal(object[field], constant, `${spec.name} must keep ${field} at its contract constant`);
      }
      for (const [key, value] of collectFields(object)) {
        if (!LEDGER_FIELD.test(key)) {
          continue;
        }
        assert.equal(
          Object.hasOwn(spec.contract, key) && spec.contract[key] === value,
          true,
          `${spec.name} emitted unexpected ledger field ${key}=${JSON.stringify(value)}`,
        );
      }
    }
  });

  test(`${spec.name}: rejects unknown scenario keys`, () => {
    const names = Object.keys(spec.scenarios);
    assert.ok(names.length > 0);
    assert.throws(() => validateScenarioPlan({ "sim-ref-1": BOGUS_SCENARIO }, names), TypeError);
    for (const plan of spec.badScenarioPlans) {
      assert.throws(
        () => spec.create({ seed: SEED, key: freshKey(), scenarios: plan }),
        TypeError,
        `${spec.name} scenario mapping ${JSON.stringify(plan)}`,
      );
    }
    assert.throws(
      () => spec.create({ seed: SEED, key: freshKey(), defaultScenario: BOGUS_SCENARIO }),
      TypeError,
      `${spec.name} default scenario`,
    );
  });
}

test("IdempotencyRegistry replays stored results and rejects conflicting reuse", () => {
  const registry = new IdempotencyRegistry();
  let calls = 0;
  const create = () => {
    calls += 1;
    return { reference: "sim-ref-1", status: "created" };
  };
  const first = registry.run("idem-shared-0001", { amount: "10.00" }, create);
  const replay = registry.run("idem-shared-0001", { amount: "10.00" }, create);
  assert.equal(calls, 1);
  assert.deepEqual(replay, first);
  replay.status = "mutated";
  assert.equal(registry.run("idem-shared-0001", { amount: "10.00" }, create).status, "created");
  assert.throws(
    () => registry.run("idem-shared-0001", { amount: "11.00" }, create),
    (error) => error instanceof ProviderError && error.code === "idempotency_conflict",
  );
});

test("validateScenarioPlan accepts known names and rejects anything else", () => {
  const known = ["delivered", "returned"];
  const plan = validateScenarioPlan({ "sim-ref-1": "delivered" }, known);
  assert.deepEqual({ ...plan }, { "sim-ref-1": "delivered" });
  assert.equal(Object.isFrozen(plan), true);
  for (const bad of [{ "sim-ref-1": "unknown" }, { "real-ref-1": "delivered" }, ["delivered"], "delivered", 42]) {
    assert.throws(() => validateScenarioPlan(bad, known), TypeError);
  }
});
