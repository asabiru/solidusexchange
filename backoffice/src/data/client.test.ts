import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { after, before, describe, it, mock } from "node:test";
import {
  EphemeralSigningKeyProvider,
  type PublicSigningKeyset,
  ResponseSigner
} from "../server/signing.js";

interface TestKey {
  keyId: string;
  version: number;
  privateKey: KeyObject;
  publicJwk: JsonWebKey;
}

type Keyset = PublicSigningKeyset | Record<string, unknown>;

(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

let servedKeyset: () => Keyset = () => ({});
let keysetFetches = 0;
let keysetFailures = 0;
let servedBody = "";
const paths: string[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request) => {
  paths.push(String(input));
  if (String(input) === "/bff/api/signing-keys") {
    keysetFetches += 1;
    if (keysetFailures > 0) {
      keysetFailures -= 1;
      return new Response("{}", { status: 503 });
    }
    return Response.json(servedKeyset());
  }
  return new Response(servedBody, { status: 200 });
}) as typeof fetch;

const client = await import("./client.js");

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

function keyset(active: TestKey, ...retired: [TestKey, string][]): Keyset {
  return {
    formatVersion: 1,
    backend: "ephemeral-dev",
    activeKeyId: active.keyId,
    keys: [
      publicKey(active, "active"),
      ...retired.map(([key, retiredAt]) => publicKey(key, "retired", retiredAt))
    ]
  };
}

