import assert from "node:assert/strict";
import type { Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import { demoRepository } from "../data/demo.js";
import type { ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiOperatorQueue } from "./customer-api-client.js";
import { deviceDigest } from "./device.js";
import { listReports } from "./reports.js";
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
  const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(deviceId ? { cookie: `solidchange_bo_device=${deviceId}` } : {})
    },
    body: JSON.stringify({ role: "compliance-lead" })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0];
}

const queueStub: CustomerApiClient = {
  configured: true,
  operatorAdmin: async () => ({ status: "not-configured" }),
  operatorSubjects: async () => ({ status: "not-configured" }),
  operatorSubject: async () => ({ status: "not-configured" }),
  operatorQueue: async (): Promise<CustomerApiOperatorQueue> => ({ status: "unavailable" }),
  operatorQueueItem: async () => ({ status: "not-configured" }),
  operatorAudit: async () => ({ status: "not-configured" })
};

const checkId = demoRepository.chatChecks()[0].id;
const ticketId = demoRepository.supportTickets()[0].id;
const withdrawalId = demoRepository.withdrawalIntents()[0].id;
const customerId = demoRepository.customers()[0].id;
const reportId = listReports(new Date(0).toISOString()).reports[0].id;
const subjectRef = "syn-demo-subject";

// Every registered GET view — literals plus one instantiated member path —
// shares the two dispatch contracts this audit pins: a non-GET method
// answers 405 + Allow: GET, and any undeclared query key answers 400.
const literalGetViews = [
  "/bff/healthz",
  "/bff/auth/device",
  "/bff/auth/status",
  "/bff/api/signing-key",
  "/bff/api/signing-keys",
  "/bff/api/session",
  "/bff/api/operator/admin",
  "/bff/api/operator/subjects",
  "/bff/api/operator/queue",
  "/bff/api/operator/audit",
  "/bff/api/dashboard",
  "/bff/api/customers",
  "/bff/api/checks",
  "/bff/api/support",
  "/bff/api/withdrawals",
  "/bff/api/kyc",
  "/bff/api/aml",
  "/bff/api/investigations",
  "/bff/api/fraud-alerts",
  "/bff/api/approvals",
  "/bff/api/audit",
  "/bff/api/audit/export",
  "/bff/api/reports"
];
const memberGetViews = [
  `/bff/api/operator/subjects/${customerId}`,
  "/bff/api/operator/queue/kyc/qky_00112233445566778899aabb",
  `/bff/api/checks/${checkId}`,
  `/bff/api/support/${ticketId}`,
  `/bff/api/withdrawals/${withdrawalId}`,
  `/bff/api/subjects/${subjectRef}/timeline`,
  `/bff/api/reports/${reportId}`,
  `/bff/api/reports/${reportId}/export`
];
const postOnlyPaths = [
  "/bff/auth/dev-session",
  "/bff/auth/logout",
  "/bff/api/approvals/APV-000001/step-up/challenges",
  "/bff/api/approvals/APV-000001/step-up/challenges/CHALLENGE_0123456789abcdef0123456789abcdef/verify",
  "/bff/api/approvals/APV-000001/preview"
];

describe("wave-70 route-table audit: malformed member encodings", () => {
  it("answers the uniform not-found, not a 500, on malformed percent-encoding", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const malformed of ["%", "%zz", "%E0%A4", "%u0041", "%%"]) {
      for (const path of [
        `/bff/api/operator/subjects/${malformed}`,
        `/bff/api/operator/queue/${malformed}/item`,
        `/bff/api/operator/queue/kyc/${malformed}`
      ]) {
        const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
        assert.equal(response.status, 404, path);
        const body = await response.json() as { error: string };
        assert.match(body.error, /operator_(subject|queue_item)_not_found/);
      }
    }
  });

  it("keeps the sibling member arms' established 404 shape on the same input", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const [path, error] of [
      ["/bff/api/checks/%", "check_not_found"],
      ["/bff/api/support/%", "ticket_not_found"],
      ["/bff/api/withdrawals/%", "withdrawal_not_found"],
      ["/bff/api/subjects/%/timeline", "subject_not_found"],
      ["/bff/api/reports/%", "report_not_found"],
      ["/bff/api/reports/%/export", "report_not_found"]
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      assert.equal(response.status, 404, path);
      assert.deepEqual(await response.json(), { error });
    }
  });
});

