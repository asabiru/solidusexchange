import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { demoRepository, type ApprovalRow } from "../data/demo.js";
import {
  AuditUnavailableError,
  type AuditStore
} from "./audit-store.js";
import { approvalCommandDigest } from "./controls.js";
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

describe("backoffice BFF", () => {
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

  it("fails closed when no operator session exists", async () => {
    const status = await fetch(`${baseUrl}/bff/auth/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { authenticated: false });

    const response = await fetch(`${baseUrl}/bff/api/dashboard`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "operator_session_required" });
  });

  it("serves signed read-only data after a server-issued session", async () => {
    const cookie = await devSession("compliance-lead");
    const status = await fetch(`${baseUrl}/bff/auth/status`, {
      headers: { cookie }
    });
    assert.deepEqual(await status.json(), { authenticated: true });

    const response = await fetch(`${baseUrl}/bff/api/dashboard`, {
      headers: { cookie }
    });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      keyId: string;
      keyVersion: number;
      signature: string;
      resource: string;
      payload: { metrics: readonly unknown[]; queues: readonly unknown[] };
    };
    assert.match(envelope.keyId, /^[a-f0-9]{32}$/);
    assert.ok(envelope.signature);
    assert.equal(envelope.resource, "dashboard");
    assert.equal(envelope.payload.metrics.length, 4);
    assert.equal(envelope.payload.queues.length, 4);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const signingKeysResponse = await fetch(`${baseUrl}/bff/api/signing-keys`);
    assert.equal(signingKeysResponse.status, 200);
    const signingKeys = await signingKeysResponse.json() as {
      formatVersion: number;
      backend: string;
      activeKeyId: string;
      keys: readonly {
        keyId: string;
        version: number;
        status: string;
        publicJwk: JsonWebKey;
      }[];
    };
    assert.equal(signingKeys.formatVersion, 1);
    assert.equal(signingKeys.backend, "ephemeral-dev");
    assert.equal(signingKeys.activeKeyId, envelope.keyId);
    assert.equal(signingKeys.keys[0].version, envelope.keyVersion);
    assert.equal(signingKeys.keys[0].status, "active");
    assert.equal("d" in signingKeys.keys[0].publicJwk, false);
  });

  it("enforces capabilities from the server session", async () => {
    const cookie = await devSession("support-l1");
    const allowed = await fetch(`${baseUrl}/bff/api/customers`, {
      headers: { cookie }
    });
    const [kyc, aml, investigations, fraud, approvals] = await Promise.all([
      fetch(`${baseUrl}/bff/api/kyc`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/aml`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/investigations`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/fraud-alerts`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/approvals`, { headers: { cookie } })
    ]);
    assert.equal(allowed.status, 200);
    assert.equal(kyc.status, 403);
    assert.equal(aml.status, 403);
    assert.equal(investigations.status, 403);
    assert.equal(fraud.status, 403);
    assert.equal(approvals.status, 403);
    assert.deepEqual(await kyc.json(), { error: "capability_denied" });
    assert.deepEqual(await aml.json(), { error: "capability_denied" });
    assert.deepEqual(await investigations.json(), { error: "capability_denied" });
    assert.deepEqual(await fraud.json(), { error: "capability_denied" });
    assert.deepEqual(await approvals.json(), { error: "capability_denied" });
  });

  it("serves signed customer-risk workflows without mutation routes", async () => {
    const cookie = await devSession("aml-investigator");
    const [kycResponse, amlResponse, mutationResponse] = await Promise.all([
      fetch(`${baseUrl}/bff/api/kyc`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/aml`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/aml`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin
        },
        body: JSON.stringify({ decision: "close" })
      })
    ]);
    assert.equal(kycResponse.status, 200);
    assert.equal(amlResponse.status, 200);
    assert.equal(mutationResponse.status, 404);
    assert.deepEqual(await mutationResponse.json(), { error: "not_found" });

    const kycEnvelope = await kycResponse.json() as {
      resource: string;
      payload: {
        cases: readonly {
          id: string;
          linkedApprovalId?: string;
          evidenceItems: readonly { status: string; digest: string }[];
          checks: readonly { status: string }[];
        }[];
      };
    };
    const amlEnvelope = await amlResponse.json() as {
      resource: string;
      payload: {
        cases: readonly {
          id: string;
          linkedApprovalId?: string;
          evidenceItems: readonly { status: string; digest: string }[];
          screenings: readonly { status: string }[];
        }[];
      };
    };
    assert.equal(kycEnvelope.resource, "kyc-cases");
    assert.equal(amlEnvelope.resource, "aml-cases");
    assert.equal(kycEnvelope.payload.cases.length, 3);
    assert.equal(amlEnvelope.payload.cases.length, 3);
    assert.equal(kycEnvelope.payload.cases[0].linkedApprovalId, "APV-843899");
    assert.equal(amlEnvelope.payload.cases[0].linkedApprovalId, "APV-843921");
    assert.ok(kycEnvelope.payload.cases[0].evidenceItems.every((item) => item.digest.startsWith("sha256:")));
    assert.ok(kycEnvelope.payload.cases[0].checks.some((item) => item.status === "review"));
    assert.ok(amlEnvelope.payload.cases[0].evidenceItems.some((item) => item.status === "missing"));
    assert.ok(amlEnvelope.payload.cases[0].screenings.some((item) => item.status === "match"));
    assert.equal(kycResponse.headers.get("cache-control"), "no-store");
  });

  it("allows compliance, AML and audit roles to read customer-risk evidence", async () => {
    for (const role of ["compliance-lead", "aml-investigator", "auditor"] as const) {
      const cookie = await devSession(role);
      const [kycResponse, amlResponse] = await Promise.all([
        fetch(`${baseUrl}/bff/api/kyc`, { headers: { cookie } }),
        fetch(`${baseUrl}/bff/api/aml`, { headers: { cookie } })
      ]);
      assert.equal(kycResponse.status, 200, `${role} should read KYC cases`);
      assert.equal(amlResponse.status, 200, `${role} should read AML cases`);
    }
  });

  it("serves signed investigations and fraud alerts without mutation routes", async () => {
    const cookie = await devSession("fraud-investigator");
    const [investigationsResponse, fraudResponse, mutationResponse] = await Promise.all([
      fetch(`${baseUrl}/bff/api/investigations`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/fraud-alerts`, { headers: { cookie } }),
      fetch(`${baseUrl}/bff/api/fraud-alerts`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin
        },
        body: JSON.stringify({ decision: "block" })
      })
    ]);
    assert.equal(investigationsResponse.status, 200);
    assert.equal(fraudResponse.status, 200);
    assert.equal(mutationResponse.status, 404);
    assert.deepEqual(await mutationResponse.json(), { error: "not_found" });

    const investigationsEnvelope = await investigationsResponse.json() as {
      resource: string;
      payload: {
        cases: readonly {
          id: string;
          relatedAlertIds: readonly string[];
          linkedApprovalId?: string;
          auditEvidenceDigest: string;
          timeline: readonly { evidenceDigest: string }[];
          evidenceItems: readonly { digest: string; status: string }[];
        }[];
      };
    };
    const fraudEnvelope = await fraudResponse.json() as {
      resource: string;
      payload: {
        alerts: readonly {
          id: string;
          controlMode: string;
          linkedInvestigationId?: string;
          signals: readonly { status: string }[];
          evidenceItems: readonly { digest: string }[];
        }[];
      };
    };
    assert.equal(investigationsEnvelope.resource, "investigations");
    assert.equal(fraudEnvelope.resource, "fraud-alerts");
    assert.equal(investigationsEnvelope.payload.cases.length, 3);
    assert.equal(fraudEnvelope.payload.alerts.length, 4);
    const alertIds = new Set(fraudEnvelope.payload.alerts.map((alert) => alert.id));
    assert.ok(investigationsEnvelope.payload.cases.every(
      (item) => item.relatedAlertIds.every((alertId) => alertIds.has(alertId))
    ));
    assert.equal(investigationsEnvelope.payload.cases[0].linkedApprovalId, "APV-843921");
    assert.ok(investigationsEnvelope.payload.cases[0].timeline.every(
      (event) => event.evidenceDigest.startsWith("sha256:")
    ));
    assert.ok(investigationsEnvelope.payload.cases[0].evidenceItems.some(
      (item) => item.status === "missing"
    ));
    assert.equal(fraudEnvelope.payload.alerts[0].controlMode, "monitor-only");
    assert.equal(fraudEnvelope.payload.alerts[0].linkedInvestigationId, "INV-43018");
    assert.ok(fraudEnvelope.payload.alerts[0].signals.some(
      (signal) => signal.status === "match"
    ));
    assert.ok(fraudEnvelope.payload.alerts[0].evidenceItems.every(
      (item) => item.digest.startsWith("sha256:")
    ));
    assert.equal(investigationsResponse.headers.get("cache-control"), "no-store");
  });

  it("allows compliance, AML, fraud and audit roles to read investigations", async () => {
    for (const role of [
      "compliance-lead",
      "aml-investigator",
      "fraud-investigator",
      "auditor"
    ] as const) {
      const cookie = await devSession(role);
      const [investigationsResponse, fraudResponse] = await Promise.all([
        fetch(`${baseUrl}/bff/api/investigations`, { headers: { cookie } }),
        fetch(`${baseUrl}/bff/api/fraud-alerts`, { headers: { cookie } })
      ]);
      assert.equal(investigationsResponse.status, 200, `${role} should read investigations`);
      assert.equal(fraudResponse.status, 200, `${role} should read fraud alerts`);
    }
  });

  it("serves a signed hash-chained audit view to audit roles", async () => {
    const cookie = await devSession("auditor");
    const response = await fetch(`${baseUrl}/bff/api/audit`, {
      headers: { cookie }
    });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      resource: string;
      payload: {
        events: readonly {
          sequence: number;
          hash: string;
          previousHash: string;
          resource: string;
          evidenceDigest: string;
        }[];
        chain: { verified: boolean; length: number; headHash: string };
      };
    };
    assert.equal(envelope.resource, "audit");
    assert.equal(envelope.payload.chain.verified, true);
    assert.equal(envelope.payload.chain.length, 8);
    assert.equal(envelope.payload.events[0].previousHash, "0".repeat(64));
    assert.equal(envelope.payload.chain.headHash, envelope.payload.events.at(-1)?.hash);
    assert.ok(envelope.payload.events.some(
      (event) => event.resource === "investigation:INV-43018"
        && event.evidenceDigest === "sha256:4ac921a0e61f"
    ));
    assert.ok(envelope.payload.events.some(
      (event) => event.resource === "fraud-alert:FRD-61084"
        && event.evidenceDigest === "sha256:ac7f8c9321d4"
    ));

    const exportResponse = await fetch(`${baseUrl}/bff/api/audit/export`, {
      headers: { cookie }
    });
    assert.equal(exportResponse.status, 200);
    const exported = await exportResponse.json() as {
      resource: string;
      payload: {
        formatVersion: number;
        storage: { durable: boolean; retentionDays: number };
        chain: { verified: boolean; headHash: string };
        events: readonly { hash: string }[];
      };
    };
    assert.equal(exported.resource, "audit-export");
    assert.equal(exported.payload.formatVersion, 1);
    assert.equal(exported.payload.storage.durable, false);
    assert.equal(exported.payload.storage.retentionDays, 30);
    assert.equal(exported.payload.chain.verified, true);
    assert.equal(exported.payload.chain.headHash, exported.payload.events.at(-1)?.hash);

    const mutation = await fetch(`${baseUrl}/bff/api/audit`, {
      method: "POST",
      headers: { cookie, origin }
    });
    assert.equal(mutation.status, 404);
  });

  it("returns a side-effect-free preview with policy blockers", async () => {
    const cookie = await devSession("compliance-lead");
    const approvalsResponse = await fetch(`${baseUrl}/bff/api/approvals`, {
      headers: { cookie }
    });
    const approvalsEnvelope = await approvalsResponse.json() as {
      payload: { approvals: readonly ApprovalRow[] };
    };
    const approval = approvalsEnvelope.payload.approvals.find(
      (item) => item.id === "APV-843910"
    );
    assert.ok(approval);

    const response = await fetch(`${baseUrl}/bff/api/approvals/${approval.id}/preview`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({ commandDigest: approvalCommandDigest(approval) })
    });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      resource: string;
      payload: {
        policy: {
          independentApprover: boolean;
          stepUpMfa: string;
          commandClient: string;
          executable: boolean;
          blockers: readonly string[];
        };
        auditAnchor: { hash: string };
      };
    };
    assert.equal(envelope.resource, `approval-preview:${approval.id}`);
    assert.equal(envelope.payload.policy.independentApprover, true);
    assert.equal(envelope.payload.policy.stepUpMfa, "required");
    assert.equal(envelope.payload.policy.commandClient, "absent");
    assert.equal(envelope.payload.policy.executable, false);
    assert.ok(envelope.payload.policy.blockers.includes("command_client_absent"));
    const auditResponse = await fetch(`${baseUrl}/bff/api/audit`, {
      headers: { cookie }
    });
    const auditEnvelope = await auditResponse.json() as {
      payload: { chain: { headHash: string } };
    };
    assert.equal(envelope.payload.auditAnchor.hash, auditEnvelope.payload.chain.headHash);
  });

  it("binds synthetic step-up proof to one session and consumes it once", async () => {
    const cookie = await devSession("compliance-lead");
    const otherCookie = await devSession("compliance-lead");
    const approvalsResponse = await fetch(`${baseUrl}/bff/api/approvals`, {
      headers: { cookie }
    });
    const approvalsEnvelope = await approvalsResponse.json() as {
      payload: { approvals: readonly (ApprovalRow & { commandDigest: string })[] };
    };
    const approval = approvalsEnvelope.payload.approvals.find(
      (item) => item.id === "APV-843910"
    );
    assert.ok(approval);
    const path = `${baseUrl}/bff/api/approvals/${approval.id}/step-up/challenges`;
    const challengeResponse = await fetch(path, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({ commandDigest: approval.commandDigest })
    });
    assert.equal(challengeResponse.status, 200);
    const challengeEnvelope = await challengeResponse.json() as {
      resource: string;
      payload: {
        challengeVersion: number;
        challengeId: string;
        provider: string;
        attemptsRemaining: number;
        devVerificationCode: string;
      };
    };
    assert.equal(challengeEnvelope.resource, `step-up-challenge:${approval.id}`);
    assert.equal(challengeEnvelope.payload.challengeVersion, 1);
    assert.equal(challengeEnvelope.payload.provider, "synthetic-dev");
    assert.equal(challengeEnvelope.payload.attemptsRemaining, 3);
    assert.match(challengeEnvelope.payload.devVerificationCode, /^\d{6}$/);

    const verificationPath = `${path}/${challengeEnvelope.payload.challengeId}/verify`;
    const wrongSession = await fetch(verificationPath, {
      method: "POST",
      headers: {
        cookie: otherCookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({
        commandDigest: approval.commandDigest,
        code: challengeEnvelope.payload.devVerificationCode
      })
    });
    assert.equal(wrongSession.status, 409);
    assert.deepEqual(await wrongSession.json(), {
      error: "step_up_rejected",
      state: "binding_mismatch"
    });

    const wrongCode = challengeEnvelope.payload.devVerificationCode === "999999"
      ? "000000"
      : "999999";
    const retryable = await fetch(verificationPath, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({
        commandDigest: approval.commandDigest,
        code: wrongCode
      })
    });
    assert.equal(retryable.status, 409);
    assert.deepEqual(await retryable.json(), {
      error: "step_up_rejected",
      state: "invalid_code",
      attemptsRemaining: 2
    });

    const verificationResponse = await fetch(verificationPath, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({
        commandDigest: approval.commandDigest,
        code: challengeEnvelope.payload.devVerificationCode
      })
    });
    assert.equal(verificationResponse.status, 200);
    const verificationEnvelope = await verificationResponse.json() as {
      resource: string;
      payload: { grant: string; provider: string };
    };
    assert.equal(verificationEnvelope.resource, `step-up-verification:${approval.id}`);
    assert.equal(verificationEnvelope.payload.provider, "synthetic-dev");

    const replayVerification = await fetch(verificationPath, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({
        commandDigest: approval.commandDigest,
        code: challengeEnvelope.payload.devVerificationCode
      })
    });
    assert.equal(replayVerification.status, 409);
    assert.equal((await replayVerification.json() as { state: string }).state, "challenge_unavailable");

    const previewPath = `${baseUrl}/bff/api/approvals/${approval.id}/preview`;
    const verifiedPreview = await fetch(previewPath, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({
        commandDigest: approval.commandDigest,
        stepUpGrant: verificationEnvelope.payload.grant
      })
    });
    assert.equal(verifiedPreview.status, 200);
    const verifiedEnvelope = await verifiedPreview.json() as {
      payload: {
        policy: {
          stepUpMfa: string;
          executable: boolean;
          blockers: readonly string[];
        };
      };
    };
    assert.equal(verifiedEnvelope.payload.policy.stepUpMfa, "verified");
    assert.equal(verifiedEnvelope.payload.policy.executable, false);
    assert.equal(
      verifiedEnvelope.payload.policy.blockers.includes("step_up_mfa_required"),
      false
    );
    assert.equal(
      verifiedEnvelope.payload.policy.blockers.includes("command_client_absent"),
      true
    );

    const replayGrant = await fetch(previewPath, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({
        commandDigest: approval.commandDigest,
        stepUpGrant: verificationEnvelope.payload.grant
      })
    });
    assert.equal(replayGrant.status, 409);
    assert.equal((await replayGrant.json() as { state: string }).state, "grant_rejected");

    const executionRoute = await fetch(
      `${baseUrl}/bff/api/approvals/${approval.id}/execute`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin
        },
        body: JSON.stringify({ commandDigest: approval.commandDigest })
      }
    );
    assert.equal(executionRoute.status, 404);
  });

  it("denies step-up challenge creation to read-only roles and untrusted origins", async () => {
    const auditorCookie = await devSession("auditor");
    const complianceCookie = await devSession("compliance-lead");
    const approval = demoRepository.approvals().find((item) => item.id === "APV-843910");
    assert.ok(approval);
    const path = `${baseUrl}/bff/api/approvals/${approval.id}/step-up/challenges`;
    const [deniedRole, deniedOrigin, staleDigest] = await Promise.all([
      fetch(path, {
        method: "POST",
        headers: {
          cookie: auditorCookie,
          "content-type": "application/json",
          origin
        },
        body: JSON.stringify({ commandDigest: approvalCommandDigest(approval) })
      }),
      fetch(path, {
        method: "POST",
        headers: {
          cookie: complianceCookie,
          "content-type": "application/json",
          origin: "https://untrusted.example"
        },
        body: JSON.stringify({ commandDigest: approvalCommandDigest(approval) })
      }),
      fetch(path, {
        method: "POST",
        headers: {
          cookie: complianceCookie,
          "content-type": "application/json",
          origin
        },
        body: JSON.stringify({ commandDigest: "0".repeat(64) })
      })
    ]);
    assert.equal(deniedRole.status, 403);
    assert.equal(deniedOrigin.status, 403);
    assert.equal(staleDigest.status, 409);
  });

  it("denies approval preview to read-only roles", async () => {
    const cookie = await devSession("auditor");
    const response = await fetch(`${baseUrl}/bff/api/approvals/APV-843910/preview`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({ commandDigest: "untrusted" })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "capability_denied" });
  });

  it("rejects untrusted, stale and unknown approval previews", async () => {
    const cookie = await devSession("compliance-lead");
    const headers = {
      cookie,
      "content-type": "application/json",
      origin
    };

    const untrusted = await fetch(`${baseUrl}/bff/api/approvals/APV-843910/preview`, {
      method: "POST",
      headers: { ...headers, origin: "https://untrusted.example" },
      body: JSON.stringify({ commandDigest: "untrusted" })
    });
    assert.equal(untrusted.status, 403);

    const stale = await fetch(`${baseUrl}/bff/api/approvals/APV-843910/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ commandDigest: "0".repeat(64) })
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: "approval_version_mismatch" });

    const unknown = await fetch(`${baseUrl}/bff/api/approvals/APV-999999/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ commandDigest: "0".repeat(64) })
    });
    assert.equal(unknown.status, 404);

    const malformed = await fetch(`${baseUrl}/bff/api/approvals/not-an-id/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ commandDigest: "0".repeat(64) })
    });
    assert.equal(malformed.status, 400);
  });

  it("keeps dev login limited to configured loopback origins", async () => {
    const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://untrusted.example"
      },
      body: JSON.stringify({ role: "compliance-lead" })
    });
    assert.equal(response.status, 404);
  });
});

describe("audit fail-closed boundary", () => {
  it("does not silently fall back when PostgreSQL mode was selected", () => {
    assert.throws(
      () => createBackofficeServer({
        host: "127.0.0.1",
        port: 0,
        allowedOrigins: [origin],
        allowDevLogin: false,
        sessionTtlSeconds: 900,
        audit: {
          storage: "postgresql",
          retentionDays: 2_555,
          databaseUrl: "postgresql://unused@127.0.0.1/unused"
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
      }),
      AuditUnavailableError
    );
  });

  it("returns unavailable instead of serving unverified audit state", async () => {
    const unavailable: AuditStore = {
      async snapshot() {
        throw new AuditUnavailableError();
      },
      async append() {
        throw new AuditUnavailableError();
      },
      async close() {}
    };
    const isolated = createBackofficeServer({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [origin],
      allowDevLogin: false,
      sessionTtlSeconds: 900,
      audit: {
        storage: "postgresql",
        retentionDays: 2_555,
        databaseUrl: "postgresql://unused@127.0.0.1/unused"
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
    }, unavailable);
    await new Promise<void>((resolve) => isolated.listen(0, "127.0.0.1", resolve));
    const address = isolated.address();
    if (!address || typeof address === "string") throw new Error("Test server address unavailable");
    const response = await fetch(`http://127.0.0.1:${address.port}/bff/healthz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "audit_integrity_unavailable" });
    await new Promise<void>((resolve, reject) => {
      isolated.close((error) => error ? reject(error) : resolve());
    });
  });
});