function envelope(
  key: TestKey,
  resource: string,
  payload: unknown,
  issuedAt = new Date().toISOString()
) {
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

function serve(value: unknown): void {
  servedBody = typeof value === "string" ? value : JSON.stringify(value);
}

function expireCachedKeyset(): void {
  mock.timers.tick(61_000);
}

describe("backoffice client signed envelope verification", () => {
  before(() => {
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-05T12:00:00.000Z") });
  });

  after(() => {
    mock.timers.reset();
    globalThis.fetch = originalFetch;
  });

  it("accepts BFF-signed envelopes across active/retired key rotation", async () => {
    expireCachedKeyset();
    const provider = new EphemeralSigningKeyProvider(1);
    const signer = new ResponseSigner(provider);
    servedKeyset = () => signer.publicKeyset();
    serve(signer.envelope("dashboard", { metrics: [], queues: [] }, "request-1"));
    assert.deepEqual(await client.getDashboard(), { metrics: [], queues: [] });

    const beforeRotation = signer.envelope("kyc-cases", { cases: [] }, "request-2");
    mock.timers.tick(1_000);
    provider.rotate();
    serve(signer.envelope("customers", { customers: [] }, "request-3"));
    assert.deepEqual(await client.getCustomers(), { customers: [] });
    serve(beforeRotation);
    assert.deepEqual(await client.getKycCases(), { cases: [] });
  });

  it("refreshes an expired keyset and rejects keys the BFF no longer publishes", async () => {
    expireCachedKeyset();
    const first = testKey(1);
    servedKeyset = () => keyset(first);
    serve(envelope(first, "dashboard", { metrics: [], queues: [] }));
    await client.getDashboard();

    const [second, third, fourth] = [testKey(2), testKey(3), testKey(4)];
    const retiredAt = new Date(Date.now() - 1_000).toISOString();
    servedKeyset = () => keyset(fourth, [third, retiredAt], [second, retiredAt]);
    expireCachedKeyset();
    serve(envelope(first, "dashboard", { metrics: [{ forged: true }], queues: [] }));
    await assert.rejects(client.getDashboard(), /key mismatch/);
  });

  it("rejects retired keys for envelopes issued after retirement", async () => {
    expireCachedKeyset();
    const [retired, active] = [testKey(5), testKey(6)];
    const retiredAt = new Date(Date.now() - 60_000).toISOString();
    servedKeyset = () => keyset(active, [retired, retiredAt]);
    serve(envelope(retired, "kyc-cases", { cases: [] }, new Date(Date.now() - 61_000).toISOString()));
    assert.deepEqual(await client.getKycCases(), { cases: [] });
    serve(envelope(retired, "kyc-cases", { cases: [{ forged: true }] }));
    await assert.rejects(client.getKycCases(), /after its signing key was retired/);

    servedKeyset = () => ({
      ...keyset(active),
      keys: [publicKey(active, "active"), publicKey(retired, "retired")]
    });
    expireCachedKeyset();
    serve(envelope(retired, "kyc-cases", { cases: [] }, new Date(Date.now() - 120_000).toISOString()));
    await assert.rejects(client.getKycCases(), /after its signing key was retired/);
  });

  it("rejects unsigned extra envelope fields", async () => {
    expireCachedKeyset();
    const key = testKey(7);
    servedKeyset = () => keyset(key);
    const signed = envelope(key, "audit-export", { formatVersion: 1 });
    serve(signed);
    assert.deepEqual(await client.getAuditExport(), signed);
    serve({ ...signed, operatorNote: "unsigned" });
    await assert.rejects(client.getAuditExport(), /malformed/);
    serve({ ...signed, __proto__: { injected: true } });
    assert.deepEqual(await client.getAuditExport(), signed);
    serve(JSON.stringify(signed).replace("{", '{"__proto__":{"injected":true},'));
    await assert.rejects(client.getAuditExport(), /malformed/);
  });

  it("rejects malformed envelope fields", async () => {
    expireCachedKeyset();
    const key = testKey(8);
    servedKeyset = () => keyset(key);
    const signed = envelope(key, "customers", { customers: [] });
    for (const variant of [
      { ...signed, requestId: "" },
      { ...signed, keyVersion: "8" },
      { ...signed, keyVersion: 8.5 },
      { ...signed, issuedAt: Date.now() },
      { ...signed, signature: `${signed.signature}=` },
      { ...signed, signature: `${signed.signature.slice(0, 20)} ${signed.signature.slice(20)}` },
      [signed]
    ]) {
      serve(variant);
      await assert.rejects(client.getCustomers());
    }
    const { requestId: _requestId, ...withoutRequestId } = signed;
    serve(withoutRequestId);
    await assert.rejects(client.getCustomers(), /malformed/);
  });

  it("rejects JSON numbers that canonicalize to a different signed value", async () => {
    expireCachedKeyset();
    const key = testKey(9);
    servedKeyset = () => keyset(key);
    const signed = envelope(key, "customers", { customers: [{ score: null, count: 0 }] });
    serve(signed);
    await client.getCustomers();
    for (const [from, to] of [
      ['"score":null', '"score":1e400'],
      ['"score":null', '"score":-1e400'],
      ['"count":0', '"count":-0'],
      ['"count":0', '"count":-0.0e5']
    ] as const) {
      serve(JSON.stringify(signed).replace(from, to));
      await assert.rejects(client.getCustomers(), /canonical/);
    }
    serve(JSON.stringify(signed).replace('"count":0', '"count":0.0e0'));
    await client.getCustomers();
  });

  it("rejects inconsistent keysets and recovers from failed keyset fetches", async () => {
    expireCachedKeyset();
    const [active, other] = [testKey(10), testKey(11)];
    servedKeyset = () => ({ ...keyset(active), activeKeyId: other.keyId });
    serve(envelope(active, "session", {}));
    await assert.rejects(client.getSession(), /keyset is invalid/);

    servedKeyset = () => ({
      ...keyset(active),
      keys: [publicKey(active, "active"), publicKey({ ...other, keyId: active.keyId }, "retired", new Date().toISOString())]
    });
    await assert.rejects(client.getSession(), /keyset is invalid/);

    servedKeyset = () => keyset(active);
    keysetFailures = 1;
    expireCachedKeyset();
    await assert.rejects(client.getSession(), /Signing keys unavailable/);
    const fetchesBefore = keysetFetches;
    assert.deepEqual(await client.getSession(), {});
    assert.equal(keysetFetches, fetchesBefore + 1);
  });

  it("fetches the checks queue and a single check through the signed path", async () => {
    expireCachedKeyset();
    const provider = new EphemeralSigningKeyProvider(1);
    const signer = new ResponseSigner(provider);
    servedKeyset = () => signer.publicKeyset();

    const requestsBefore = paths.length;
    serve(signer.envelope("checks", { statuses: ["claimed"], checks: [] }, "request-20"));
    assert.deepEqual(await client.getChecks("claimed"), { statuses: ["claimed"], checks: [] });
    assert.equal(paths[requestsBefore], "/bff/api/checks?status=claimed");

    serve(signer.envelope("checks", { statuses: ["claimed"], checks: [] }, "request-21"));
    assert.deepEqual(await client.getChecks(), { statuses: ["claimed"], checks: [] });
    assert.ok(paths.includes("/bff/api/checks"));

    serve(signer.envelope("check:CHK-771312", { id: "CHK-771312" }, "request-22"));
    assert.deepEqual(await client.getCheck("CHK-771312"), { id: "CHK-771312" });
    assert.ok(paths.includes("/bff/api/checks/CHK-771312"));

    serve(signer.envelope("checks", { statuses: [], checks: [{ forged: true }] }, "request-23"));
    await assert.rejects(client.getCheck("CHK-771312"), /resource mismatch/);
  });
});