describe("wave-70 route-table audit: operator queue strict allowlist", () => {
  it("rejects a repeated kind parameter like the upstream strict allowlist", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const query of [
      "?kind=kyc&kind=aml",
      "?kind=kyc&kind=kyc",
      "?kind=aml&kind=",
      "?kind=&kind=kyc"
    ]) {
      const response = await fetch(`${baseUrl}/bff/api/operator/queue${query}`, { headers: { cookie } });
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: "operator_queue_query_invalid" });
    }
  });

  it("rejects unknown query keys and keeps the declared kind contract", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const query of ["?kind=kyc&debug=1", "?kind=aml&cursor=auc_0011223344556677", "?debug=1"]) {
      const response = await fetch(`${baseUrl}/bff/api/operator/queue${query}`, { headers: { cookie } });
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
    }
    for (const query of ["?kind=", "?kind=fraud", "?kind=KYC", "?kind=kyc,aml"]) {
      const response = await fetch(`${baseUrl}/bff/api/operator/queue${query}`, { headers: { cookie } });
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: "operator_queue_kind_invalid" });
    }
    for (const query of ["", "?", "?kind=aml", "?kind=tickets", "?kind=kyc"]) {
      const response = await fetch(`${baseUrl}/bff/api/operator/queue${query}`, { headers: { cookie } });
      assert.equal(response.status, 200, query);
    }
  });

  it("fails closed before any upstream call on configured stacks too", async () => {
    const seen: string[] = [];
    const client: CustomerApiClient = {
      ...queueStub,
      operatorQueue: async (_subject: string, _deviceId: string, kind: "kyc" | "aml" | "tickets") => {
        seen.push(kind);
        return { status: "unavailable" };
      }
    };
    const baseUrl = await listen(createBackofficeServer(
      config({ deviceBinding: { mode: "enforce", approvedDeviceDigests: [deviceDigest(testDeviceId)] } }),
      undefined,
      undefined,
      {},
      client
    ));
    const session = await devSession(baseUrl, testDeviceId);
    const cookie = `${session}; solidchange_bo_device=${testDeviceId}`;
    for (const query of ["?kind=kyc&kind=aml", "?kind=kyc&debug=1", "?kind=fraud"]) {
      const response = await fetch(`${baseUrl}/bff/api/operator/queue${query}`, { headers: { cookie } });
      assert.equal(response.status, 400, query);
    }
    assert.deepEqual(seen, []);
  });
});

describe("wave-70 route-table audit: uniform query rejection", () => {
  it("answers 400 on any undeclared query key across every authed GET view", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const view of [...literalGetViews, ...memberGetViews]) {
      const response = await fetch(`${baseUrl}${view}?audit=w70`, { headers: { cookie } });
      assert.equal(response.status, 400, view);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
    }
  });

  it("resolves the session before the query pin: unauthenticated stays 401", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    for (const view of ["/bff/api/dashboard", "/bff/api/customers", "/bff/api/operator/queue"]) {
      const response = await fetch(`${baseUrl}${view}?audit=w70`);
      assert.equal(response.status, 401, view);
      assert.deepEqual(await response.json(), { error: "operator_session_required" });
    }
  });

  it("answers 400 on the public GET views that answer before the session tier", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    for (const view of ["/bff/healthz", "/bff/auth/status", "/bff/auth/device", "/bff/api/signing-key", "/bff/api/signing-keys"]) {
      const response = await fetch(`${baseUrl}${view}?audit=w70`);
      assert.equal(response.status, 400, view);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
    }
    // The OIDC-gated login arm keeps its hidden-route posture: unconfigured,
    // a query-bearing request answers 404 like the bare one, never 400.
    assert.equal((await fetch(`${baseUrl}/bff/auth/login?audit=w70`)).status, 404);
  });

  it("keeps serving the declared query contracts", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const query of ["?status=created", "?status=created&status=expired"]) {
      const response = await fetch(`${baseUrl}/bff/api/checks${query}`, { headers: { cookie } });
      assert.equal(response.status, 200, query);
    }
    const audit = await fetch(`${baseUrl}/bff/api/operator/audit?cursor=auc_0011223344556677`, { headers: { cookie } });
    // The local feed mints no page tokens: a well-formed declared cursor is
    // the uniform not-found, proving the parameter was read, not dropped.
    assert.equal(audit.status, 404);
    assert.deepEqual(await audit.json(), { error: "operator_audit_not_found" });
  });
});

describe("wave-70 route-table audit: uniform method contract", () => {
  it("answers 405 + Allow: GET on a non-GET method for every GET view", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const view of [...literalGetViews, ...memberGetViews]) {
      for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
        const response = await fetch(`${baseUrl}${view}`, { method, headers: { cookie } });
        assert.equal(response.status, 405, `${method} ${view}`);
        assert.equal(response.headers.get("allow"), "GET", `${method} ${view}`);
      }
    }
  });

  it("answers 404 on absent and POST-only paths like a never-registered route", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const path of postOnlyPaths) {
      for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
        const response = await fetch(`${baseUrl}${path}`, { method, headers: { cookie } });
        assert.equal(response.status, 404, `${method} ${path}`);
      }
    }
    for (const path of ["/bff/api/never-registered", "/bff/api/operator/subjects/x/extra", "/bff/api/reports/x/extra"]) {
      const response = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers: { cookie } });
      assert.equal(response.status, 404, path);
    }
    // The OIDC-gated login arms keep the hidden-route posture when
    // unconfigured: a method mismatch answers 404, never a revealing 405.
    for (const method of ["POST", "PUT", "OPTIONS"]) {
      assert.equal((await fetch(`${baseUrl}/bff/auth/login`, { method })).status, 404, method);
      assert.equal((await fetch(`${baseUrl}/bff/auth/callback`, { method })).status, 404, method);
    }
  });

  it("keeps the metrics scrape's own ordering: disabled answers 404 before the method check", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    for (const method of ["GET", "POST", "PUT"]) {
      assert.equal((await fetch(`${baseUrl}/bff/metrics`, { method })).status, 404, method);
    }
  });
});

describe("wave-70 route-table audit: spelling and normalization pins", () => {
  it("answers 404 on trailing-slash, double-slash and case variants", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    for (const path of [
      "/bff/api/customers/",
      "/bff/api//customers",
      "/BFF/api/customers",
      "/bff/API/customers",
      "/bff/api/checks/",
      "/bff/api/operator/subjects/"
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      assert.equal(response.status, 404, path);
    }
  });
});