describe("OIDC browser transaction boundary", () => {
  it("rejects callbacks not bound to the browser that initiated login", async () => {
    const isolated = createBackofficeServer({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [origin],
      allowDevLogin: false,
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
      },
      oidc: {
        issuer: "https://identity.example.test",
        authorizationEndpoint: "https://identity.example.test/authorize",
        tokenEndpoint: "http://127.0.0.1:1/token",
        jwksUri: "https://identity.example.test/jwks",
        clientId: "solidchange-backoffice",
        clientSecret: "",
        redirectUri: `${origin}/bff/auth/callback`,
        roleClaim: "groups",
        roleMap: { compliance: "compliance-lead" }
      }
    });
    await new Promise<void>((resolve) => isolated.listen(0, "127.0.0.1", resolve));
    const address = isolated.address();
    if (!address || typeof address === "string") throw new Error("Test server address unavailable");
    const isolatedBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const login = await fetch(`${isolatedBaseUrl}/bff/auth/login`, {
        redirect: "manual"
      });
      assert.equal(login.status, 302);
      const location = login.headers.get("location");
      const setCookie = login.headers.get("set-cookie");
      assert.ok(location);
      assert.ok(setCookie);
      const state = new URL(location).searchParams.get("state");
      assert.ok(state);
      assert.match(
        setCookie,
        new RegExp(`^solidchange_bo_oidc_transaction=${state}; HttpOnly; SameSite=Lax;`)
      );

      const missingCookie = await fetch(
        `${isolatedBaseUrl}/bff/auth/callback?code=synthetic&state=${state}`
      );
      assert.equal(missingCookie.status, 400);
      assert.deepEqual(await missingCookie.json(), { error: "oidc_callback_rejected" });

      const mismatchedCookie = await fetch(
        `${isolatedBaseUrl}/bff/auth/callback?code=synthetic&state=${state}`,
        {
          headers: {
            cookie: "solidchange_bo_oidc_transaction=other-state"
          }
        }
      );
      assert.equal(mismatchedCookie.status, 400);
      assert.deepEqual(await mismatchedCookie.json(), { error: "oidc_callback_rejected" });
    } finally {
      await new Promise<void>((resolve, reject) => {
        isolated.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
