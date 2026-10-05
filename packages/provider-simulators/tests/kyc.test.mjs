import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createKycCallbackInbox,
  createKycCallbackVerifier,
  createKycSimulator,
  createSimulatedClock,
  KYC_SCENARIOS,
  ProviderError,
  validateKycCallback,
} from "../src/index.mjs";
import { epochOf, freshKey, runFlow } from "./helpers.mjs";

const flow = (scenario, overrides = {}) =>
  runFlow({
    createSimulator: createKycSimulator,
    createVerifier: createKycCallbackVerifier,
    createInbox: createKycCallbackInbox,
    request: { method: "submitApplicant", body: { applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-kyc-0001", ...overrides } },
    scenario,
    subjectOf: (response) => response.provider_reference,
    deadlineOf: (response) => epochOf(response.review_deadline),
  });

const trace = (steps) => steps.map((step) => `${step.status}:${step.action}`);

describe("KYC simulator scenarios", () => {
  test("covers exactly the documented scenarios", () => {
    assert.deepEqual(Object.keys(KYC_SCENARIOS), [
      "approve", "reject", "needs_more_data", "pending_timeout", "provider_outage",
      "duplicate_callback", "out_of_order_callback", "late_callback",
    ]);
  });

  test("approve", async () => {
    const run = await flow("approve");
    assert.equal(run.response.status, "submitted");
    assert.deepEqual(trace(run.steps), ["in_review:applied", "approved:applied"]);
    assert.equal(run.state.status, "approved");
    assert.deepEqual(run.expired, []);
    const status = await run.simulator.getApplicantStatus(run.subject);
    assert.equal(status.status, "approved");
    assert.equal(status.sequence, 2);
  });

  test("reject carries synthetic reason codes only", async () => {
    const run = await flow("reject");
    assert.deepEqual(trace(run.steps), ["in_review:applied", "rejected:applied"]);
    assert.deepEqual(run.steps[1].payload.reason_codes, ["SIM_DOCUMENT_UNREADABLE"]);
    assert.deepEqual(run.steps[1].payload.requested_items, []);
    assert.equal(run.state.status, "rejected");
  });

  test("needs-more-data lists requested items", async () => {
    const run = await flow("needs_more_data", { level: "enhanced" });
    assert.deepEqual(trace(run.steps), ["in_review:applied", "needs_more_data:applied"]);
    assert.deepEqual(run.steps[1].payload.requested_items, ["proof_of_address"]);
    assert.equal(run.steps[1].payload.level, "enhanced");
  });

  test("pending timeout leaves the review open until the consumer times it out", async () => {
    const run = await flow("pending_timeout");
    assert.deepEqual(trace(run.steps), ["in_review:applied"]);
    assert.deepEqual(run.expired, [run.subject]);
    assert.equal(run.state.timedOut, true);
    assert.equal(run.state.status, "in_review");
    assert.equal((await run.simulator.getApplicantStatus(run.subject)).status, "in_review");
  });

  test("provider outage is a retryable provider error with no callbacks", async () => {
    const simulator = createKycSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "provider_outage" });
    await assert.rejects(
      simulator.submitApplicant({ applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-kyc-0001" }),
      (error) => error instanceof ProviderError && error.code === "provider_unavailable" && error.retryable === true,
    );
    assert.equal(simulator.pendingCallbacks(), 0);
  });

  test("duplicate callback has the same body, a new nonce and no second effect", async () => {
    const run = await flow("duplicate_callback");
    assert.deepEqual(trace(run.steps), ["in_review:applied", "approved:applied", "approved:duplicate"]);
    assert.deepEqual(run.deliveries[2].body, run.deliveries[1].body);
    assert.notEqual(run.deliveries[2].headers["x-sim-nonce"], run.deliveries[1].headers["x-sim-nonce"]);
    assert.equal(run.state.status, "approved");
  });

  test("out-of-order callback is buffered until its predecessor arrives", async () => {
    const run = await flow("out_of_order_callback");
    assert.deepEqual(trace(run.steps), ["approved:buffered", "in_review:applied"]);
    assert.equal(run.state.status, "approved");
    assert.equal(run.state.sequence, 2);
  });

  test("late callback after the review deadline is held for review, not applied", async () => {
    const run = await flow("late_callback");
    assert.deepEqual(trace(run.steps), ["in_review:applied", "approved:late"]);
    assert.equal(run.state.status, "in_review");
    assert.equal(run.state.lateEvents, 1);
    assert.ok(epochOf(run.steps[1].payload.occurred_at) > epochOf(run.response.review_deadline));
  });
});

describe("KYC request and callback validation", () => {
  const base = { applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-kyc-0001" };

  test("idempotent replay returns the same submission; changed request conflicts", async () => {
    const simulator = createKycSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "approve" });
    const first = await simulator.submitApplicant(base);
    assert.deepEqual(await simulator.submitApplicant({ ...base }), first);
    assert.equal(simulator.pendingCallbacks(), 2);
    await assert.rejects(simulator.submitApplicant({ ...base, level: "enhanced" }), (error) => error.code === "idempotency_conflict");
  });

  test("rejects PII-looking references, unknown fields and bad values", async () => {
    const simulator = createKycSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "approve" });
    const bad = [
      { ...base, applicant_ref: "ivan.petrov@example.com" },
      { ...base, applicant_ref: "SIM-APPLICANT-1" },
      { ...base, applicant_ref: "sim-\u0430pplicant" },
      { ...base, level: "full" },
      { ...base, idempotency_key: "short" },
      { ...base, passport_number: "0000" },
      { applicant_ref: "sim-applicant-1", level: "basic" },
    ];
    for (const request of bad) {
      await assert.rejects(simulator.submitApplicant(request), (error) => error.code === "invalid_request", JSON.stringify(request));
    }
  });

  test("subjects without a scenario fail closed", async () => {
    const simulator = createKycSimulator({ seed: "seed-1", key: freshKey(), scenarios: { "sim-known": "approve" } });
    await assert.rejects(simulator.submitApplicant(base), (error) => error.code === "scenario_not_configured");
    await simulator.submitApplicant({ ...base, applicant_ref: "sim-known" });
    await assert.rejects(simulator.getApplicantStatus("kycref_missing"), (error) => error.code === "not_found");
    assert.throws(() => createKycSimulator({ seed: "seed-1", key: freshKey(), scenarios: { "real-user": "approve" } }), TypeError);
    assert.throws(() => createKycSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "auto_approve" }), TypeError);
    assert.throws(() => createKycSimulator({ seed: "seed-1", key: freshKey(), reviewTimeoutSeconds: 10 }), RangeError);
  });

  test("status is not visible before its simulated time", async () => {
    const clock = createSimulatedClock();
    const simulator = createKycSimulator({ seed: "seed-1", key: freshKey(), clock, defaultScenario: "approve" });
    const submission = await simulator.submitApplicant(base);
    assert.equal((await simulator.getApplicantStatus(submission.provider_reference)).status, "submitted");
    assert.deepEqual(simulator.drainCallbacks(), []);
    clock.advance(95);
    assert.equal((await simulator.getApplicantStatus(submission.provider_reference)).status, "in_review");
  });

  test("callback schema validator rejects inconsistent payloads", async () => {
    const run = await flow("reject");
    const payload = { ...run.steps[1].payload };
    assert.equal(validateKycCallback(payload), null);
    assert.match(validateKycCallback({ ...payload, reason_codes: [] }), /reason_codes/);
    assert.match(validateKycCallback({ ...payload, requested_items: ["proof_of_address"] }), /requested_items/);
    assert.match(validateKycCallback({ ...payload, reason_codes: ["SIM_DOCUMENT_UNREADABLE", "SIM_DOCUMENT_UNREADABLE"] }), /reason codes/);
    assert.match(validateKycCallback({ ...payload, schema: "v2" }), /schema/);
    assert.match(validateKycCallback({ ...payload, sequence: 0 }), /sequence/);
    assert.match(validateKycCallback({ ...payload, occurred_at: "2026-01-01T00:00:00.000Z" }), /occurred_at/);
    assert.match(validateKycCallback({ ...payload, occurred_at: "2026-02-30T00:00:00Z" }), /occurred_at/);
    assert.match(validateKycCallback({ ...payload, event_id: "evt-1" }), /identifiers/);
    assert.match(validateKycCallback({ ...payload, status: "submitted" }), /status/);
    const { level: _level, ...missing } = payload;
    assert.match(validateKycCallback(missing), /schema/);
  });
});
