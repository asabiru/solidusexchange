import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { demoRepository } from "../data/demo.js";
import { checkStatuses } from "./checks.js";
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

describe("checks BFF", () => {
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
    const list = await fetch(`${baseUrl}/bff/api/checks`);
    assert.equal(list.status, 401);
    assert.deepEqual(await list.json(), { error: "operator_session_required" });

    const detail = await fetch(`${baseUrl}/bff/api/checks/CHK-771312`);
    assert.equal(detail.status, 401);
    assert.deepEqual(await detail.json(), { error: "operator_session_required" });
  });

  it("denies roles without the checks:read capability", async () => {
    const cookie = await devSession("fraud-investigator");
    const list = await fetch(`${baseUrl}/bff/api/checks`, { headers: { cookie } });
    assert.equal(list.status, 403);
    assert.deepEqual(await list.json(), { error: "capability_denied" });
    const detail = await fetch(`${baseUrl}/bff/api/checks/CHK-771312`, { headers: { cookie } });
    assert.equal(detail.status, 403);
    assert.deepEqual(await detail.json(), { error: "capability_denied" });
  });

  it("serves a signed read-only check queue to support and compliance roles", async () => {
    for (const role of ["compliance-lead", "support-l1", "aml-investigator", "auditor"]) {
      const cookie = await devSession(role);
      const response = await fetch(`${baseUrl}/bff/api/checks`, { headers: { cookie } });
      assert.equal(response.status, 200, role);
      const envelope = await response.json() as {
        resource: string;
        payload: {
          statuses: readonly string[];
          checks: readonly { id: string; status: string; amount: string; fee: string }[];
        };
      };
      assert.equal(envelope.resource, "checks");
      assert.deepEqual(envelope.payload.statuses, [...checkStatuses]);
      assert.equal(envelope.payload.checks.length, demoRepository.chatChecks().length);
      for (const check of envelope.payload.checks) {
        assert.match(check.id, /^CHK-\d{6}$/);
        assert.match(check.amount, /^\d+\.\d+$/);
        assert.match(check.fee, /^\d+\.\d+$/);
        assert.ok(checkStatuses.includes(check.status as (typeof checkStatuses)[number]));
      }
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("filters the queue by check status", async () => {
    const cookie = await devSession("support-l1");
    const claimed = await fetch(`${baseUrl}/bff/api/checks?status=claimed`, { headers: { cookie } });
    assert.equal(claimed.status, 200);
    const claimedPayload = (await claimed.json() as { payload: { checks: readonly { status: string }[] } }).payload;
    assert.ok(claimedPayload.checks.length > 0);
    for (const check of claimedPayload.checks) assert.equal(check.status, "claimed");

    const multi = await fetch(`${baseUrl}/bff/api/checks?status=created&status=expired`, { headers: { cookie } });
    assert.equal(multi.status, 200);
    const multiPayload = (await multi.json() as { payload: { checks: readonly { status: string }[] } }).payload;
    assert.ok(multiPayload.checks.length > 0);
    for (const check of multiPayload.checks) assert.ok(["created", "expired"].includes(check.status));
  });

  it("rejects unknown status filters", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/checks?status=frozen`, { headers: { cookie } });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_check_status" });
  });

  it("rejects cross-site fetches before serving check data", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/checks`, {
      headers: { cookie, "sec-fetch-site": "cross-site" }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "fetch_site_rejected" });
  });

  it("serves a per-check detail and appends an append-only audit event", async () => {
    const cookie = await devSession("auditor");
    const response = await fetch(`${baseUrl}/bff/api/checks/CHK-771298`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      resource: string;
      payload: {
        id: string;
        status: string;
        amount: string;
        asset: string;
        timeline: readonly { action: string }[];
        monitoring: readonly { status: string }[];
        evidenceItems: readonly { digest: string }[];
      };
    };
    assert.equal(envelope.resource, "check:CHK-771298");
    assert.equal(envelope.payload.id, "CHK-771298");
    assert.equal(envelope.payload.status, "waiting-recipient-kyc");
    assert.equal(envelope.payload.amount, "120.000000");
    assert.ok(envelope.payload.timeline.length >= 2);
    assert.ok(envelope.payload.monitoring.length > 0);
    assert.ok(envelope.payload.evidenceItems.length > 0);

    const audit = await fetch(`${baseUrl}/bff/api/audit`, { headers: { cookie } });
    const auditPayload = (await audit.json() as {
      payload: { events: readonly { action: string; resource: string; outcome: string; actor: string }[] };
    }).payload;
    const view = auditPayload.events.find((event) => event.action === "check.viewed");
    assert.ok(view);
    assert.equal(view.resource, "check:CHK-771298");
    assert.equal(view.outcome, "recorded");
    assert.equal(view.actor, "dev:auditor");
  });

  it("returns not_found for unknown or malformed check ids", async () => {
    const cookie = await devSession("compliance-lead");
    for (const id of ["CHK-000000", "bad%25E0%25A4%25A"]) {
      const response = await fetch(`${baseUrl}/bff/api/checks/${id}`, { headers: { cookie } });
      assert.equal(response.status, 404, id);
      assert.deepEqual(await response.json(), { error: "check_not_found" });
    }
  });

  it("accepts no mutation verbs on check routes", async () => {
    const cookie = await devSession("compliance-lead");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const list = await fetch(`${baseUrl}/bff/api/checks`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: "{}"
      });
      assert.equal(list.status, 405, method);
      assert.equal(list.headers.get("allow"), "GET");
      assert.deepEqual(await list.json(), { error: "method_not_allowed" });
      const detail = await fetch(`${baseUrl}/bff/api/checks/CHK-771312`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: "{}"
      });
      assert.equal(detail.status, 405, method);
      assert.deepEqual(await detail.json(), { error: "method_not_allowed" });
    }
    const queue = await fetch(`${baseUrl}/bff/api/checks`, { headers: { cookie } });
    const before = (await queue.json() as { payload: { checks: readonly unknown[] } }).payload.checks.length;
    assert.equal(before, demoRepository.chatChecks().length);
  });
});
