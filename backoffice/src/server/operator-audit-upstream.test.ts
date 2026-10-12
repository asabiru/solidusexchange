import assert from "node:assert/strict";
import type { Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import type { ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiOperatorAudit } from "./customer-api-client.js";
import { deviceDigest } from "./device.js";
import { createBackofficeServer } from "./server.js";

const origin = "http://127.0.0.1:4173";
const testDeviceId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const mintedCursor = "auc_0011223344556677";

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

async function devSession(baseUrl: string, role = "compliance-lead", deviceId?: string): Promise<string> {
  const cookie = deviceId ? `solidchange_bo_device=${deviceId}` : undefined;
  const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify({ role })
  });
  assert.equal(response.status, 200);
  const sessionCookie = response.headers.get("set-cookie");
  assert.ok(sessionCookie);
  return sessionCookie.split(";")[0];
}

interface SeenCall {
  subject: string;
  deviceId: string;
  cursor: string | undefined;
}

function stubClient(
  result: CustomerApiOperatorAudit | ((cursor: string | undefined) => CustomerApiOperatorAudit)
): { client: CustomerApiClient; seen: SeenCall[] } {
  const seen: SeenCall[] = [];
  const client: CustomerApiClient = {
    configured: true,
    operatorAdmin: async () => ({ status: "not-configured" }),
    operatorSubjects: async () => ({ status: "not-configured" }),
    operatorSubject: async () => ({ status: "not-configured" }),
    operatorQueue: async () => ({ status: "not-configured" }),
    operatorQueueItem: async () => ({ status: "not-configured" }),
    operatorAudit: async (subject: string, deviceId: string, cursor: string | undefined): Promise<CustomerApiOperatorAudit> => {
      seen.push({ subject, deviceId, cursor });
      return typeof result === "function" ? result(cursor) : result;
    }
  };
  return { client, seen };
}

function contractView(cursor: string | null = mintedCursor): CustomerApiOperatorAudit {
  return {
    status: "ok",
    view: {
      mode: "test",
      audit: {
        as_of: "2027-01-29T00:00:00.000Z",
        entries: [
          {
            audit_id: "au_00112233445566778899aabb",
            actor_subject_id: "syn_oper_0011223344556677",
            actor_role: "auditor",
            action: "subject.viewed",
            target_kind: "subject",
            target_id: "syn_cust_00112233445566778899aabb",
            at: "2027-01-28T10:00:00.000Z",
            detail_hash: "adh_00112233445566778899aabbccddeeff"
          },
          {
            audit_id: "au_bbccddee0011223344556677",
            actor_subject_id: "syn_oper_66554433221100aa",
            actor_role: "compliance-lead",
            action: "flag.reviewed",
            target_kind: "flag",
            target_id: "flg_00112233445566778899aabb",
            at: "2027-01-28T09:00:00.000Z",
            detail_hash: "adh_ffeeddccbbaa99887766554433221100"
          }
        ],
        next_cursor: cursor
      }
    }
  };
}

async function operatorAuditEnvelope(baseUrl: string, cookie: string, query = "") {
  const response = await fetch(`${baseUrl}/bff/api/operator/audit${query}`, { headers: { cookie, origin } });
  const body = await response.json() as { resource?: string; payload?: Record<string, unknown>; error?: string };
  return { response, body };
}

