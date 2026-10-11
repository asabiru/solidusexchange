import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { type IncomingHttpHeaders, createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { ServerConfig } from "./config.js";
import {
  type CustomerApiClient,
  type CustomerApiOperatorSubjects,
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
}

function stubClient(result: CustomerApiOperatorSubjects): { client: CustomerApiClient; seen: SeenCall[] } {
  const seen: SeenCall[] = [];
  const client: CustomerApiClient = {
    configured: true,
    operatorAdmin: async () => ({ status: "not-configured" }),
    operatorSubjects: async (subject: string, deviceId: string): Promise<CustomerApiOperatorSubjects> => {
      seen.push({ subject, deviceId });
      return result;
    },
    operatorSubject: async () => ({ status: "not-configured" }),
    operatorQueue: async () => ({ status: "not-configured" })
  };
  return { client, seen };
}

function contractView(): CustomerApiOperatorSubjects {
  return {
    status: "ok",
    view: {
      mode: "test",
      subjects: [
        {
          subject_id: "syn_cust_00112233445566778899aabb",
          display_name: "Alina Mironova",
          kyc_status: "verified",
          flags: 2,
          registered_at: "2026-09-05T00:00:00.000Z",
          last_active_at: "2026-09-25T00:00:00.000Z",
          posting: "none"
        }
      ]
    }
  };
}

async function operatorSubjectsEnvelope(baseUrl: string, cookie: string) {
  const response = await fetch(`${baseUrl}/bff/api/operator/subjects`, { headers: { cookie, origin } });
  const body = await response.json() as { resource?: string; payload?: Record<string, unknown>; error?: string };
  return { response, body };
}

describe("operator subjects BFF surface", () => {
  it("requires an operator session", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const response = await fetch(`${baseUrl}/bff/api/operator/subjects`, { headers: { origin } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "operator_session_required" });
  });

  it("serves the local synthetic directory when the upstream is unconfigured", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const { response, body } = await operatorSubjectsEnvelope(baseUrl, cookie);
    assert.equal(response.status, 200);
    assert.equal(body.resource, "operator-subjects");
    const payload = body.payload as { mode: string; subjects: Record<string, unknown>[] };
    assert.equal(payload.mode, "test");
    assert.ok(payload.subjects.length >= 1);
    for (const row of payload.subjects) {
      // The local roster has no customer-api refs or lifecycle timestamps;
      // upstream-only fields stay null instead of being invented.
      assert.equal(row.subjectId, null);
      assert.equal(typeof row.displayName, "string");
      assert.equal(row.kycStatus, null);
      assert.equal(typeof row.flags, "number");
      assert.equal(row.registeredAt, null);
      assert.equal(row.lastActiveAt, null);
      assert.equal(row.posting, "none");
    }
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
    const { response, body } = await operatorSubjectsEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 200);
    assert.equal(body.resource, "operator-subjects");
    assert.deepEqual(body.payload, {
      mode: "test",
      subjects: [{
        subjectId: "syn_cust_00112233445566778899aabb",
        displayName: "Alina Mironova",
        kycStatus: "verified",
        flags: 2,
        registeredAt: "2026-09-05T00:00:00.000Z",
        lastActiveAt: "2026-09-25T00:00:00.000Z",
        posting: "none"
      }]
    });
    // The session's bound workstation device is what propagates upstream.
    assert.deepEqual(seen, [{ subject: "dev:compliance-lead", deviceId: testDeviceId }]);
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
      const { response, body } = await operatorSubjectsEnvelope(baseUrl, cookie);
      assert.equal(response.status, 403, deviceCookie || "absent");
      assert.deepEqual(body, { error: "device_required" });
    }
    assert.equal(seen.length, 0);
  });

  it("maps any non-ok upstream outcome to operator_subjects_unavailable", async () => {
    const { client } = stubClient({ status: "unavailable" });
    const baseUrl = await listen(createBackofficeServer(config(), undefined, undefined, {}, client));
    const session = await devSession(baseUrl);
    const { response, body } = await operatorSubjectsEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(body, { error: "operator_subjects_unavailable" });
  });

  it("fails closed to 503 on upstream contract drift end-to-end", async () => {
    const key = randomBytes(32).toString("hex");
    const drifted = {
      mode: "test",
      subjects: [{
        subject_id: "syn_oper_00000001",
        display_name: "Alina Mironova",
        kyc_status: "verified",
        flags: 2,
        registered_at: "2026-09-05T00:00:00.000Z",
        last_active_at: "2026-09-25T00:00:00.000Z",
        posting: "none"
      }]
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
    const { response, body } = await operatorSubjectsEnvelope(
      baseUrl,
      `${session}; solidchange_bo_device=${testDeviceId}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(body, { error: "operator_subjects_unavailable" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]["x-device-id"], testDeviceId);
    assert.match(
      String(seen[0].authorization),
      new RegExp(`^Bearer sodev1\\.${customerApiSubject("dev:compliance-lead")}\\.[0-9]{10}\\.[0-9a-f]{64}$`)
    );
  });
});
