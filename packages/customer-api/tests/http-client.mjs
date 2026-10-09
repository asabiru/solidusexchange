import assert from "node:assert/strict";
import { connect } from "node:net";

import { createCustomerApiServer } from "../src/app.mjs";
import { createSyntheticTokenVerifier, mintSyntheticCustomerToken } from "../src/auth.mjs";
import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createSyntheticKycApplicationDirectory } from "../src/kyc.mjs";
import { createSyntheticNotificationDirectory } from "../src/notifications.mjs";
import { createSyntheticProfileDirectory } from "../src/profile.mjs";
import { createSyntheticWalletDirectory } from "../src/wallets.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import { conformanceErrors, createValidator, loadContract } from "./contract-validator.mjs";

export const TEST_KEY = "5".repeat(16) + "a".repeat(16) + "0123456789abcdef".repeat(2);
export const REQUEST_ID = "018f3f8a-6a36-7bd8-86e0-b59cd575d55a";
export const NOW_MS = Date.parse("2026-10-01T12:00:00.000Z");
export const SUBJECT = "syn_cust_00000001";
export const VERIFIED_SUBJECT = "syn_cust_verified01";

export function token({ subject = SUBJECT, ttlSeconds = 900, key = TEST_KEY } = {}) {
  return mintSyntheticCustomerToken({
    key,
    subject,
    expiresAtSeconds: Math.floor(NOW_MS / 1000) + ttlSeconds
  });
}

export function customerHeaders(overrides = {}) {
  const base = {
    Authorization: `Bearer ${token()}`,
    "X-Request-Id": REQUEST_ID,
    "X-Client-Version": "1.0.0",
    "X-Platform": "web"
  };
  return Object.entries({ ...base, ...overrides }).filter(([, value]) => value !== null);
}

export function verifiedCustomerHeaders(overrides = {}) {
  return customerHeaders({
    Authorization: `Bearer ${token({ subject: VERIFIED_SUBJECT })}`,
    ...overrides
  });
}

export async function startTestServer(options = {}) {
  const clock = () => NOW_MS;
  const server = createCustomerApiServer({
    verifier: createSyntheticTokenVerifier({ key: TEST_KEY, clock }),
    kycDirectory: createSyntheticKycDirectory({ [VERIFIED_SUBJECT]: "verified" }),
    walletDirectory: createSyntheticWalletDirectory(),
    notificationDirectory: createSyntheticNotificationDirectory(),
    kycApplicationDirectory: createSyntheticKycApplicationDirectory(),
    profileDirectory: createSyntheticProfileDirectory(),
    rateLimiter: createFixedWindowRateLimiter({ limit: 1000, clock }),
    clock,
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

export function stopServer(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

function parseResponse(buffer, expectBody) {
  const end = buffer.indexOf("\r\n\r\n");
  if (end < 0) {
    return null;
  }
  const [statusLine, ...lines] = buffer.subarray(0, end).toString("latin1").split("\r\n");
  const status = Number(statusLine.split(" ")[1]);
  const headers = lines.map((line) => {
    const separator = line.indexOf(":");
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  });
  const lengthHeader = headers.find(([name]) => name.toLowerCase() === "content-length");
  const length = expectBody && lengthHeader ? Number(lengthHeader[1]) : 0;
  const body = buffer.subarray(end + 4);
  if (body.length < length) {
    return null;
  }
  return { status, headers, body: body.subarray(0, length).toString("utf8") };
}

export function rawTranscript(port, text) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const chunks = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
    socket.on("error", reject);
    socket.setTimeout(2_000, () => socket.destroy());
    socket.write(Buffer.from(text, "latin1"));
  });
}

export function rawExchange(port, text, { expectBody = true, localAddress } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({ port, host: "127.0.0.1", localAddress });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        if (value) {
          resolve(value);
        } else {
          reject(new Error("Incomplete HTTP response"));
        }
      }
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseResponse(buffer, expectBody);
      if (parsed) {
        finish(parsed);
      }
    });
    socket.on("end", () => finish(parseResponse(buffer, expectBody)));
    socket.on("error", reject);
    socket.write(Buffer.from(text, "latin1"));
  });
}

export function request(port, { method = "GET", path, headers = [], localAddress }) {
  const lines = [`${method} ${path} HTTP/1.1`, "Host: 127.0.0.1"];
  for (const [name, value] of headers) {
    lines.push(`${name}: ${value}`);
  }
  return rawExchange(port, `${lines.join("\r\n")}\r\n\r\n`, { expectBody: method !== "HEAD", localAddress });
}

export function header(response, name) {
  const values = response.headers
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);
  return values.length === 1 ? values[0] : values;
}

const contract = loadContract();
const validator = createValidator(contract);

export { contract, validator };

export function assertConforms(method, path, response) {
  assert.deepEqual(conformanceErrors(contract, validator, { method, path, response }), [], `${method} ${path} -> ${response.status}`);
  return response;
}

export async function checkedRequest(port, options) {
  const response = await request(port, options);
  return assertConforms(options.method ?? "GET", options.path, response);
}