describe("operator audit BFF surface", () => {
  it("requires an operator session", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const response = await fetch(`${baseUrl}/bff/api/operator/audit`, { headers: { origin } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "operator_session_required" });
  });

  it("stays behind the oversight-only audit:read capability", async () => {
    const { client } = stubClient(contractView());
    const baseUrl = await listen(createBackofficeServer(
      config({ deviceBinding: { mode: "enforce", approvedDeviceDigests: [deviceDigest(testDeviceId)] } }),
      undefined,
      undefined,
      {},
      client
    ));
    const session = await devSession(baseUrl, "support-l1", testDeviceId);
    const { response } = await operatorAuditEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 403);
  });

  it("binds the first page to operator-audit:first and a cursor to its token", async () => {
    const { client, seen } = stubClient(contractView());
    const baseUrl = await listen(createBackofficeServer(
      config({ deviceBinding: { mode: "enforce", approvedDeviceDigests: [deviceDigest(testDeviceId)] } }),
      undefined,
      undefined,
      {},
      client
    ));
    const session = await devSession(baseUrl, "compliance-lead", testDeviceId);
    const cookie = `${session}; solidchange_bo_device=${testDeviceId}`;

    const first = await operatorAuditEnvelope(baseUrl, cookie);
    assert.equal(first.response.status, 200);
    assert.equal(first.body.resource, "operator-audit:first");
    assert.deepEqual(seen.at(-1)?.cursor, undefined);

    const next = await operatorAuditEnvelope(baseUrl, cookie, `?cursor=${mintedCursor}`);
    assert.equal(next.response.status, 200);
    assert.equal(next.body.resource, `operator-audit:${mintedCursor}`);
    assert.deepEqual(seen.at(-1)?.cursor, mintedCursor);
  });

  it("maps the upstream contract view onto the signed camelCase payload", async () => {
    const { client } = stubClient(contractView(null));
    const baseUrl = await listen(createBackofficeServer(
      config({ deviceBinding: { mode: "enforce", approvedDeviceDigests: [deviceDigest(testDeviceId)] } }),
      undefined,
      undefined,
      {},
      client
    ));
    const session = await devSession(baseUrl, "auditor", testDeviceId);
    const { response, body } = await operatorAuditEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 200);
    assert.equal(body.resource, "operator-audit:first");
    assert.deepEqual(body.payload, {
      mode: "test",
      audit: {
        asOf: "2027-01-29T00:00:00.000Z",
        entries: [
          {
            auditId: "au_00112233445566778899aabb",
            actorSubjectId: "syn_oper_0011223344556677",
            actorRole: "auditor",
            action: "subject.viewed",
            targetKind: "subject",
            targetId: "syn_cust_00112233445566778899aabb",
            at: "2027-01-28T10:00:00.000Z",
            detailHash: "adh_00112233445566778899aabbccddeeff"
          },
          {
            auditId: "au_bbccddee0011223344556677",
            actorSubjectId: "syn_oper_66554433221100aa",
            actorRole: "compliance-lead",
            action: "flag.reviewed",
            targetKind: "flag",
            targetId: "flg_00112233445566778899aabb",
            at: "2027-01-28T09:00:00.000Z",
            detailHash: "adh_ffeeddccbbaa99887766554433221100"
          }
        ],
        nextCursor: null
      }
    });
  });

  it("rejects malformed cursors and unknown query keys locally", async () => {
    const { client } = stubClient(contractView());
    const baseUrl = await listen(createBackofficeServer(
      config({ deviceBinding: { mode: "enforce", approvedDeviceDigests: [deviceDigest(testDeviceId)] } }),
      undefined,
      undefined,
      {},
      client
    ));
    const session = await devSession(baseUrl, "compliance-lead", testDeviceId);
    const cookie = `${session}; solidchange_bo_device=${testDeviceId}`;
    for (const query of ["?cursor=bogus", "?cursor=AUC_0011223344556677", "?cursor=auc_00112233445566778"]) {
      const { response, body } = await operatorAuditEnvelope(baseUrl, cookie, query);
      assert.equal(response.status, 400, query);
      assert.equal(body.error, "operator_audit_cursor_invalid");
    }
    const { response, body } = await operatorAuditEnvelope(baseUrl, cookie, "?debug=1");
    assert.equal(response.status, 400);
    assert.equal(body.error, "operator_audit_query_invalid");
  });

  it("fails closed without a bound device and never reaches upstream", async () => {
    const { client, seen } = stubClient(contractView());
    const baseUrl = await listen(createBackofficeServer(config(), undefined, undefined, {}, client));
    const session = await devSession(baseUrl);
    for (const deviceCookie of [
      "",
      "solidchange_bo_device=not-a-device",
      "solidchange_bo_device=F47AC10B-58CC-4372-A567-0E02B2C3D479"
    ]) {
      const cookie = deviceCookie ? `${session}; ${deviceCookie}` : session;
      const { response, body } = await operatorAuditEnvelope(baseUrl, cookie);
      assert.equal(response.status, 403, deviceCookie || "absent");
      assert.equal(body.error, "device_required");
    }
    assert.equal(seen.length, 0);
  });

  it("answers the uniform not-found for a never-minted cursor and 503 on upstream drift", async () => {
    const { client } = stubClient((cursor) =>
      cursor === mintedCursor ? { status: "not-found" } : { status: "unavailable" });
    const baseUrl = await listen(createBackofficeServer(
      config({ deviceBinding: { mode: "enforce", approvedDeviceDigests: [deviceDigest(testDeviceId)] } }),
      undefined,
      undefined,
      {},
      client
    ));
    const session = await devSession(baseUrl, "compliance-lead", testDeviceId);
    const cookie = `${session}; solidchange_bo_device=${testDeviceId}`;
    const missing = await operatorAuditEnvelope(baseUrl, cookie, `?cursor=${mintedCursor}`);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error, "operator_audit_not_found");
    const drift = await operatorAuditEnvelope(baseUrl, cookie);
    assert.equal(drift.response.status, 503);
    assert.equal(drift.body.error, "operator_audit_unavailable");
  });

  it("serves the local demo audit ledger when the upstream is unconfigured", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl, "compliance-lead");
    const { response, body } = await operatorAuditEnvelope(baseUrl, cookie);
    assert.equal(response.status, 200);
    assert.equal(body.resource, "operator-audit:first");
    const payload = body.payload as { mode: string; audit: { entries: Record<string, unknown>[]; nextCursor: unknown } };
    assert.equal(payload.mode, "test");
    assert.equal(payload.audit.nextCursor, null);
    assert.ok(payload.audit.entries.length >= 1);
    for (const entry of payload.audit.entries) {
      // The local ledger has no upstream refs or staff roles — upstream-only
      // fields stay null instead of being invented.
      assert.equal(entry.auditId, null);
      assert.equal(entry.actorSubjectId, null);
      assert.equal(entry.actorRole, null);
      assert.equal(entry.targetKind, null);
      assert.equal(typeof entry.targetId, "string");
      assert.equal(typeof entry.detailHash, "string");
    }
  });
});
