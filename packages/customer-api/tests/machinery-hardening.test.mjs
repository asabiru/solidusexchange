import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticTokenVerifier } from "../src/auth.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import { generateUuidV7, isUuidV7 } from "../src/request-id.mjs";
import { validWalletsView } from "../src/wallets.mjs";
import {
  checkedRequest,
  NOW_MS,
  startTestServer,
  stopServer,
  TEST_KEY,
  token,
  verifiedCustomerHeaders
} from "./http-client.mjs";

test("a non-finite verifier clock fails closed instead of skipping the time checks", async () => {
  for (const clock of [() => Number.NaN, () => "never", () => undefined]) {
    const verifier = createSyntheticTokenVerifier({ key: TEST_KEY, clock });
    assert.equal(await verifier.verify(token()), null);
    assert.equal(await verifier.verify(token({ ttlSeconds: -60 })), null);
    assert.equal(await verifier.verify(token({ ttlSeconds: 90_000 })), null);
  }
  const infinite = createSyntheticTokenVerifier({ key: TEST_KEY, clock: () => Number.POSITIVE_INFINITY });
  assert.equal(await infinite.verify(token()), null);
});

test("the verifier TTL bound must be a positive integer", async () => {
  for (const maxTtlSeconds of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3600"]) {
    assert.throws(
      () => createSyntheticTokenVerifier({ key: TEST_KEY, maxTtlSeconds }),
      /TTL/u,
      String(maxTtlSeconds)
    );
  }
  const verifier = createSyntheticTokenVerifier({ key: TEST_KEY, clock: () => NOW_MS, maxTtlSeconds: 60 });
  assert.equal(await verifier.verify(token({ ttlSeconds: 61 })), null);
  assert.notEqual(await verifier.verify(token({ ttlSeconds: 60 })), null);
});

test("the rate limiter window and key bound must be positive integers", () => {
  for (const windowMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "60000"]) {
    assert.throws(() => createFixedWindowRateLimiter({ limit: 1, windowMs }), /window/u, String(windowMs));
  }
  for (const maxKeys of [0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "100"]) {
    assert.throws(() => createFixedWindowRateLimiter({ limit: 1, maxKeys }), /key/u, String(maxKeys));
  }
});

test("a non-finite limiter clock denies with a well-formed retry hint", () => {
  for (const clock of [() => Number.NaN, () => "never", () => undefined]) {
    const limiter = createFixedWindowRateLimiter({ limit: 3, clock });
    for (let index = 0; index < 5; index += 1) {
      assert.deepEqual(limiter.consume("syn_cust_peer"), { allowed: false, retryAfterSeconds: 60 });
    }
  }
});

test("request id generation stays a valid UUIDv7 under a drifting clock", () => {
  for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, NOW_MS + 0.25, -1]) {
    const id = generateUuidV7(nowMs);
    assert.ok(isUuidV7(id), `${String(nowMs)} -> ${id}`);
  }
});

test("the wallets view guard enforces the contract field formats, not only the shape", () => {
  const good = { wallet_id: "syn_wal_0123456789ab", asset: "USDT", available: "12.34", hold: "0.00" };
  assert.equal(validWalletsView({ wallets: [good] }), true);
  const drifted = [
    { ...good, wallet_id: "wal_0123" },
    { ...good, wallet_id: "syn_wal_0123" },
    { ...good, wallet_id: "SYN_WAL_0123456789AB" },
    { ...good, wallet_id: "syn_wal_0123 45" },
    { ...good, asset: "usdt" },
    { ...good, asset: "U" },
    { ...good, asset: "US D" },
    { ...good, available: "soon" },
    { ...good, available: "01.00" },
    { ...good, available: "-1.00" },
    { ...good, available: "1e5" },
    { ...good, available: "+1.00" },
    { ...good, hold: ".5" },
    { ...good, hold: "1." },
    { ...good, hold: "1,00" }
  ];
  for (const wallet of drifted) {
    assert.equal(validWalletsView({ wallets: [wallet] }), false, JSON.stringify(wallet));
  }
});

test("a drifted wallet value answers the 500 envelope instead of serving a non-conforming body", async () => {
  const view = {
    wallets: [{ wallet_id: "syn_wal_0123456789ab", asset: "USDT", available: "soon", hold: "0.00" }]
  };
  const { server, port } = await startTestServer({
    walletDirectory: { async listFor() { return view; } }
  });
  try {
    const response = await checkedRequest(port, {
      path: "/api/v1/customer/wallets",
      headers: verifiedCustomerHeaders()
    });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.ok(!response.body.includes("soon"));
  } finally {
    await stopServer(server);
  }
});
