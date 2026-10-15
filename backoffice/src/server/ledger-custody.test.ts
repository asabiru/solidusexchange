import assert from "node:assert/strict";
import type { Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import { demoRepository } from "../data/demo.js";
import type { ServerConfig } from "./config.js";
import { createBackofficeServer } from "./server.js";

const origin = "http://127.0.0.1:4173";
const servers: Server[] = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
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
    stepUp: { provider: "synthetic-dev", challengeTtlSeconds: 300, grantTtlSeconds: 60, maxAttempts: 3 },
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

async function signedJson(response: Response) {
  const body = (await response.json()) as { payload: unknown };
  return body.payload as Record<string, unknown>;
}

describe("ledger read-only surface", () => {
  it("serves the synthetic journal list and trial balance to finance readers", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const response = await fetch(`${baseUrl}/bff/api/ledger`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const payload = await signedJson(response);
    assert.ok(Array.isArray(payload.journals));
    assert.ok(Array.isArray(payload.journalTypes));
    assert.ok(Array.isArray(payload.trialBalance));
    assert.equal(
      (payload.journals as { journalType: string }[]).length,
      demoRepository.ledgerJournals().length
    );
  });

  it("filters journals by the declared journal-type query contract", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const filtered = await fetch(`${baseUrl}/bff/api/ledger?type=SYNTHETIC_HOLD_CREATE`, { headers: { cookie } });
    assert.equal(filtered.status, 200);
    const payload = await signedJson(filtered);
    for (const journal of payload.journals as { journalType: string }[]) {
      assert.equal(journal.journalType, "SYNTHETIC_HOLD_CREATE");
    }
    const invalid = await fetch(`${baseUrl}/bff/api/ledger?type=NOT_A_TYPE`, { headers: { cookie } });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "invalid_journal_type" });
  });

  it("serves journal detail with its double-entry legs and digest evidence", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const journal = demoRepository.ledgerJournals()[0];
    const response = await fetch(`${baseUrl}/bff/api/ledger/${journal.id}`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const payload = (await signedJson(response)) as { entries: { side: string; amount: string }[]; commandDigest: string };
    assert.equal(payload.entries.length, 2);
    assert.equal(payload.commandDigest, journal.commandDigest);
    const missing = await fetch(`${baseUrl}/bff/api/ledger/JRN-absent`, { headers: { cookie } });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "journal_not_found" });
  });

  it("denies finance readers without the capability and appends view audit on detail", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const supportCookie = await devSession(baseUrl, "support-l1");
    const denied = await fetch(`${baseUrl}/bff/api/ledger`, { headers: { cookie: supportCookie } });
    assert.equal(denied.status, 403);
    const complianceCookie = await devSession(baseUrl);
    const journal = demoRepository.ledgerJournals()[0];
    await fetch(`${baseUrl}/bff/api/ledger/${journal.id}`, { headers: { cookie: complianceCookie } });
    const audit = await fetch(`${baseUrl}/bff/api/audit`, { headers: { cookie: complianceCookie } });
    const payload = (await signedJson(audit)) as { events: { action: string; resource: string }[] };
    assert.ok(
      payload.events.some((event) => event.action === "ledger.journal_viewed" && event.resource === `ledger:${journal.id}`)
    );
  });
});

describe("custody read-only surface", () => {
  it("serves tiers, watcher incidents, key inventory and intent summaries", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const response = await fetch(`${baseUrl}/bff/api/custody`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const payload = await signedJson(response);
    assert.equal((payload.tiers as unknown[]).length, 3);
    assert.ok(Array.isArray(payload.incidents));
    assert.ok(Array.isArray(payload.keyInventory));
    assert.ok(Array.isArray(payload.intents));
  });

  it("filters incidents by status and serves incident detail", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const filtered = await fetch(`${baseUrl}/bff/api/custody?status=open`, { headers: { cookie } });
    assert.equal(filtered.status, 200);
    const payload = await signedJson(filtered);
    for (const incident of payload.incidents as { status: string }[]) {
      assert.equal(incident.status, "open");
    }
    const incident = demoRepository.custodyIncidents()[0];
    const detail = await fetch(`${baseUrl}/bff/api/custody/incidents/${incident.id}`, { headers: { cookie } });
    assert.equal(detail.status, 200);
    const missing = await fetch(`${baseUrl}/bff/api/custody/incidents/CINC-absent`, { headers: { cookie } });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "custody_incident_not_found" });
  });

  it("keeps key material and command surfaces absent from every custody row", async () => {
    const baseUrl = await listen(createBackofficeServer(config()));
    const cookie = await devSession(baseUrl);
    const response = await fetch(`${baseUrl}/bff/api/custody`, { headers: { cookie } });
    const text = JSON.stringify(await signedJson(response));
    for (const forbidden of ["private_key", "mnemonic", "seed_phrase", "raw_transaction", "signature"]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
  });
});
