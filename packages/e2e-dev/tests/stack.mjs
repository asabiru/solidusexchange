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
    service.child.once("exit", () => resolve());
    service.child.kill("SIGTERM");
  });
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
  assert.deepEqual(Object.keys(envelope).sort(), envelopeKeys);
  assert.equal(envelope.signatureVersion, 1);
  const key = keyset.keys.find(
    (candidate) => candidate.keyId === envelope.keyId && candidate.version === envelope.keyVersion
  );
  if (!key) return false;
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
    Buffer.from(envelope.signature, "base64url")
  );
}
