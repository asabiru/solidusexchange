import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { demoRepository } from "../data/demo.js";
import type { KycProviderEvidence, KytProviderEvidence, ProviderEvidenceFeed } from "../data/provider-evidence.js";
import {
  buildKycEvidence,
  buildKytEvidence,
  createProviderEvidenceSource,
  kycEvidencePlan,
  kytEvidencePlan
} from "./provider-evidence.js";
import { createBackofficeServer } from "./server.js";

const origin = "http://127.0.0.1:4173";
let server: Server;
let baseUrl: string;

async function devSession(role: string): Promise<string> {
  const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin
    },
    body: JSON.stringify({ role })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0];
}

function byScenario<T extends KycProviderEvidence | KytProviderEvidence>(
  feed: ProviderEvidenceFeed<T>,
  scenario: string
): T {
  const found = feed.cases.find((item) => item.scenario === scenario);
  assert.ok(found, `missing ${scenario} evidence`);
  return found;
}

function assertEvidenceOnly(feed: ProviderEvidenceFeed<KycProviderEvidence | KytProviderEvidence>): void {
  assert.equal(feed.source, "provider-simulator");
  assert.equal(feed.evidence_only, true);
  assert.equal(feed.decisionAuthority, "none");
  assert.equal(feed.decisionPath, "maker-checker-approval");
  for (const item of feed.cases) {
    assert.equal(item.source, "provider-simulator");
    assert.equal(item.evidence_only, true);
    assert.equal(item.environment, "dev-simulator");
    assert.deepEqual(item.operatorReview, {
      required: true,
      decision: null,
      decisionPath: "maker-checker-approval"
    });
    assert.match(item.id, /^PEV-(KYC|KYT)-\d{2}$/);
  }
}

