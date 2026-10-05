import assert from "node:assert/strict";
import test from "node:test";

import {
  createDenyAllVerifier,
  createSyntheticTokenVerifier,
  mintSyntheticCustomerToken,
  parseBearerAuthorization
} from "../src/auth.mjs";
import { loadConfig } from "../src/config.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import { generateUuidV7, isUuidV7 } from "../src/request-id.mjs";
import { startCustomerApi } from "../src/server.mjs";
import { NOW_MS, SUBJECT, TEST_KEY, token } from "./http-client.mjs";

const SYNTHETIC = { CUSTOMER_API_DEV_AUTH: "synthetic", CUSTOMER_API_DEV_TOKEN_KEY: TEST_KEY };

test("deny-all is the default verifier and rejects everything", async () => {
  const config = loadConfig({});
  assert.equal(config.authMode, "deny-all");
  assert.equal(config.devTokenKey, null);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8790);
  assert.equal(await createDenyAllVerifier().verify(token()), null);
});

test("synthetic auth requires the explicit flag and a 32-byte hex key", () => {
  assert.equal(loadConfig(SYNTHETIC).authMode, "synthetic-dev");
  for (const value of ["true", "1", "SYNTHETIC", "synthetic ", "oidc"]) {
    assert.throws(() => loadConfig({ ...SYNTHETIC, CUSTOMER_API_DEV_AUTH: value }), /CUSTOMER_API_DEV_AUTH/u);
  }
  for (const key of [undefined, "", "a".repeat(63), "A".repeat(64), "g".repeat(64), "a".repeat(65)]) {
    assert.throws(() => loadConfig({ ...SYNTHETIC, CUSTOMER_API_DEV_TOKEN_KEY: key }), /CUSTOMER_API_DEV_TOKEN_KEY/u);
  }
  assert.throws(() => loadConfig({ CUSTOMER_API_DEV_TOKEN_KEY: TEST_KEY }), /requires CUSTOMER_API_DEV_AUTH/u);
});

test("configuration refuses production and non-loopback binds", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /dev-only/u);
  assert.throws(() => loadConfig({ ...SYNTHETIC, NODE_ENV: "production" }), /dev-only/u);
  for (const host of ["0.0.0.0", "::", "localhost", "127.0.0.2", "::ffff:127.0.0.1", "10.0.0.1", "", " 127.0.0.1"]) {
    assert.throws(() => loadConfig({ ...SYNTHETIC, CUSTOMER_API_HOST: host }), /loopback/u, host);
    assert.throws(() => loadConfig({ CUSTOMER_API_HOST: host }), /loopback/u, host);
  }
  assert.equal(loadConfig({ CUSTOMER_API_HOST: "::1" }).host, "::1");
});

test("port and rate limit settings are strict integers", () => {
  for (const port of ["-1", "65536", "08790", "8790.0", "abc", ""]) {
    assert.throws(() => loadConfig({ CUSTOMER_API_PORT: port }), /CUSTOMER_API_PORT/u);
  }
  assert.equal(loadConfig({ CUSTOMER_API_PORT: "0" }).port, 0);
  for (const limit of ["0", "-5", "1.5", "100000", ""]) {
    assert.throws(() => loadConfig({ CUSTOMER_API_RATE_LIMIT_PER_MINUTE: limit }), /RATE_LIMIT/u);
  }
  assert.equal(loadConfig({ CUSTOMER_API_RATE_LIMIT_PER_MINUTE: "5" }).rateLimitPerMinute, 5);
});

