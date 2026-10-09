import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import { demoRepository, type AuditEvent, type AuditSourceEvent } from "../data/demo.js";
import type { AuditStore, VerifiedAuditSnapshot } from "./audit-store.js";
import type { ServerConfig } from "./config.js";
import { approvalCommandDigest, auditGenesisHash, buildAuditEvent } from "./controls.js";
import { createBackofficeServer } from "./server.js";
import { SyntheticStepUpService, type StepUpBinding } from "./step-up.js";

const origin = "http://127.0.0.1:4173";

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

async function devSession(baseUrl: string, role = "compliance-lead"): Promise<string> {
  const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ role })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0];
}

interface RawResponse {
  status: number;
  body: string;
}

function rawGet(port: number, host: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: "/bff/healthz",
      headers: { host }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

class EmptyAuditStore implements AuditStore {
  #events: AuditEvent[] = [];

  async snapshot(): Promise<VerifiedAuditSnapshot> {
    return {
      events: this.#events,
      status: {
        backend: "synthetic-memory",
        durable: false,
        retentionDays: 30,
        verified: true,
        length: this.#events.length,
        headHash: this.#events.at(-1)?.hash ?? auditGenesisHash
      }
    };
  }

  async append(event: AuditSourceEvent, expectedHeadHash: string): Promise<AuditEvent> {
    const headHash = this.#events.at(-1)?.hash ?? auditGenesisHash;
    if (headHash !== expectedHeadHash) throw new Error("Audit head changed before append");
    const next = buildAuditEvent(this.#events.length + 1, headHash, event);
    this.#events.push(next);
    return next;
  }

  async close(): Promise<void> {}
}

const stepUpConfig = {
  provider: "synthetic-dev" as const,
  challengeTtlSeconds: 30,
  grantTtlSeconds: 15,
  maxAttempts: 3
};

const binding: StepUpBinding = {
  sessionId: "session-1",
  subject: "operator-1",
  approvalId: "APV-843910",
  commandDigest: "a".repeat(64),
  auditHeadHash: "b".repeat(64)
};

function bound(index: number): StepUpBinding {
  return { ...binding, auditHeadHash: index.toString(16).padStart(64, "0") };
}

describe("BFF core hardening", () => {
  it("ignores malformed percent-encoding in cookie pairs instead of failing the request", async () => {
    const server = createBackofficeServer(config());
    const baseUrl = await listen(server);

    const status = await fetch(`${baseUrl}/bff/auth/status`, {
      headers: { cookie: "broken=%" }
    });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { authenticated: false });

    const denied = await fetch(`${baseUrl}/bff/api/dashboard`, {
      headers: { cookie: "solidchange_bo_session=%zz" }
    });
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: "operator_session_required" });

    const cookie = await devSession(baseUrl);
    const mixed = await fetch(`${baseUrl}/bff/api/dashboard`, {
      headers: { cookie: `${cookie}; broken=%e0%a4` }
    });
    assert.equal(mixed.status, 200);
  });

  it("rejects requests whose Host header cannot form a URL", async () => {
    const server = createBackofficeServer(config());
    const baseUrl = await listen(server);
    const port = Number(new URL(baseUrl).port);

    for (const host of ["a b", "[bad"]) {
      const reply = await rawGet(port, host);
      assert.equal(reply.status, 400, host);
      assert.deepEqual(JSON.parse(reply.body), { error: "invalid_request" });
    }

    const valid = await rawGet(port, "127.0.0.1");
    assert.equal(valid.status, 200);
  });

  it("admits dev login when the BFF binds the bare ::1 loopback host", async () => {
    const server = createBackofficeServer(config({ host: "::1" }));
    const baseUrl = await listen(server);

    const cookie = await devSession(baseUrl);
    const status = await fetch(`${baseUrl}/bff/auth/status`, { headers: { cookie } });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { authenticated: true });
  });

  it("prunes expired step-up challenge bindings from the index", () => {
    let now = Date.parse("2026-10-09T00:00:00.000Z");
    const service = new SyntheticStepUpService(stepUpConfig, () => now);
    for (let index = 0; index < 5; index += 1) {
      service.begin(bound(index));
    }
    assert.deepEqual(service.indexSizes(), { challenges: 5, grants: 0 });

    now += 31_000;
    service.begin(bound(9));
    assert.deepEqual(service.indexSizes(), { challenges: 1, grants: 0 });
  });

  it("prunes expired step-up grant bindings from the index", () => {
    let now = Date.parse("2026-10-09T00:00:00.000Z");
    const service = new SyntheticStepUpService(stepUpConfig, () => now);
    for (let index = 0; index < 5; index += 1) {
      const challenge = service.begin(bound(index));
      service.verify(challenge.challengeId, challenge.devVerificationCode, bound(index));
    }
    assert.deepEqual(service.indexSizes(), { challenges: 0, grants: 5 });

    now += 16_000;
    const challenge = service.begin(bound(9));
    service.verify(challenge.challengeId, challenge.devVerificationCode, bound(9));
    assert.deepEqual(service.indexSizes(), { challenges: 0, grants: 1 });
  });

  it("anchors approval previews at the genesis hash when the audit chain is empty", async () => {
    const server = createBackofficeServer(config(), new EmptyAuditStore());
    const baseUrl = await listen(server);
    const cookie = await devSession(baseUrl);
    const approval = demoRepository.approvals().find((item) => item.id === "APV-843910");
    assert.ok(approval);

    const preview = await fetch(`${baseUrl}/bff/api/approvals/${approval.id}/preview`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin },
      body: JSON.stringify({ commandDigest: approvalCommandDigest(approval) })
    });
    assert.equal(preview.status, 200);
    const envelope = await preview.json() as {
      payload: { auditAnchor: { sequence: number; hash: string } };
    };
    assert.deepEqual(envelope.payload.auditAnchor, {
      sequence: 0,
      hash: auditGenesisHash
    });
  });
});