describe("provider evidence projection", () => {
  it("covers every requested KYC and KYT scenario with synthetic references", async () => {
    const [kyc, kyt] = await Promise.all([buildKycEvidence(), buildKytEvidence()]);
    assert.deepEqual(kyc.cases.map((item) => item.scenario), [
      "approve",
      "reject",
      "needs_more_data",
      "pending_timeout",
      "provider_outage",
      "duplicate_callback",
      "out_of_order_callback",
      "late_callback"
    ]);
    assert.deepEqual(kyt.cases.map((item) => item.scenario), [
      "high",
      "sanctions_hit",
      "low",
      "provider_outage",
      "duplicate_callback",
      "out_of_order_callback",
      "late_callback"
    ]);
    for (const item of kyc.cases) assert.match(item.applicantRef, /^sim-bo-applicant-\d{2}$/);
    for (const item of kyt.cases) {
      assert.match(item.addressRef, /^sim-bo-wallet-\d{2}$/);
      assert.match(item.network, /_TESTNET$/);
    }
    assert.equal(kycEvidencePlan.length, kyc.cases.length);
    assert.equal(kytEvidencePlan.length, kyt.cases.length);
  });

  it("is deterministic across independent builds with fresh signing keys", async () => {
    assert.deepEqual(await buildKycEvidence(), await buildKycEvidence());
    assert.deepEqual(await buildKytEvidence(), await buildKytEvidence());
  });

  it("projects only verified callbacks with status, sequence and reason codes", async () => {
    const [kyc, kyt] = await Promise.all([buildKycEvidence(), buildKytEvidence()]);
    const approved = byScenario(kyc, "approve");
    assert.equal(approved.projectedStatus, "approved");
    assert.equal(approved.sequence, 2);
    const rejected = byScenario(kyc, "reject");
    assert.equal(rejected.projectedStatus, "rejected");
    assert.deepEqual(rejected.reasonCodes, ["SIM_DOCUMENT_UNREADABLE"]);
    const needsData = byScenario(kyc, "needs_more_data");
    assert.equal(needsData.projectedStatus, "needs_more_data");
    assert.ok(needsData.requestedItems.length > 0);
    const high = byScenario(kyt, "high");
    assert.equal(high.riskLevel, "high");
    assert.equal(high.tone, "danger");
    const sanctions = byScenario(kyt, "sanctions_hit");
    assert.equal(sanctions.sanctionsHit, true);
    assert.ok(sanctions.reasonCodes.includes("SIM_SANCTIONS"));
    for (const item of [...kyc.cases, ...kyt.cases]) {
      for (const record of item.receivedCallbacks) {
        assert.equal(record.verification, "verified");
        assert.equal(record.verificationReason, null);
        assert.ok(record.eventId);
      }
      for (const record of item.rejectedCallbacks) {
        assert.equal(record.verification, "rejected");
        assert.equal(record.accepted, false);
        assert.equal(record.inboxAction, null);
        assert.equal(record.status, null);
      }
    }
  });

  it("rejects replayed, tampered and foreign-key signed callbacks before the inbox", async () => {
    const [kyc, kyt] = await Promise.all([buildKycEvidence(), buildKytEvidence()]);
    const replay = byScenario(kyc, "approve");
    assert.deepEqual(replay.rejectedCallbacks.map((record) => [record.probe, record.verificationReason]), [
      ["replay", "replayed_nonce"]
    ]);
    const tampered = byScenario(kyc, "reject");
    assert.deepEqual(tampered.rejectedCallbacks.map((record) => [record.probe, record.verificationReason]), [
      ["tampered-body", "signature_mismatch"]
    ]);
    assert.equal(tampered.projectedStatus, "rejected");
    const forged = byScenario(kyt, "sanctions_hit");
    assert.deepEqual(forged.rejectedCallbacks.map((record) => [record.probe, record.verificationReason]), [
      ["foreign-key", "signature_mismatch"]
    ]);
    assert.equal(forged.riskLevel, "severe");
    assert.equal(forged.sanctionsHit, true);
    for (const item of [replay, tampered, forged]) {
      assert.equal(item.verification.result, "rejections-present");
      assert.equal(item.verification.rejected, 1);
    }
  });

  it("buffers out-of-order callbacks and ignores duplicates without double-applying", async () => {
    const [kyc, kyt] = await Promise.all([buildKycEvidence(), buildKytEvidence()]);
    for (const [feed, finalStatus] of [[kyc, "approved"], [kyt, "completed"]] as const) {
      const outOfOrder = byScenario<KycProviderEvidence | KytProviderEvidence>(feed, "out_of_order_callback");
      assert.deepEqual(
        outOfOrder.receivedCallbacks.map((record) => [record.sequence, record.inboxAction, record.accepted]),
        [[2, "buffered", true], [1, "applied", true]]
      );
      assert.equal(outOfOrder.projectedStatus, finalStatus);
      assert.equal(outOfOrder.sequence, 2);
      assert.equal(outOfOrder.buffered, 0);

      const duplicate = byScenario<KycProviderEvidence | KytProviderEvidence>(feed, "duplicate_callback");
      assert.deepEqual(
        duplicate.receivedCallbacks.map((record) => [record.sequence, record.inboxAction, record.accepted]),
        [[1, "applied", true], [2, "applied", true], [2, "duplicate", false]]
      );
      assert.equal(duplicate.verification.applied, 2);
      assert.equal(duplicate.sequence, 2);
    }
  });

  it("holds late callbacks and outages for operator review instead of applying them", async () => {
    const [kyc, kyt] = await Promise.all([buildKycEvidence(), buildKytEvidence()]);
    const lateKyc = byScenario(kyc, "late_callback");
    assert.equal(lateKyc.providerStatus, "approved");
    assert.equal(lateKyc.projectedStatus, "in_review");
    assert.equal(lateKyc.timedOut, true);
    assert.equal(lateKyc.lateEvents, 1);
    assert.equal(lateKyc.verification.heldForReview, 1);
    assert.equal(lateKyc.tone, "warning");
    const lateKyt = byScenario(kyt, "late_callback");
    assert.equal(lateKyt.projectedStatus, "pending");
    assert.equal(lateKyt.riskLevel, null);
    for (const feed of [kyc, kyt]) {
      const outage = byScenario<KycProviderEvidence | KytProviderEvidence>(feed, "provider_outage");
      assert.deepEqual(outage.outage, { code: "provider_unavailable", retryable: true });
      assert.equal(outage.providerReference, null);
      assert.equal(outage.verification.result, "no-callbacks");
      assert.deepEqual(outage.receivedCallbacks, []);
    }
    const timeout = byScenario(kyc, "pending_timeout");
    assert.equal(timeout.timedOut, true);
    assert.equal(timeout.projectedStatus, "in_review");
  });

  it("is frozen, memoized and marked evidence-only", async () => {
    const source = createProviderEvidenceSource();
    const kyc = await source.kyc();
    const kyt = await source.kyt();
    assert.equal(await source.kyc(), kyc);
    assert.equal(await source.kyt(), kyt);
    assertEvidenceOnly(kyc);
    assertEvidenceOnly(kyt);
    assert.ok(Object.isFrozen(kyc));
    assert.ok(Object.isFrozen(kyc.cases[0].receivedCallbacks[0]));
    assert.throws(() => {
      (kyt.cases[0] as { projectedStatus: string }).projectedStatus = "approved";
    }, TypeError);
  });
});

