import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KycScenario, ScheduledDelivery } from "@solidchange/provider-simulators";
import type { KycVerificationState } from "../shared/api.js";
import { KycUnavailableError, applicantRefOf, createKycService } from "./kyc.js";

const startMs = 1_790_000_000_000;
const subject = "tg-0123456789abcdef";

function service(scenario: KycScenario = "approve", reviewTimeoutSeconds = 3_600) {
  let now = startMs;
  const kyc = createKycService({ seed: "miniapp-kyc-test", scenario, reviewTimeoutSeconds, clock: () => now });
  return {
    kyc,
    advance(seconds: number) {
      now += seconds * 1_000;
    }
  };
}

function walk(run: ReturnType<typeof service>, seconds: number): KycVerificationState[] {
  const states: KycVerificationState[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
    run.advance(5);
    const state = run.kyc.view(subject, run.kyc.isVerified(subject) ? "verified" : "kyc-gated").state;
    if (states.at(-1) !== state) states.push(state);
  }
  return states;
}

function payloadOf(delivery: ScheduledDelivery): Record<string, unknown> {
  return JSON.parse(delivery.body.toString("utf8")) as Record<string, unknown>;
}

describe("test-mode KYC onboarding service", () => {
  it("derives a synthetic, non-PII applicant reference from the session subject", () => {
    const ref = applicantRefOf(subject);
    assert.match(ref, /^sim-[0-9a-f]{32}$/);
    assert.equal(applicantRefOf(subject), ref);
    assert.notEqual(applicantRefOf("tg-fedcba9876543210"), ref);
    assert.doesNotMatch(ref, /0123456789abcdef/);
  });

  it("starts not submitted and reports approved for a dev-verified session", () => {
    const { kyc } = service();
    assert.deepEqual(kyc.view(subject, "kyc-gated"), {
      mode: "test",
      provider: "simulator",
      state: "not_started",
      sessionKyc: "kyc-gated",
      canSubmit: true
    });
    assert.equal(kyc.view(subject, "verified").state, "approved");
    assert.equal(kyc.view(subject, "verified").canSubmit, false);
    assert.equal(kyc.isVerified(subject), false);
  });

  it("moves submitted → in review → approved only through signed callbacks", async () => {
    const run = service();
    assert.deepEqual(await run.kyc.submit(subject), { created: true });
    const submitted = run.kyc.view(subject, "kyc-gated");
    assert.equal(submitted.state, "submitted");
    assert.equal(submitted.canSubmit, false);
    assert.equal(submitted.submittedAt, startMs);
    assert.equal(submitted.reviewDeadline, startMs + 3_600_000);
    assert.deepEqual(walk(run, 600), ["submitted", "in_review", "approved"]);
    assert.equal(run.kyc.isVerified(subject), true);
    assert.deepEqual(run.kyc.inspect(subject), {
      status: "approved",
      sequence: 2,
      deadline: startMs / 1_000 + 3_600,
      timedOut: false,
      lateEvents: 0,
      reviewEvents: 0,
      buffered: 0
    });
  });

  it("is idempotent per subject", async () => {
    const run = service();
    assert.deepEqual(await run.kyc.submit(subject), { created: true });
    run.advance(10);
    assert.deepEqual(await run.kyc.submit(subject), { created: false });
    const results = await Promise.all([run.kyc.submit("tg-1111111111111111"), run.kyc.submit("tg-1111111111111111")]);
    assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
    assert.equal(run.kyc.view(subject, "kyc-gated").submittedAt, startMs);
  });

  it("maps rejected and needs-more-data decisions to non-verified states", async () => {
    for (const [scenario, state] of [["reject", "rejected"], ["needs_more_data", "needs_more_data"]] as const) {
      const run = service(scenario);
      await run.kyc.submit(subject);
      assert.deepEqual(walk(run, 600), ["submitted", "in_review", state], scenario);
      assert.equal(run.kyc.isVerified(subject), false, scenario);
      assert.equal(run.kyc.view(subject, "kyc-gated").canSubmit, false, scenario);
    }
  });

  it("times out a review that never receives a decision", async () => {
    const run = service("pending_timeout", 600);
    await run.kyc.submit(subject);
    assert.deepEqual(walk(run, 700), ["submitted", "in_review", "timed_out"]);
    assert.equal(run.kyc.isVerified(subject), false);
  });

  it("never verifies on an approval that arrives after the review deadline", async () => {
    const run = service("late_callback", 600);
    await run.kyc.submit(subject);
    assert.deepEqual(walk(run, 1_400), ["submitted", "in_review", "timed_out"]);
    assert.equal(run.kyc.isVerified(subject), false);
    assert.equal(run.kyc.inspect(subject)?.lateEvents, 1);
  });

  it("applies duplicated and reordered deliveries exactly once and in order", async () => {
    for (const scenario of ["duplicate_callback", "out_of_order_callback"] as const) {
      const run = service(scenario);
      await run.kyc.submit(subject);
      const states = walk(run, 900);
      assert.equal(states.at(-1), "approved", scenario);
      assert.ok(!states.includes("rejected"), scenario);
      assert.equal(run.kyc.inspect(subject)?.sequence, 2, scenario);
      assert.equal(run.kyc.inspect(subject)?.reviewEvents, 0, scenario);
    }
  });

  it("maps a provider outage to a retryable unavailable state", async () => {
    const { kyc } = service("provider_outage");
    await assert.rejects(kyc.submit(subject), KycUnavailableError);
    const view = kyc.view(subject, "kyc-gated");
    assert.equal(view.state, "unavailable");
    assert.equal(view.canSubmit, true);
    assert.equal(kyc.isVerified(subject), false);
  });

  it("restarts with a fresh application after a dev scenario reset", async () => {
    const run = service();
    await run.kyc.submit(subject);
    walk(run, 600);
    assert.equal(run.kyc.isVerified(subject), true);
    run.kyc.reset(subject);
    assert.equal(run.kyc.isVerified(subject), false);
    assert.equal(run.kyc.view(subject, "kyc-gated").state, "not_started");
    assert.deepEqual(await run.kyc.submit(subject), { created: true });
    assert.equal(run.kyc.view(subject, "kyc-gated").state, "submitted");
  });
});

