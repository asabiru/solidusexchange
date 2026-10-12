import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// Shared harness for the dev-stack smoke tests: every service runs on
// 127.0.0.1 with synthetic configuration and a minimal child environment, so
// nothing from the caller's shell (credentials, NODE_ENV, proxies) leaks in.

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const customerApiEntry = `${repoRoot}packages/customer-api/src/server.mjs`;
export const miniappEntry = `${repoRoot}miniapp/.server-dist/server/index.js`;
export const backofficeEntry = `${repoRoot}backoffice/.server-dist/server/index.js`;

const startTimeoutMs = 15_000;
const exitTimeoutMs = 15_000;
const stopTimeoutMs = 5_000;
const envelopeKeys = [
  "issuedAt",
  "keyId",
  "keyVersion",
  "payload",
  "requestId",
  "resource",
  "signature",
  "signatureVersion"
];
// The canonical-JSON and field-shape rules below are kept in parity with the
// backoffice BFF's own envelope verifier (backoffice/src/server/signing.ts):
// the arm must reject every malformed envelope a real consumer would, not
// only bad signatures — a weaker harness verifier lets contract-invalid
// envelopes pass the chain end to end.
const CANONICAL_BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_PAYLOAD_DEPTH = 16;

export function childEnvironment(values) {
  return { PATH: process.env.PATH ?? "", ...values };
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The payload a signature attests must serialize to exactly the canonical
// JSON bytes it claims: anything `JSON.stringify` rewrites (non-finite
// numbers to null, -0 to 0), drops (undefined leaves, sparse arrays) or
// resolves dynamically (accessors, non-plain objects) lets a mutated payload
// keep a valid signature while the consumer reads different data.
function isCanonicalJsonValue(value, depth) {
  if (depth > MAX_PAYLOAD_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value === "string") return true;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isCanonicalJsonValue(value[index], depth + 1)) {
        return false;
      }
    }
    return true;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !isCanonicalJsonValue(descriptor.value, depth + 1)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function launch(entry, env) {
  const child = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    env: childEnvironment(env),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = { stdout: "", stderr: "", exited: false };
  child.once("exit", () => {
    output.exited = true;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output.stderr += chunk;
  });
  return { child, output };
}

export function startService(entry, env, readyPattern) {
  const { child, output } = launch(entry, env);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${entry} did not become ready: ${output.stderr}`));
    }, startTimeoutMs);
    const onData = () => {
      const match = output.stdout.match(readyPattern);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
      resolve({ child, output, match });
    };
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`${entry} exited with ${code} before ready: ${output.stderr}`));
    };
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

export function stopService(service) {
  if (!service || service.output.exited) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    // A child that ignores SIGTERM must never wedge the suite or leak its
    // bound port into later runs: escalate to SIGKILL after a bounded wait.
    const timer = setTimeout(() => {
      service.child.kill("SIGKILL");
    }, stopTimeoutMs);
    service.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    service.child.kill("SIGTERM");
  });
}

/**
 * startService on a freshly probed port with a bounded bind-collision retry:
 * test files run in parallel processes, so the freePort→spawn window can lose
 * the port to a sibling file. Only an EADDRINUSE failure retries — a real
 * startup failure (missing env, crash before ready) surfaces immediately.
 */
export async function startServiceOnFreePort(entry, env, readyPattern, portEnvVar, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    env[portEnvVar] = String(await freePort());
    try {
      return await startService(entry, env, readyPattern);
    } catch (error) {
      lastError = error;
      if (!/EADDRINUSE|address already in use|eaddrinuse/i.test(String(error))) {
        throw error;
      }
    }
  }
  throw lastError;
}

export function runToExit(entry, env) {
  const { child, output } = launch(entry, env);
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), exitTimeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: output.stdout, stderr: output.stderr });
    });
  });
}

export async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

export function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

export function cookieOf(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "session cookie expected");
  return cookie.split(";")[0];
}

export async function readJson(response) {
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  return response.json();
}

export function verifyEnvelope(envelope, keyset) {
  if (!isRecord(envelope)) return false;
  assert.deepEqual(Object.keys(envelope).sort(), envelopeKeys);
  // Field-shape parity with the consumer verifier: a signed envelope whose
  // members are mistyped, empty, or non-canonical is malformed even when the
  // signature itself verifies over the identical canonical message.
  if (
    envelope.signatureVersion !== 1 ||
    typeof envelope.keyId !== "string" ||
    !Number.isSafeInteger(envelope.keyVersion) ||
    envelope.keyVersion < 1 ||
    typeof envelope.issuedAt !== "string" ||
    typeof envelope.requestId !== "string" ||
    envelope.requestId.length === 0 ||
    typeof envelope.resource !== "string" ||
    typeof envelope.signature !== "string" ||
    !CANONICAL_BASE64URL.test(envelope.signature)
  ) {
    return false;
  }
  const signatureBytes = Buffer.from(envelope.signature, "base64url");
  if (signatureBytes.toString("base64url") !== envelope.signature) return false;
  // `issuedAt` must be a canonical ISO instant so lifecycle checks compare
  // the same instant every verifier sees.
  const issuedAtMs = Date.parse(envelope.issuedAt);
  if (!Number.isFinite(issuedAtMs) || new Date(issuedAtMs).toISOString() !== envelope.issuedAt) {
    return false;
  }
  if (!isCanonicalJsonValue(envelope.payload, 0)) return false;
  const key = keyset.keys.find(
    (candidate) => candidate.keyId === envelope.keyId && candidate.version === envelope.keyVersion
  );
  if (!key || key.algorithm !== "Ed25519") return false;
  // Same key lifecycle the consumers enforce: a retired key may only attest
  // envelopes issued before its retirement.
  if (key.status === "retired") {
    const retiredAt = Date.parse(key.retiredAt);
    if (!Number.isFinite(retiredAt) || issuedAtMs > retiredAt) {
      return false;
    }
  }
  const message = JSON.stringify({
    signatureVersion: envelope.signatureVersion,
    keyId: envelope.keyId,
    keyVersion: envelope.keyVersion,
    issuedAt: envelope.issuedAt,
    requestId: envelope.requestId,
    resource: envelope.resource,
    payload: envelope.payload
  });
  return verify(
    null,
    Buffer.from(message),
    createPublicKey({ key: key.publicJwk, format: "jwk" }),
    signatureBytes
  );
}
