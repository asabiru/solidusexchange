import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { demoRepository } from "../data/demo.js";
import { createBackofficeServer } from "./server.js";
import { supportTicketStatuses } from "./support.js";

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

describe("support BFF", () => {
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
    const list = await fetch(`${baseUrl}/bff/api/support`);
    assert.equal(list.status, 401);
    assert.deepEqual(await list.json(), { error: "operator_session_required" });

    const detail = await fetch(`${baseUrl}/bff/api/support/SUP-384120`);
    assert.equal(detail.status, 401);
    assert.deepEqual(await detail.json(), { error: "operator_session_required" });
  });

  it("denies roles without the support:read capability", async () => {
    const cookie = await devSession("fraud-investigator");
    const list = await fetch(`${baseUrl}/bff/api/support`, { headers: { cookie } });
    assert.equal(list.status, 403);
    assert.deepEqual(await list.json(), { error: "capability_denied" });
    const detail = await fetch(`${baseUrl}/bff/api/support/SUP-384120`, { headers: { cookie } });
    assert.equal(detail.status, 403);
    assert.deepEqual(await detail.json(), { error: "capability_denied" });
  });

  it("serves a signed read-only ticket queue to support and compliance roles", async () => {
    for (const role of ["compliance-lead", "support-l1", "aml-investigator", "auditor"]) {
      const cookie = await devSession(role);
      const response = await fetch(`${baseUrl}/bff/api/support`, { headers: { cookie } });
      assert.equal(response.status, 200, role);
      const envelope = await response.json() as {
        resource: string;
        payload: {
          statuses: readonly string[];
          tickets: readonly { id: string; subject: string; status: string; channel: string; disputedAmount?: string }[];
        };
      };
      assert.equal(envelope.resource, "support");
      assert.deepEqual(envelope.payload.statuses, [...supportTicketStatuses]);
      assert.equal(envelope.payload.tickets.length, demoRepository.supportTickets().length);
      for (const ticket of envelope.payload.tickets) {
        assert.match(ticket.id, /^SUP-\d{6}$/);
        assert.match(ticket.subject, /^sim-/);
        assert.ok(["miniapp", "telegram"].includes(ticket.channel));
        if (ticket.disputedAmount) assert.match(ticket.disputedAmount, /^\d+\.\d+$/);
        assert.ok(supportTicketStatuses.includes(ticket.status as (typeof supportTicketStatuses)[number]));
      }
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("filters the queue by ticket status", async () => {
    const cookie = await devSession("support-l1");
    const escalated = await fetch(`${baseUrl}/bff/api/support?status=escalated`, { headers: { cookie } });
    assert.equal(escalated.status, 200);
    const escalatedPayload = (await escalated.json() as { payload: { tickets: readonly { status: string }[] } }).payload;
    assert.ok(escalatedPayload.tickets.length > 0);
    for (const ticket of escalatedPayload.tickets) assert.equal(ticket.status, "escalated");

    const multi = await fetch(`${baseUrl}/bff/api/support?status=open&status=resolved`, { headers: { cookie } });
    assert.equal(multi.status, 200);
    const multiPayload = (await multi.json() as { payload: { tickets: readonly { status: string }[] } }).payload;
    assert.ok(multiPayload.tickets.length > 0);
    for (const ticket of multiPayload.tickets) assert.ok(["open", "resolved"].includes(ticket.status));
  });

  it("rejects unknown status filters", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/support?status=frozen`, { headers: { cookie } });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_support_status" });
  });

  it("rejects cross-site fetches before serving ticket data", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/support`, {
      headers: { cookie, "sec-fetch-site": "cross-site" }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "fetch_site_rejected" });
  });

  it("serves a per-ticket detail and appends an append-only audit event", async () => {
    const cookie = await devSession("auditor");
    const response = await fetch(`${baseUrl}/bff/api/support/SUP-384120`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      resource: string;
      payload: {
        id: string;
        status: string;
        linkedCheckId?: string;
        disputedAmount?: string;
        asset?: string;
        messages: readonly { author: string }[];
        internalNotes: readonly { author: string }[];
      };
    };
    assert.equal(envelope.resource, "support:SUP-384120");
    assert.equal(envelope.payload.id, "SUP-384120");
    assert.equal(envelope.payload.status, "escalated");
    assert.equal(envelope.payload.linkedCheckId, "CHK-771298");
    assert.equal(envelope.payload.disputedAmount, "120.000000");
    assert.equal(envelope.payload.asset, "USDT");
    assert.ok(envelope.payload.messages.length >= 2);
    assert.ok(envelope.payload.internalNotes.length > 0);

    const audit = await fetch(`${baseUrl}/bff/api/audit`, { headers: { cookie } });
    const auditPayload = (await audit.json() as {
      payload: { events: readonly { action: string; resource: string; outcome: string; actor: string }[] };
    }).payload;
    const view = auditPayload.events.find((event) => event.action === "support.viewed");
    assert.ok(view);
    assert.equal(view.resource, "support:SUP-384120");
    assert.equal(view.outcome, "recorded");
    assert.equal(view.actor, "dev:auditor");
  });

  it("returns not_found for unknown or malformed ticket ids", async () => {
    const cookie = await devSession("compliance-lead");
    for (const id of ["SUP-000000", "bad%25E0%25A4%25A"]) {
      const response = await fetch(`${baseUrl}/bff/api/support/${id}`, { headers: { cookie } });
      assert.equal(response.status, 404, id);
      assert.deepEqual(await response.json(), { error: "ticket_not_found" });
    }
  });

  it("accepts no mutation verbs on support routes", async () => {
    const cookie = await devSession("compliance-lead");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const list = await fetch(`${baseUrl}/bff/api/support`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: "{}"
      });
      assert.equal(list.status, 405, method);
      assert.equal(list.headers.get("allow"), "GET");
      assert.deepEqual(await list.json(), { error: "method_not_allowed" });
      const detail = await fetch(`${baseUrl}/bff/api/support/SUP-384120`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: "{}"
      });
      assert.equal(detail.status, 405, method);
      assert.deepEqual(await detail.json(), { error: "method_not_allowed" });
    }
    const queue = await fetch(`${baseUrl}/bff/api/support`, { headers: { cookie } });
    const before = (await queue.json() as { payload: { tickets: readonly unknown[] } }).payload.tickets.length;
    assert.equal(before, demoRepository.supportTickets().length);
  });
});