describe("KYC callback verification", () => {
  async function pending() {
    const run = service();
    await run.kyc.submit(subject);
    run.advance(600);
    const deliveries = run.kyc.drainDeliveries();
    assert.deepEqual(deliveries.map((delivery) => payloadOf(delivery).status), ["in_review", "approved"]);
    return { ...run, review: deliveries[0], approval: deliveries[1] };
  }

  it("rejects unsigned, forged, wrongly keyed and stale deliveries", async () => {
    const { kyc, review, approval } = await pending();
    const at = approval.deliverAt;
    assert.deepEqual(kyc.receiveCallback({ headers: {}, body: approval.body }, at), { verified: false, reason: "missing_header" });
    assert.deepEqual(kyc.receiveCallback({ headers: approval.headers, body: approval.body.toString("utf8") }, at), { verified: false, reason: "invalid_body_type" });
    const forged = Buffer.from(review.body.toString("utf8").replace("\"in_review\"", "\"approved\""), "utf8");
    assert.deepEqual(kyc.receiveCallback({ headers: review.headers, body: forged }, review.deliverAt), { verified: false, reason: "signature_mismatch" });

    const other = service();
    await other.kyc.submit(subject);
    other.advance(600);
    const foreign = other.kyc.drainDeliveries()[1];
    assert.deepEqual(kyc.receiveCallback(foreign, foreign.deliverAt), { verified: false, reason: "signature_mismatch" });

    assert.deepEqual(kyc.receiveCallback(approval, at + 301), { verified: false, reason: "stale_timestamp" });
    assert.equal(kyc.isVerified(subject), false);
    assert.equal(kyc.view(subject, "kyc-gated").state, "submitted");
  });

  it("buffers an approval delivered before its predecessor and refuses replays", async () => {
    const { kyc, review, approval } = await pending();
    assert.deepEqual(kyc.receiveCallback(approval, approval.deliverAt), { verified: true, action: "buffered" });
    assert.equal(kyc.isVerified(subject), false);
    assert.equal(kyc.view(subject, "kyc-gated").state, "submitted");
    assert.equal(kyc.inspect(subject)?.buffered, 1);
    assert.deepEqual(kyc.receiveCallback(approval, approval.deliverAt), { verified: false, reason: "replayed_nonce" });
    assert.deepEqual(kyc.receiveCallback(review, review.deliverAt), { verified: true, action: "applied" });
    assert.equal(kyc.isVerified(subject), true);
  });

  it("ignores signed callbacks for an application that was reset", async () => {
    const { kyc, review, approval } = await pending();
    kyc.reset(subject);
    await kyc.submit(subject);
    // Reset prunes the discarded application's provider-reference index, so
    // its callbacks fail closed as unknown rather than being verified-inert.
    assert.deepEqual(kyc.receiveCallback(review, review.deliverAt), { verified: false, reason: "unknown_application" });
    assert.deepEqual(kyc.receiveCallback(approval, approval.deliverAt), { verified: false, reason: "unknown_application" });
    assert.equal(kyc.isVerified(subject), false);
    assert.equal(kyc.view(subject, "kyc-gated").state, "submitted");
  });
});