describe("provider evidence BFF routes", () => {
  before(async () => {
    server = createBackofficeServer({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [origin],
      allowDevLogin: true,
      sessionTtlSeconds: 900,
      audit: {
        storage: "memory",
        retentionDays: 30
      },
      stepUp: {
        provider: "synthetic-dev",
        challengeTtlSeconds: 300,
        grantTtlSeconds: 60,
        maxAttempts: 3
      },
      signing: {
        backend: "ephemeral-dev",
        rotationSeconds: 900,
        retainedVerificationKeys: 2
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server address unavailable");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("keeps provider evidence behind kyc:read and aml:read", async () => {
    const unauthenticated = await fetch(`${baseUrl}/bff/api/kyc`);
    assert.equal(unauthenticated.status, 401);
    for (const role of ["support-l1", "fraud-investigator"]) {
      const cookie = await devSession(role);
      const [kyc, aml] = await Promise.all([
        fetch(`${baseUrl}/bff/api/kyc`, { headers: { cookie } }),
        fetch(`${baseUrl}/bff/api/aml`, { headers: { cookie } })
      ]);
      assert.equal(kyc.status, 403, role);
      assert.equal(aml.status, 403, role);
      const bodies = [await kyc.json(), await aml.json()];
      assert.deepEqual(bodies, [{ error: "capability_denied" }, { error: "capability_denied" }]);
    }
  });

  it("serves signed KYC and AML responses with evidence-only provider feeds", async () => {
    const cookie = await devSession("aml-investigator");
    const [kyc, aml] = await Promise.all([
      fetch(`${baseUrl}/bff/api/kyc`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/aml`, { headers: { cookie } })
    ]);
    assert.equal(kyc.status, 200);
    assert.equal(aml.status, 200);
    const kycEnvelope = await kyc.json() as {
      resource: string;
      payload: { cases: unknown[]; providerEvidence: ProviderEvidenceFeed<KycProviderEvidence> };
    };
    const amlEnvelope = await aml.json() as {
      resource: string;
      payload: { cases: unknown[]; providerEvidence: ProviderEvidenceFeed<KytProviderEvidence> };
    };
    assert.equal(kycEnvelope.resource, "kyc-cases");
    assert.equal(amlEnvelope.resource, "aml-cases");
    assert.deepEqual(Object.keys(kycEnvelope.payload).sort(), ["cases", "providerEvidence"]);
    assert.deepEqual(Object.keys(amlEnvelope.payload).sort(), ["cases", "providerEvidence"]);
    assertEvidenceOnly(kycEnvelope.payload.providerEvidence);
    assertEvidenceOnly(amlEnvelope.payload.providerEvidence);
    assert.deepEqual(kycEnvelope.payload.providerEvidence, await buildKycEvidence());
    assert.deepEqual(amlEnvelope.payload.providerEvidence, await buildKytEvidence());
    assert.deepEqual(kycEnvelope.payload.cases, demoRepository.kycCases());
    assert.deepEqual(amlEnvelope.payload.cases, demoRepository.amlCases());
  });

  it("never lets provider status auto-decide or link an approval", async () => {
    const cookie = await devSession("compliance-lead");
    const kyc = await (await fetch(`${baseUrl}/bff/api/kyc`, { headers: { cookie } })).json() as {
      payload: { cases: { id: string; status: string; linkedApprovalId?: string }[]; providerEvidence: ProviderEvidenceFeed<KycProviderEvidence> };
    };
    const aml = await (await fetch(`${baseUrl}/bff/api/aml`, { headers: { cookie } })).json() as {
      payload: { cases: { id: string; state: string; linkedApprovalId?: string }[]; providerEvidence: ProviderEvidenceFeed<KytProviderEvidence> };
    };
    const approvedRun = kyc.payload.providerEvidence.cases.find((item) => item.projectedStatus === "approved" && item.linkedCaseId);
    assert.ok(approvedRun);
    const linked = kyc.payload.cases.find((item) => item.id === approvedRun.linkedCaseId);
    const original = demoRepository.kycCases().find((item) => item.id === approvedRun.linkedCaseId);
    assert.ok(linked && original);
    assert.equal(linked.status, original.status);
    assert.equal(linked.linkedApprovalId, original.linkedApprovalId);
    for (const item of [...kyc.payload.providerEvidence.cases, ...aml.payload.providerEvidence.cases]) {
      assert.equal(item.operatorReview.decision, null);
      assert.equal("approved" in item, false);
      assert.equal("decision" in item, false);
    }
    const caseIds = new Set([...kyc.payload.cases.map((item) => item.id), ...aml.payload.cases.map((item) => item.id)]);
    for (const item of [...kyc.payload.providerEvidence.cases, ...aml.payload.providerEvidence.cases]) {
      if (item.linkedCaseId) assert.ok(caseIds.has(item.linkedCaseId), item.linkedCaseId);
    }
    const approvals = await fetch(`${baseUrl}/bff/api/approvals`, { headers: { cookie } });
    const approvalsBody = await approvals.json() as { payload: { approvals: unknown[] } };
    assert.equal(approvalsBody.payload.approvals.length, demoRepository.approvals().length);
  });

  it("installs no provider evidence write routes", async () => {
    const cookie = await devSession("compliance-lead");
    for (const path of ["/bff/api/kyc", "/bff/api/aml"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ decision: "approve" })
        });
        assert.equal(response.status, 404, `${method} ${path}`);
      }
    }
  });
});
