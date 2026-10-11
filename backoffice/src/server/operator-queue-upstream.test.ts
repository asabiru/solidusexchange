import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { type IncomingHttpHeaders, createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { ServerConfig } from "./config.js";
import {
  type CustomerApiClient,
  type CustomerApiOperatorQueue,
  createCustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";
import { deviceDigest } from "./device.js";
import { createBackofficeServer } from "./server.js";

const origin = "http://127.0.0.1:4173";
const testDeviceId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }
});

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [origin],
    allowDevLogin: true,
    sessionTtlSeconds: 900,
    audit: { storage: "memory", retentionDays: 30 },
    stepUp: {
      provider: "synthetic-dev",
      challengeTtlSeconds: 300,
      grantTtlSeconds: 60,
      maxAttempts: 3
    },
    signing: { backend: "ephemeral-dev", rotationSeconds: 900, retainedVerificationKeys: 2 },
    ...overrides
  };
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function devSession(baseUrl: string, deviceId?: string): Promise<string> {
  const cookie = deviceId ? `solidchange_bo_device=${deviceId}` : undefined;
  const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify({ role: "compliance-lead" })
  });
  assert.equal(response.status, 200);
  const sessionCookie = response.headers.get("set-cookie");
  assert.ok(sessionCookie);
  return sessionCookie.split(";")[0];
}

interface SeenCall {
  subject: string;
  deviceId: string;
  kind: string;
}

function stubClient(result: CustomerApiOperatorQueue | ((kind: string) => CustomerApiOperatorQueue)): { client: CustomerApiClient; seen: SeenCall[] } {
  const seen: SeenCall[] = [];
  const client: CustomerApiClient = {
    configured: true,
    operatorAdmin: async () => ({ status: "not-configured" }),
    operatorSubjects: async () => ({ status: "not-configured" }),
    operatorSubject: async () => ({ status: "not-configured" }),
    operatorQueue: async (subject: string, deviceId: string, kind: "kyc" | "aml" | "tickets"): Promise<CustomerApiOperatorQueue> => {
      seen.push({ subject, deviceId, kind });
      return typeof result === "function" ? result(kind) : result;
    }
  };
  return { client, seen };
}

function contractView(): CustomerApiOperatorQueue {
  return {
    status: "ok",
    view: {
      mode: "test",
      queue: {
        kind: "kyc",
        items: [
          {
            queue_id: "qky_00112233445566778899aabb",
            subject_id: "syn_cust_00112233445566778899aabb",
            display_name: "Alina Mironova",
            submitted_at: "2026-09-20T00:00:00.000Z",
            sla_due_at: "2026-09-23T00:00:00.000Z",
            state: "in_review",
            priority: "high",
            assignee: { subject: "syn_oper_0011223344556677" },
            age_ms: 1_000_000
          },
          {
            queue_id: "qky_bbccddee00112233445566",
            subject_id: "syn_cust_bbccddee00112233445566",
            display_name: "Igor Voronin",
            submitted_at: "2026-09-18T00:00:00.000Z",
            sla_due_at: "2026-09-21T00:00:00.000Z",
            state: "pending",
            priority: "normal",
            assignee: null,
            age_ms: 3_000_000
          }
        ],
        summary: {
          count: 2,
          by_state: { pending: 1, in_review: 1, escalated: 0 }
        },
        posting: "none"
      }
    }
  };
}

async function operatorQueueEnvelope(baseUrl: string, cookie: string, kind?: string) {
  const query = kind === undefined ? "" : `?kind=${kind}`;
  const response = await fetch(`${baseUrl}/bff/api/operator/queue${query}`, { headers: { cookie, origin } });
  const body = await response.json() as { resource?: string; payload?: Record<string, unknown>; error?: string };
  return { response, body };
}

function amlView(): CustomerApiOperatorQueue {
  return {
    status: "ok",
    view: {
      mode: "test",
      queue: {
        kind: "aml",
        items: [
          {
            queue_id: "qml_00112233445566778899aabb",
            subject_id: "syn_cust_00112233445566778899aabb",
            alert_type: "structuring",
            evidence_refs: ["evd_00112233445566778899aabb", "evd_bbccddee00112233445566"],
            sla_due_at: "2026-09-23T00:00:00.000Z",
            state: "in_review",
            priority: "high",
            assignee: { subject: "syn_oper_0011223344556677" },
            age_ms: 1_000_000
          }
        ],
        summary: {
          count: 1,
          by_state: { pending: 0, in_review: 1, escalated: 0 }
        },
        posting: "none"
      }
    }
  };
}

