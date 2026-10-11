import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it, mock } from "node:test";
import {
  createCustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";
import { parseOperatorQueueView, parseOperatorSubjectView } from "../data/operator.js";

/**
 * Wave-60 adversarial audit of the backoffice upstream adapter layer: the
 * server-side customer-api client (unsigned contract reads), the BFF signed
 * envelope surface (`src/data/client.ts`) and the strict per-kind adapters
 * (`src/data/operator.ts`). Every class of hostile or out-of-contract input
 * is pinned to fail closed — malformed, replayed or drifted data must never
 * reach a view.
 */

(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

const dataClient = await import("../data/client.js");
const { ApiError } = dataClient;

const testDeviceId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const devTokenKey = "0".repeat(64);
const bffSubject = "dev:compliance-lead";
const upstreamSubject = customerApiSubject(bffSubject);
const nowMs = Date.parse("2026-10-10T12:00:00.000Z");
const subjectId = "syn_cust_00112233445566778899aabb";
const otherSubjectId = "syn_cust_ffeeddccbbaa009988776655";

// ---------- hostile upstream fixtures (snake_case contract views) ----------

function adminView(capabilities: readonly string[]): Record<string, unknown> {
  return {
    mode: "test",
    operator_id: `opr_${"a".repeat(24)}`,
    subject: upstreamSubject,
    role: "auditor",
    granted_capabilities: [...capabilities],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-15T00:00:00.000Z"
  };
}

const subjectRow = {
  subject_id: subjectId,
  display_name: "Aibek Ermatov",
  kyc_status: "verified",
  flags: 0,
  registered_at: "2026-09-01T00:00:00.000Z",
  last_active_at: "2026-10-01T00:00:00.000Z",
  posting: "none"
};

function subjectDetailView(id: string): Record<string, unknown> {
  return {
    mode: "test",
    subject: {
      ...subjectRow,
      subject_id: id,
      account_status: "active",
      contact_hash: `cth_${"1".repeat(32)}`,
      sessions: 2,
      devices: [`dev_${"2".repeat(16)}`],
      limits: { max_devices: 4, max_sessions: 8 }
    }
  };
}

const kycItem = {
  queue_id: `qky_${"0".repeat(24)}`,
  subject_id: subjectId,
  display_name: "Aibek Ermatov",
  submitted_at: "2026-10-01T00:00:00.000Z",
  sla_due_at: "2026-10-02T00:00:00.000Z",
  state: "pending",
  priority: "high",
  assignee: null,
  age_ms: 60_000
};

const amlItem = {
  queue_id: `qml_${"0".repeat(24)}`,
  subject_id: subjectId,
  alert_type: "structuring",
  evidence_refs: [`evd_${"0".repeat(24)}`],
  sla_due_at: "2026-10-02T00:00:00.000Z",
  state: "pending",
  priority: "high",
  assignee: null,
  age_ms: 60_000
};

const ticketItem = {
  queue_id: `qtick_${"0".repeat(19)}`,
  subject_id: subjectId,
  category: "question",
  opened_at: "2026-10-01T00:00:00.000Z",
  state: "open",
  priority: "normal",
  assignee: null,
  age_ms: 60_000
};

function queueView(kind: string, items: unknown[]): Record<string, unknown> {
  const byState =
    kind === "tickets"
      ? { open: items.length, waiting: 0, escalated: 0 }
      : { pending: items.length, in_review: 0, escalated: 0 };
  return {
    mode: "test",
    queue: { items, kind, posting: "none", summary: { by_state: byState, count: items.length } }
  };
}

// ---------- hostile-upstream test harness ----------

interface Served {
  requests: { path: string; deviceId: string | null }[];
}

function json(status: number, body: unknown) {
  return (_request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  };
}

async function withUpstream<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string, served: Served) => Promise<T>
): Promise<T> {
  const served: Served = { requests: [] };
  const server = createServer((request, response) => {
    served.requests.push({
      path: request.url ?? "",
      deviceId: typeof request.headers["x-device-id"] === "string" ? request.headers["x-device-id"] : null
    });
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`, served);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}

// ---------- signed-envelope harness (mirrors data/client.test.ts) ----------

interface TestKey {
  keyId: string;
  version: number;
  privateKey: KeyObject;
  publicJwk: JsonWebKey;
}

function testKey(version: number): TestKey {
  const pair = generateKeyPairSync("ed25519");
  return {
    keyId: createHash("sha256")
      .update(pair.publicKey.export({ type: "spki", format: "der" }))
      .digest("hex")
      .slice(0, 32),
    version,
    privateKey: pair.privateKey,
    publicJwk: pair.publicKey.export({ format: "jwk" })
  };
}

function publicKey(key: TestKey, status: "active" | "retired", retiredAt?: string) {
  return {
    keyId: key.keyId,
    version: key.version,
    algorithm: "Ed25519",
    status,
    createdAt: new Date(0).toISOString(),
    ...(retiredAt ? { retiredAt } : {}),
    publicJwk: key.publicJwk
  };
}

function keyset(active: TestKey, ...extra: Record<string, unknown>[]) {
  return {
    formatVersion: 1,
    backend: "ephemeral-dev",
    activeKeyId: active.keyId,
    keys: [publicKey(active, "active"), ...extra]
  };
}

function envelope(key: TestKey, resource: string, payload: unknown, issuedAt = new Date().toISOString()) {
  const message = JSON.stringify({
    signatureVersion: 1,
    keyId: key.keyId,
    keyVersion: key.version,
    issuedAt,
    requestId: "request-1",
    resource,
    payload
  });
  return {
    signatureVersion: 1,
    keyId: key.keyId,
    keyVersion: key.version,
    issuedAt,
    requestId: "request-1",
    resource,
    payload,
    signature: sign(null, Buffer.from(message), key.privateKey).toString("base64url")
  };
}

let servedKeyset: () => unknown = () => ({});
let respond: (path: string) => Response = () => new Response("{}", { status: 404 });
const seenPaths: string[] = [];
const originalFetch = globalThis.fetch;

function installFetchMock(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = String(input);
    seenPaths.push(path);
    if (path === "/bff/api/signing-keys") {
      return Response.json(servedKeyset());
    }
    return respond(path);
  }) as typeof fetch;
}

function expireCachedKeyset(): void {
  mock.timers.tick(61_000);
}

// ---------- server-side upstream client ----------

describe("upstream adapter layer — customer-api client", () => {
  it("rejects a subject detail bound to a different subject id", async () => {
    await withUpstream(json(200, subjectDetailView(otherSubjectId)), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      const result = await client.operatorSubject(bffSubject, testDeviceId, subjectId, nowMs);
      assert.equal(result.status, "unavailable");
    });
    await withUpstream(json(200, subjectDetailView(subjectId)), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      const result = await client.operatorSubject(bffSubject, testDeviceId, subjectId, nowMs);
      assert.equal(result.status, "ok");
    });
  });

  it("rejects granted capabilities outside the upstream vocabulary", async () => {
    for (const capabilities of [
      ["operator.session.read", "ledger.write"],
      ["*"],
      ["customers:read"],
      ["operator.session.read", "operator.session.read", "operator.admin.read"]
    ]) {
      await withUpstream(json(200, adminView(capabilities)), async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey });
        const result = await client.operatorAdmin(bffSubject, testDeviceId, nowMs);
        assert.equal(result.status, "unavailable", JSON.stringify(capabilities));
      });
    }
    await withUpstream(
      json(200, adminView(["operator.session.read", "operator.queue.read"])),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey });
        const result = await client.operatorAdmin(bffSubject, testDeviceId, nowMs);
        assert.equal(result.status, "ok");
      }
    );
  });

  it("maps every non-2xx deterministically and never accepts a 200 error body", async () => {
    for (const status of [301, 401, 403, 404, 429, 500, 503]) {
      await withUpstream(json(status, { error: "UPSTREAM_ERROR", request_id: "req_1" }), async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey });
        const result = await client.operatorSubjects(bffSubject, testDeviceId, nowMs);
        assert.equal(result.status, "unavailable", `status ${status}`);
      });
    }
    // A 200 carrying an upstream error envelope is drift, not a degraded ok.
    await withUpstream(
      json(200, { error: "CAPABILITY_DENIED", request_id: "req_1", retry_after: 30 }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey });
        const result = await client.operatorSubjects(bffSubject, testDeviceId, nowMs);
        assert.equal(result.status, "unavailable");
      }
    );
    // The member read keeps the uniform 404 for unknown contract ids.
    await withUpstream(json(404, { error: "CAPABILITY_DENIED" }), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      const result = await client.operatorSubject(bffSubject, testDeviceId, subjectId, nowMs);
      assert.equal(result.status, "not-found");
    });
  });

  it("rejects non-JSON bodies and content types", async () => {
    await withUpstream(json(200, "<html>not json</html>"), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      assert.equal((await client.operatorSubjects(bffSubject, testDeviceId, nowMs)).status, "unavailable");
    });
    await withUpstream(
      (_request, response) => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("{}");
      },
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey });
        assert.equal((await client.operatorSubjects(bffSubject, testDeviceId, nowMs)).status, "unavailable");
      }
    );
  });

  it("bounds streamed bodies without a content-length", async () => {
    await withUpstream(
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
        response.write(" ".repeat(20_000));
        response.end();
      },
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey });
        assert.equal((await client.operatorSubjects(bffSubject, testDeviceId, nowMs)).status, "unavailable");
      }
    );
  });

  it("rejects members carrying prototype-pollution keys", async () => {
    const poisoned = JSON.stringify({ mode: "test", subjects: [subjectRow] }).replace(
      `{"subject_id"`,
      `{"__proto__":{"injected":true},"subject_id"`
    );
    await withUpstream(json(200, poisoned), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      assert.equal((await client.operatorSubjects(bffSubject, testDeviceId, nowMs)).status, "unavailable");
    });
  });

  it("rejects queue items shaped for another kind and kind echo mismatches", async () => {
    // A kyc-shaped item set inside an aml-kind view fails item-shape checks.
    await withUpstream(json(200, queueView("aml", [kycItem])), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      assert.equal((await client.operatorQueue(bffSubject, testDeviceId, "aml", nowMs)).status, "unavailable");
    });
    // A correctly shaped aml view that answers kyc is a kind echo mismatch.
    await withUpstream(json(200, queueView("kyc", [amlItem])), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      assert.equal((await client.operatorQueue(bffSubject, testDeviceId, "aml", nowMs)).status, "unavailable");
    });
    // And tickets items in an aml view fail the same way.
    await withUpstream(json(200, queueView("aml", [ticketItem])), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      assert.equal((await client.operatorQueue(bffSubject, testDeviceId, "aml", nowMs)).status, "unavailable");
    });
    await withUpstream(json(200, queueView("aml", [amlItem])), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      assert.equal((await client.operatorQueue(bffSubject, testDeviceId, "aml", nowMs)).status, "ok");
    });
  });

  it("times out a hung upstream instead of hanging the route", async () => {
    const started = Date.now();
    await withUpstream(
      () => {
        // Accept the request and never respond.
      },
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey, timeoutMs: 100 });
        assert.equal((await client.operatorSubjects(bffSubject, testDeviceId, nowMs)).status, "unavailable");
      }
    );
    assert.ok(Date.now() - started < 10_000);
  });

  it("never emits a malformed device id upstream and forwards the real one", async () => {
    await withUpstream(json(200, { mode: "test", subjects: [subjectRow] }), async (baseUrl, served) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      for (const malformed of ["", "not-a-device-id", `dev_${"1".repeat(16)}`, "../etc/passwd"]) {
        const result = await client.operatorSubjects(bffSubject, malformed, nowMs);
        assert.equal(result.status, "unavailable", malformed);
      }
      assert.equal(served.requests.length, 0);
      const result = await client.operatorSubjects(bffSubject, testDeviceId, nowMs);
      assert.equal(result.status, "ok");
      assert.equal(served.requests.length, 1);
      assert.equal(served.requests[0]?.deviceId, testDeviceId);
    });
  });

  it("answers non-contract subject ids locally without an upstream call", async () => {
    await withUpstream(json(200, subjectDetailView(subjectId)), async (baseUrl, served) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      for (const id of ["../admin", "CUS-10482", "syn_oper_aaaaaaaa", "syn_cust_!bad"]) {
        const result = await client.operatorSubject(bffSubject, testDeviceId, id, nowMs);
        assert.equal(result.status, "not-found", id);
      }
      assert.equal(served.requests.length, 0);
    });
  });

  it("keeps degrade arms distinct: unconfigured, unavailable, not-found", async () => {
    const unconfigured = createCustomerApiClient({});
    assert.equal(unconfigured.configured, false);
    assert.equal((await unconfigured.operatorAdmin(bffSubject, testDeviceId, nowMs)).status, "not-configured");
    assert.equal((await unconfigured.operatorSubjects(bffSubject, testDeviceId, nowMs)).status, "not-configured");
    assert.equal((await unconfigured.operatorSubject(bffSubject, testDeviceId, subjectId, nowMs)).status, "not-configured");
    assert.equal((await unconfigured.operatorQueue(bffSubject, testDeviceId, "kyc", nowMs)).status, "not-configured");
    await withUpstream(json(503, { error: "down" }), async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey });
      assert.equal((await client.operatorAdmin(bffSubject, testDeviceId, nowMs)).status, "unavailable");
      assert.equal((await client.operatorQueue(bffSubject, testDeviceId, "kyc", nowMs)).status, "unavailable");
    });
  });
});

// ---------- BFF signed envelope surface ----------

describe("upstream adapter layer — signed envelope verification", () => {
  before(() => {
    installFetchMock();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-11T12:00:00.000Z") });
  });

  after(() => {
    mock.timers.reset();
    globalThis.fetch = originalFetch;
  });

  it("rejects a body above the response bound before parsing", async () => {
    expireCachedKeyset();
    const key = testKey(1);
    servedKeyset = () => keyset(key);
    const padded = envelope(key, "dashboard", { metrics: [], queues: [], pad: "x".repeat(17 * 1024 * 1024) });
    respond = () => new Response(JSON.stringify(padded), { status: 200 });
    await assert.rejects(dataClient.getDashboard(), /too large|exceeds/);
  });

  it("rejects payloads nested beyond the canonical depth bound", async () => {
    expireCachedKeyset();
    const key = testKey(2);
    servedKeyset = () => keyset(key);
    let deep: unknown = { leaf: 1 };
    for (let index = 0; index < 20; index += 1) {
      deep = { nested: deep };
    }
    respond = () => Response.json(envelope(key, "dashboard", deep));
    await assert.rejects(dataClient.getDashboard(), /canonical JSON/);
  });

  it("rejects a keyset carrying an oversized keys array", async () => {
    expireCachedKeyset();
    const key = testKey(3);
    const retiredAt = new Date(Date.now() - 1_000).toISOString();
    const extra = Array.from({ length: 65 }, (_unused, index) => ({
      ...publicKey(key, "retired", retiredAt),
      keyId: `retired-${index}`
    }));
    servedKeyset = () => ({ ...keyset(key), keys: [publicKey(key, "active"), ...extra] });
    respond = () => Response.json(envelope(key, "dashboard", { metrics: [], queues: [] }));
    await assert.rejects(dataClient.getDashboard(), /keyset is invalid/);
  });

  it("rejects a signed view whose resource is not bound to the request", async () => {
    expireCachedKeyset();
    const key = testKey(4);
    servedKeyset = () => keyset(key);
    // An unbound (legacy) or other-subject envelope can never satisfy a
    // subject detail read; only the envelope signed for the requested id may.
    respond = () => Response.json(envelope(key, "operator-subject", { mode: "test", subject: { forged: true } }));
    await assert.rejects(dataClient.getOperatorSubject(subjectId), /resource mismatch/);
    respond = () =>
      Response.json(envelope(key, `operator-subject:${otherSubjectId}`, { mode: "test", subject: { forged: true } }));
    await assert.rejects(dataClient.getOperatorSubject(subjectId), /resource mismatch/);
    const bound = { mode: "test", subject: { forged: true } };
    respond = () => Response.json(envelope(key, `operator-subject:${subjectId}`, bound));
    assert.deepEqual(await dataClient.getOperatorSubject(subjectId), bound);
    // The work queue binds its kind the same way.
    respond = () => Response.json(envelope(key, "operator-queue", { mode: "test", queue: {} }));
    await assert.rejects(dataClient.getOperatorQueue("aml"), /resource mismatch/);
    respond = () => Response.json(envelope(key, "operator-queue:kyc", { mode: "test", queue: {} }));
    await assert.rejects(dataClient.getOperatorQueue("aml"), /resource mismatch/);
    respond = () => Response.json(envelope(key, "operator-queue:aml", { mode: "test", queue: {} }));
    await dataClient.getOperatorQueue("aml");
    respond = () => Response.json(envelope(key, "operator-queue:kyc", { mode: "test", queue: {} }));
    await dataClient.getOperatorQueue();
  });

  it("rejects envelopes outside the freshness window in both directions", async () => {
    expireCachedKeyset();
    const key = testKey(5);
    servedKeyset = () => keyset(key);
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    respond = () => Response.json(envelope(key, "customers", { customers: [] }, stale));
    await assert.rejects(dataClient.getCustomers(), /time window/);
    respond = () => Response.json(envelope(key, "customers", { customers: [] }, future));
    await assert.rejects(dataClient.getCustomers(), /time window/);
  });

  it("rejects a payload swapped under a valid signature", async () => {
    expireCachedKeyset();
    const key = testKey(6);
    servedKeyset = () => keyset(key);
    const signed = envelope(key, "customers", { customers: [] });
    respond = () =>
      Response.json({
        ...signed,
        payload: { customers: [{ id: "forged" }] }
      });
    await assert.rejects(dataClient.getCustomers(), /signature is invalid/);
  });

  it("type-checks error detail fields instead of passing JSON through", async () => {
    respond = () =>
      Response.json({ error: { nested: true }, state: 42, attemptsRemaining: "three" }, { status: 403 });
    const error = await dataClient
      .createStepUpChallenge("ap_001122", "digest")
      .catch((caught: unknown) => caught);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, undefined);
    assert.equal(error.state, undefined);
    assert.equal(error.attemptsRemaining, undefined);
    respond = () =>
      Response.json({ error: "device_not_approved", deviceDigest: { nested: true } }, { status: 403 });
    const denied = await dataClient.createDevSession("auditor").catch((caught: unknown) => caught);
    assert.ok(denied instanceof ApiError);
    assert.equal(denied.code, undefined);
    assert.match(denied.message, /rejected/);
  });

  it("URL-encodes the queue kind and binds the default to kyc", async () => {
    expireCachedKeyset();
    const key = testKey(7);
    servedKeyset = () => keyset(key);
    const oddKind = "aml&debug=1";
    respond = () => Response.json(envelope(key, `operator-queue:${oddKind}`, { mode: "test", queue: {} }));
    await dataClient.getOperatorQueue(oddKind as "aml");
    // The signing-keyset fetch follows the view fetch inside getSigned —
    // assert on the recorded queue path, not the last seen one.
    assert.ok(seenPaths.includes(`/bff/api/operator/queue?kind=${encodeURIComponent(oddKind)}`));
    respond = () => Response.json(envelope(key, "operator-queue:kyc", { mode: "test", queue: {} }));
    await dataClient.getOperatorQueue();
    assert.ok(seenPaths.includes("/bff/api/operator/queue"));
  });
});

// ---------- strict adapters ----------

describe("upstream adapter layer — strict view adapters", () => {
  const camelDetail = {
    mode: "test",
    subject: {
      subjectId: "syn_cust_alpha001",
      displayName: "Aibek Ermatov",
      kycStatus: "verified",
      flags: 2,
      registeredAt: "2026-01-15T09:00:00.000Z",
      lastActiveAt: "2026-10-10T08:30:00.000Z",
      posting: "none",
      accountStatus: "active",
      contactHash: `cth_${"3".repeat(32)}`,
      sessions: 3,
      devices: [`dev_${"4".repeat(16)}`],
      limits: { maxSessions: 8, maxDevices: 4 }
    }
  };

  // The bound signature lands with the fix; pre-fix the single-argument
  // parser simply ignores it, which is exactly the repro being pinned.
  const parseSubjectBound = parseOperatorSubjectView as unknown as (
    value: unknown,
    expectedSubjectId: string
  ) => unknown;

  it("rejects a subject detail bound to another subject id", () => {
    assert.equal(parseSubjectBound(camelDetail, "syn_cust_bravo002"), undefined);
    assert.notEqual(parseSubjectBound(camelDetail, "syn_cust_alpha001"), undefined);
  });

  it("rejects view members carrying prototype-pollution keys", () => {
    const poisoned = JSON.parse(
      JSON.stringify(camelDetail).replace(`{"subjectId"`, `{"__proto__":{"injected":true},"subjectId"`)
    ) as unknown;
    assert.equal(parseSubjectBound(poisoned, "syn_cust_alpha001"), undefined);
  });

  it("rejects queue items shaped for another kind", () => {
    const base = {
      queueId: `qky_${"0".repeat(24)}`,
      subjectId: "syn_cust_alpha001",
      displayName: "Aibek Ermatov",
      submittedAt: "2026-10-01T00:00:00.000Z",
      slaDueAt: "2026-10-02T00:00:00.000Z",
      state: "pending",
      priority: "high",
      assignee: null,
      ageMs: 60_000
    };
    const mismatched = {
      mode: "test",
      queue: {
        kind: "aml",
        items: [base],
        summary: { count: 1, byState: { pending: 1, inReview: 0, escalated: 0 } },
        posting: "none"
      }
    };
    assert.equal(parseOperatorQueueView(mismatched), undefined);
  });
});
