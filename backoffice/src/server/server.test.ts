import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { ApprovalRow } from "../data/demo.js";
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
      sessionTtlSeconds: 900
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
      signature: string;
      resource: string;
      payload: { metrics: readonly unknown[]; queues: readonly unknown[] };
    };
    assert.match(envelope.keyId, /^[a-f0-9]{16}$/);
    assert.ok(envelope.signature);
    assert.equal(envelope.resource, "dashboard");
    assert.equal(envelope.payload.metrics.length, 4);
    assert.equal(envelope.payload.queues.length, 4);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("enforces capabilities from the server session", async () => {
    const cookie = await devSession("support-l1");
    const allowed = await fetch(`${baseUrl}/bff/api/customers`, {
      headers: { cookie }
    });
    const denied = await fetch(`${baseUrl}/bff/api/approvals`, {
      headers: { cookie }
    });
    assert.equal(allowed.status, 200);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "capability_denied" });
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
        events: readonly { sequence: number; hash: string; previousHash: string }[];
        chain: { verified: boolean; length: number; headHash: string };
      };
    };
    assert.equal(envelope.resource, "audit");
    assert.equal(envelope.payload.chain.verified, true);
    assert.equal(envelope.payload.chain.length, 4);
    assert.equal(envelope.payload.events[0].previousHash, "0".repeat(64));
    assert.equal(envelope.payload.chain.headHash, envelope.payload.events.at(-1)?.hash);
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
      };
    };
    assert.equal(envelope.resource, `approval-preview:${approval.id}`);
    assert.equal(envelope.payload.policy.independentApprover, true);
    assert.equal(envelope.payload.policy.stepUpMfa, "required");
    assert.equal(envelope.payload.policy.commandClient, "absent");
    assert.equal(envelope.payload.policy.executable, false);
    assert.ok(envelope.payload.policy.blockers.includes("command_client_absent"));
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