test("startCustomerApi binds only to loopback with the configured verifier", async () => {
  for (const env of [{ CUSTOMER_API_PORT: "0" }, { ...SYNTHETIC, CUSTOMER_API_PORT: "0" }]) {
    const { server, address, verifierKind } = await startCustomerApi(loadConfig(env));
    try {
      assert.equal(address.address, "127.0.0.1");
      assert.equal(verifierKind, env.CUSTOMER_API_DEV_AUTH ? "synthetic-dev" : "deny-all");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("synthetic verifier returns a customer principal for a valid token", async () => {
  const verifier = createSyntheticTokenVerifier({ key: TEST_KEY, clock: () => NOW_MS });
  const principal = await verifier.verify(token());
  assert.deepEqual({ ...principal, scopes: [...principal.scopes] }, {
    subject: SUBJECT,
    actorType: "customer",
    scopes: ["customer.session.read", "customer.capabilities.read"],
    expiresAt: "2026-10-01T12:15:00.000Z"
  });
  assert.ok(Object.isFrozen(principal));
});

test("synthetic verifier rejects tampering, expiry and over-long lifetimes", async () => {
  const verifier = createSyntheticTokenVerifier({ key: TEST_KEY, clock: () => NOW_MS });
  const valid = token();
  const [prefix, subject, expires, signature] = valid.split(".");
  const candidates = [
    `${prefix}.syn_cust_00000002.${expires}.${signature}`,
    `${prefix}.${subject}.${Number(expires) + 1}.${signature}`,
    `${prefix}.${subject}.${expires}.${"0".repeat(64)}`,
    `${prefix}.${subject}.${expires}`,
    `${valid}.extra`,
    token({ ttlSeconds: 0 }),
    token({ ttlSeconds: 3601 }),
    token({ key: "c".repeat(64) }),
    null,
    42,
    "x".repeat(161)
  ];
  for (const candidate of candidates) {
    assert.equal(await verifier.verify(candidate), null, String(candidate));
  }
});

test("minting validates key, subject and expiry", () => {
  const base = { key: TEST_KEY, subject: SUBJECT, expiresAtSeconds: 1_800_000_000 };
  assert.match(mintSyntheticCustomerToken(base), /^scdev1\.syn_cust_00000001\.1800000000\.[0-9a-f]{64}$/u);
  assert.throws(() => mintSyntheticCustomerToken({ ...base, key: "short" }), /key/u);
  assert.throws(() => createSyntheticTokenVerifier({ key: "short" }), /key/u);
  for (const subject of ["customer@example.invalid", "syn_cust_short", "SYN_CUST_00000001", "syn_cust_00000001.x"]) {
    assert.throws(() => mintSyntheticCustomerToken({ ...base, subject }), /subject/u);
  }
  for (const expiresAtSeconds of [1.5, 99, 10_000_000_000, Number.NaN]) {
    assert.throws(() => mintSyntheticCustomerToken({ ...base, expiresAtSeconds }), /expiry/u);
  }
});

test("bearer parsing is strict", () => {
  assert.equal(parseBearerAuthorization("Bearer abc.def"), "abc.def");
  assert.equal(parseBearerAuthorization("BEARER abc"), "abc");
  for (const value of [null, "", "Bearer", "Bearer  abc", "Bearer abc def", "Token abc", "Bearer a\u00e9", "Bearer a=b"]) {
    assert.equal(parseBearerAuthorization(value), null, String(value));
  }
});

test("fixed-window rate limiter resets and fails closed when full", () => {
  let now = 0;
  const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 10_000, clock: () => now, maxKeys: 2 });
  assert.deepEqual(limiter.consume("a"), { allowed: true });
  assert.deepEqual(limiter.consume("a"), { allowed: false, retryAfterSeconds: 10 });
  now = 9_500;
  assert.deepEqual(limiter.consume("a"), { allowed: false, retryAfterSeconds: 1 });
  assert.deepEqual(limiter.consume("b"), { allowed: true });
  assert.equal(limiter.consume("c").allowed, false);
  now = 10_000;
  assert.deepEqual(limiter.consume("c"), { allowed: true });
  assert.throws(() => createFixedWindowRateLimiter({ limit: 0 }), /positive/u);
});

test("generated request IDs are UUIDv7 and encode the timestamp", () => {
  const id = generateUuidV7(NOW_MS);
  assert.ok(isUuidV7(id));
  assert.equal(Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16), NOW_MS);
  assert.notEqual(generateUuidV7(NOW_MS), id);
});