function ticketsView(): CustomerApiOperatorQueue {
  return {
    status: "ok",
    view: {
      mode: "test",
      queue: {
        kind: "tickets",
        items: [
          {
            queue_id: "qtick_00112233445566778899aabb",
            subject_id: "syn_cust_00112233445566778899aabb",
            category: "operation_problem",
            opened_at: "2026-09-19T00:00:00.000Z",
            state: "escalated",
            priority: "urgent",
            assignee: { subject: "syn_oper_0011223344556677" },
            age_ms: 2_000_000
          }
        ],
        summary: {
          count: 1,
          by_state: { open: 0, waiting: 0, escalated: 1 }
        },
        posting: "none"
      }
    }
  };
}

describe("operator queue BFF surface", () => {
  it("requires an operator session", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const response = await fetch(`${baseUrl}/bff/api/operator/queue`, { headers: { origin } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "operator_session_required" });
  });

  it("serves the local KYC roster as the work queue when the upstream is unconfigured", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const { response, body } = await operatorQueueEnvelope(baseUrl, cookie);
    assert.equal(response.status, 200);
    assert.equal(body.resource, "operator-queue:kyc");
    const payload = body.payload as {
      mode: string;
      queue: {
        kind: string;
        items: Record<string, unknown>[];
        summary: { count: number; byState: Record<string, number> };
        posting: string;
      };
    };
    assert.equal(payload.mode, "test");
    assert.equal(payload.queue.kind, "kyc");
    assert.equal(payload.queue.posting, "none");
    assert.ok(payload.queue.items.length >= 1);
    for (const item of payload.queue.items) {
      // The local roster has no upstream refs, SLA deadlines or staff
      // assignees — upstream-only fields stay null instead of being
      // invented; verified cases have left the queue.
      assert.equal(item.queueId, null);
      assert.equal(item.subjectId, null);
      assert.equal(typeof item.displayName, "string");
      assert.equal(typeof item.submittedAt, "string");
      assert.equal(item.slaDueAt, null);
      assert.match(String(item.state), /^(pending|in_review|escalated)$/u);
      assert.match(String(item.priority), /^(normal|high|urgent)$/u);
      assert.equal(item.assignee, null);
      assert.equal(item.ageMs, null);
    }
    assert.equal(payload.queue.summary.count, payload.queue.items.length);
    const tallied = { pending: 0, inReview: 0, escalated: 0 };
    for (const item of payload.queue.items) {
      const key = item.state === "in_review" ? "inReview" : (String(item.state) as keyof typeof tallied);
      tallied[key] += 1;
    }
    assert.deepEqual(payload.queue.summary.byState, tallied);
  });

  it("maps the upstream contract view onto the signed camelCase payload", async () => {
    const { client, seen } = stubClient(contractView());
    const baseUrl = await listen(createBackofficeServer(
      config({
        deviceBinding: { mode: "enforce", approvedDeviceDigests: [deviceDigest(testDeviceId)] }
      }),
      undefined,
      undefined,
      {},
      client
    ));
    const session = await devSession(baseUrl, testDeviceId);
    const { response, body } = await operatorQueueEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 200);
    assert.equal(body.resource, "operator-queue:kyc");
    assert.deepEqual(body.payload, {
      mode: "test",
      queue: {
        kind: "kyc",
        items: [
          {
            queueId: "qky_00112233445566778899aabb",
            subjectId: "syn_cust_00112233445566778899aabb",
            displayName: "Alina Mironova",
            submittedAt: "2026-09-20T00:00:00.000Z",
            slaDueAt: "2026-09-23T00:00:00.000Z",
            state: "in_review",
            priority: "high",
            assignee: { subject: "syn_oper_0011223344556677" },
            ageMs: 1_000_000
          },
          {
            queueId: "qky_bbccddee00112233445566",
            subjectId: "syn_cust_bbccddee00112233445566",
            displayName: "Igor Voronin",
            submittedAt: "2026-09-18T00:00:00.000Z",
            slaDueAt: "2026-09-21T00:00:00.000Z",
            state: "pending",
            priority: "normal",
            assignee: null,
            ageMs: 3_000_000
          }
        ],
        summary: {
          count: 2,
          byState: { pending: 1, inReview: 1, escalated: 0 }
        },
        posting: "none"
      }
    });
    // The session's bound workstation device is what propagates upstream.
    assert.deepEqual(seen, [{ subject: "dev:compliance-lead", deviceId: testDeviceId, kind: "kyc" }]);
  });

  it("passes the kind query through to the upstream read and maps each projection", async () => {
    const { client, seen } = stubClient((kind) =>
      kind === "aml" ? amlView() : kind === "tickets" ? ticketsView() : contractView()
    );
    const baseUrl = await listen(createBackofficeServer(config(), undefined, undefined, {}, client));
    const session = await devSession(baseUrl);
    const cookie = `${session}; solidchange_bo_device=${testDeviceId}`;

    const aml = await operatorQueueEnvelope(baseUrl, cookie, "aml");
    assert.equal(aml.response.status, 200);
    assert.deepEqual(aml.body.payload, {
      mode: "test",
      queue: {
        kind: "aml",
        items: [
          {
            queueId: "qml_00112233445566778899aabb",
            subjectId: "syn_cust_00112233445566778899aabb",
            alertType: "structuring",
            evidenceRefs: ["evd_00112233445566778899aabb", "evd_bbccddee00112233445566"],
            slaDueAt: "2026-09-23T00:00:00.000Z",
            state: "in_review",
            priority: "high",
            assignee: { subject: "syn_oper_0011223344556677" },
            ageMs: 1_000_000
          }
        ],
        summary: { count: 1, byState: { pending: 0, inReview: 1, escalated: 0 } },
        posting: "none"
      }
    });

    const tickets = await operatorQueueEnvelope(baseUrl, cookie, "tickets");
    assert.equal(tickets.response.status, 200);
    assert.deepEqual(tickets.body.payload, {
      mode: "test",
      queue: {
        kind: "tickets",
        items: [
          {
            queueId: "qtick_00112233445566778899aabb",
            subjectId: "syn_cust_00112233445566778899aabb",
            category: "operation_problem",
            openedAt: "2026-09-19T00:00:00.000Z",
            state: "escalated",
            priority: "urgent",
            assignee: { subject: "syn_oper_0011223344556677" },
            ageMs: 2_000_000
          }
        ],
        summary: { count: 1, byState: { open: 0, waiting: 0, escalated: 1 } },
        posting: "none"
      }
    });

    // The explicit default and the absent query hit the same upstream read.
    const explicit = await operatorQueueEnvelope(baseUrl, cookie, "kyc");
    assert.equal(explicit.response.status, 200);
    const explicitQueue = (explicit.body.payload as { queue: { kind: string; items: unknown[] } }).queue;
    assert.equal(explicitQueue.kind, "kyc");
    assert.equal(explicitQueue.items.length, 2);
    assert.deepEqual(
      seen.map((call) => call.kind),
      ["aml", "tickets", "kyc"]
    );
  });

  it("rejects a kind outside the enum before any upstream call", async () => {
    const { client, seen } = stubClient(contractView());
    const baseUrl = await listen(createBackofficeServer(config(), undefined, undefined, {}, client));
    const session = await devSession(baseUrl);
    const cookie = `${session}; solidchange_bo_device=${testDeviceId}`;
    for (const kind of ["fraud", "KYC", "", "kyc,aml"]) {
      const { response, body } = await operatorQueueEnvelope(baseUrl, cookie, kind);
      assert.equal(response.status, 400, kind);
      assert.deepEqual(body, { error: "operator_queue_kind_invalid" });
    }
    assert.equal(seen.length, 0);
  });

  it("degrades each kind to its matching local roster when the upstream is unconfigured", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);

    const aml = await operatorQueueEnvelope(baseUrl, cookie, "aml");
    assert.equal(aml.response.status, 200);
    const amlPayload = aml.body.payload as { queue: { kind: string; items: Record<string, unknown>[]; summary: { count: number; byState: Record<string, number> } } };
    assert.equal(amlPayload.queue.kind, "aml");
    assert.ok(amlPayload.queue.items.length >= 1);
    for (const item of amlPayload.queue.items) {
      assert.equal(item.queueId, null);
      assert.equal(item.subjectId, null);
      assert.equal(item.alertType, null);
      assert.deepEqual(item.evidenceRefs, []);
      assert.equal(item.slaDueAt, null);
      assert.match(String(item.state), /^(pending|in_review|escalated)$/u);
      assert.equal(item.assignee, null);
      assert.equal(item.ageMs, null);
    }
    assert.equal(amlPayload.queue.summary.count, amlPayload.queue.items.length);

    const tickets = await operatorQueueEnvelope(baseUrl, cookie, "tickets");
    assert.equal(tickets.response.status, 200);
    const ticketPayload = tickets.body.payload as { queue: { kind: string; items: Record<string, unknown>[]; summary: { count: number; byState: Record<string, number> } } };
    assert.equal(ticketPayload.queue.kind, "tickets");
    for (const item of ticketPayload.queue.items) {
      assert.equal(item.queueId, null);
      assert.equal(item.subjectId, null);
      assert.equal(item.category, null);
      assert.equal(typeof item.openedAt, "string");
      assert.match(String(item.state), /^(open|waiting|escalated)$/u);
      assert.equal(item.assignee, null);
      assert.equal(item.ageMs, null);
    }
    assert.equal(ticketPayload.queue.summary.count, ticketPayload.queue.items.length);
    const tallied: Record<string, number> = {};
    for (const item of ticketPayload.queue.items) {
      const key = String(item.state);
      tallied[key] = (tallied[key] ?? 0) + 1;
    }
    assert.deepEqual(ticketPayload.queue.summary.byState, tallied);
  });

  it("rejects absent or malformed device identities before any upstream call", async () => {
    const { client, seen } = stubClient(contractView());
    const baseUrl = await listen(createBackofficeServer(config(), undefined, undefined, {}, client));
    const session = await devSession(baseUrl);
    for (const deviceCookie of [
      "",
      "solidchange_bo_device=not-a-device",
      "solidchange_bo_device=F47AC10B-58CC-4372-A567-0E02B2C3D479",
      "solidchange_bo_device=f47ac10b-58cc-3372-a567-0e02b2c3d479"
    ]) {
      const cookie = deviceCookie ? `${session}; ${deviceCookie}` : session;
      const { response, body } = await operatorQueueEnvelope(baseUrl, cookie);
      assert.equal(response.status, 403, deviceCookie || "absent");
      assert.deepEqual(body, { error: "device_required" });
    }
    assert.equal(seen.length, 0);
  });

  it("maps any non-ok upstream outcome to operator_queue_unavailable", async () => {
    const { client } = stubClient({ status: "unavailable" });
    const baseUrl = await listen(createBackofficeServer(config(), undefined, undefined, {}, client));
    const session = await devSession(baseUrl);
    const { response, body } = await operatorQueueEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(body, { error: "operator_queue_unavailable" });
  });

  it("fails closed to 503 on upstream contract drift end-to-end", async () => {
    const key = randomBytes(32).toString("hex");
    const drifted = {
      mode: "test",
      queue: {
        kind: "kyc",
        items: [{
          queue_id: "qky_00112233445566778899aabb",
          subject_id: "syn_oper_00000001",
          display_name: "Alina Mironova",
          submitted_at: "2026-09-20T00:00:00.000Z",
          sla_due_at: "2026-09-23T00:00:00.000Z",
          state: "in_review",
          priority: "high",
          assignee: { subject: "syn_oper_0011223344556677" },
          age_ms: 1_000_000
        }],
        summary: {
          count: 1,
          by_state: { pending: 0, in_review: 1, escalated: 0 }
        },
        posting: "none"
      }
    };
    const seen: IncomingHttpHeaders[] = [];
    const upstream = createServer((request, response) => {
      seen.push(request.headers);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(drifted));
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const client = createCustomerApiClient({ baseUrl: upstreamUrl, devTokenKey: key });
    const baseUrl = await listen(createBackofficeServer(config(), undefined, undefined, {}, client));
    const session = await devSession(baseUrl);
    const { response, body } = await operatorQueueEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(body, { error: "operator_queue_unavailable" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]["x-device-id"], testDeviceId);
    assert.match(
      String(seen[0].authorization),
      new RegExp(`^Bearer sodev1\\.${customerApiSubject("dev:compliance-lead")}\\.[0-9]{10}\\.[0-9a-f]{64}$`)
    );
  });
});
