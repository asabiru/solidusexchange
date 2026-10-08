import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { demoRepository } from "../data/demo.js";
import { withdrawalStatuses } from "./withdrawals.js";
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

describe("withdrawal intents BFF", () => {
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

  it("requires an operator session", async () => {
    const list = await fetch(`${baseUrl}/bff/api/withdrawals`);
    assert.equal(list.status, 401);
    assert.deepEqual(await list.json(), { error: "operator_session_required" });

    const detail = await fetch(`${baseUrl}/bff/api/withdrawals/WDR-991804`);
    assert.equal(detail.status, 401);
    assert.deepEqual(await detail.json(), { error: "operator_session_required" });
  });

  it("denies roles without the custody:read capability", async () => {
    for (const role of ["support-l1", "fraud-investigator"]) {
      const cookie = await devSession(role);
      const list = await fetch(`${baseUrl}/bff/api/withdrawals`, { headers: { cookie } });
      assert.equal(list.status, 403, role);
      assert.deepEqual(await list.json(), { error: "capability_denied" });
      const detail = await fetch(`${baseUrl}/bff/api/withdrawals/WDR-991804`, { headers: { cookie } });
      assert.equal(detail.status, 403, role);
      assert.deepEqual(await detail.json(), { error: "capability_denied" });
    }
  });

  it("serves a signed read-only withdrawal queue to compliance, aml and auditor roles", async () => {
    for (const role of ["compliance-lead", "aml-investigator", "auditor"]) {
      const cookie = await devSession(role);
      const response = await fetch(`${baseUrl}/bff/api/withdrawals`, { headers: { cookie } });
      assert.equal(response.status, 200, role);
      const envelope = await response.json() as {
        resource: string;
        payload: {
          statuses: readonly string[];
          intents: readonly {
            id: string;
            status: string;
            amount: string;
            asset: string;
            network: string;
            policyVersion: string;
            executionAuthority: boolean;
            keyMaterialPresent: boolean;
          }[];
        };
      };
      assert.equal(envelope.resource, "withdrawals");
      assert.deepEqual(envelope.payload.statuses, [...withdrawalStatuses]);
      assert.equal(envelope.payload.intents.length, demoRepository.withdrawalIntents().length);
      for (const intent of envelope.payload.intents) {
        assert.match(intent.id, /^WDR-\d{6}$/);
        assert.match(intent.amount, /^\d+\.\d+$/);
        assert.match(intent.network, /_TESTNET$/);
        assert.equal(intent.policyVersion, "custody-dev-v1");
        assert.equal(intent.executionAuthority, false);
        assert.equal(intent.keyMaterialPresent, false);
        assert.ok(withdrawalStatuses.includes(intent.status as (typeof withdrawalStatuses)[number]));
      }
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("filters the queue by intent status", async () => {
    const cookie = await devSession("compliance-lead");
    const pending = await fetch(`${baseUrl}/bff/api/withdrawals?status=pending-approval`, { headers: { cookie } });
    assert.equal(pending.status, 200);
    const pendingPayload = (await pending.json() as { payload: { intents: readonly { status: string }[] } }).payload;
    assert.ok(pendingPayload.intents.length > 0);
    for (const intent of pendingPayload.intents) assert.equal(intent.status, "pending-approval");

    const multi = await fetch(`${baseUrl}/bff/api/withdrawals?status=draft&status=cancelled`, { headers: { cookie } });
    assert.equal(multi.status, 200);
    const multiPayload = (await multi.json() as { payload: { intents: readonly { status: string }[] } }).payload;
    assert.ok(multiPayload.intents.length > 0);
    for (const intent of multiPayload.intents) assert.ok(["draft", "cancelled"].includes(intent.status));
  });

  it("rejects unknown status filters", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/withdrawals?status=frozen`, { headers: { cookie } });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_withdrawal_status" });
  });

  it("rejects cross-site fetches before serving withdrawal data", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/withdrawals`, {
      headers: { cookie, "sec-fetch-site": "cross-site" }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "fetch_site_rejected" });
  });

  it("serves a per-intent detail and appends an append-only audit event", async () => {
    const cookie = await devSession("auditor");
    const response = await fetch(`${baseUrl}/bff/api/withdrawals/WDR-991804`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      resource: string;
      payload: {
        id: string;
        status: string;
        amount: string;
        asset: string;
        linkedApprovalId: string;
        timeline: readonly { action: string }[];
        screening: readonly { status: string }[];
        approvalSteps: readonly { role: string; decision: string }[];
        evidenceItems: readonly { digest: string }[];
      };
    };
    assert.equal(envelope.resource, "withdrawal:WDR-991804");
    assert.equal(envelope.payload.id, "WDR-991804");
    assert.equal(envelope.payload.status, "pending-approval");
    assert.equal(envelope.payload.amount, "2450.000000");
    assert.equal(envelope.payload.linkedApprovalId, "APV-843921");
    assert.ok(envelope.payload.timeline.length >= 2);
    assert.ok(envelope.payload.screening.length > 0);
    assert.equal(envelope.payload.approvalSteps.length, 2);
    assert.ok(envelope.payload.approvalSteps.some((step) => step.decision === "pending"));
    assert.ok(envelope.payload.evidenceItems.length > 0);

    const audit = await fetch(`${baseUrl}/bff/api/audit`, { headers: { cookie } });
    const auditPayload = (await audit.json() as {
      payload: { events: readonly { action: string; resource: string; outcome: string; actor: string }[] };
    }).payload;
    const view = auditPayload.events.find((event) => event.action === "withdrawal.viewed");
    assert.ok(view);
    assert.equal(view.resource, "withdrawal:WDR-991804");
    assert.equal(view.outcome, "recorded");
    assert.equal(view.actor, "dev:auditor");
  });

  it("returns not_found for unknown or malformed intent ids", async () => {
    const cookie = await devSession("compliance-lead");
    for (const id of ["WDR-000000", "bad%25E0%25A4%25A"]) {
      const response = await fetch(`${baseUrl}/bff/api/withdrawals/${id}`, { headers: { cookie } });
      assert.equal(response.status, 404, id);
      assert.deepEqual(await response.json(), { error: "withdrawal_not_found" });
    }
  });

  it("accepts no mutation verbs on withdrawal routes", async () => {
    const cookie = await devSession("compliance-lead");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const list = await fetch(`${baseUrl}/bff/api/withdrawals`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: "{}"
      });
      assert.equal(list.status, 405, method);
      assert.equal(list.headers.get("allow"), "GET");
      assert.deepEqual(await list.json(), { error: "method_not_allowed" });
      const detail = await fetch(`${baseUrl}/bff/api/withdrawals/WDR-991804`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: "{}"
      });
      assert.equal(detail.status, 405, method);
      assert.deepEqual(await detail.json(), { error: "method_not_allowed" });
    }
    const queue = await fetch(`${baseUrl}/bff/api/withdrawals`, { headers: { cookie } });
    const before = (await queue.json() as { payload: { intents: readonly unknown[] } }).payload.intents.length;
    assert.equal(before, demoRepository.withdrawalIntents().length);
  });
});
