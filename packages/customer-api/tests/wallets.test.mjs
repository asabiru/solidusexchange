import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticWalletDirectory,
  validWalletsView,
  WALLET_ASSETS
} from "../src/wallets.mjs";
import {
  checkedRequest,
  customerHeaders,
  header,
  NOW_MS,
  REQUEST_ID,
  startTestServer,
  stopServer,
  SUBJECT,
  token,
  validator,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const WALLETS = "/api/v1/customer/wallets";
const WALLET_ID = /^syn_wal_[a-z0-9]{8,32}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const ASSET = /^[A-Z0-9]{2,16}$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic wallet directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticWalletDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.wallets));
  for (const wallet of first.wallets) {
    assert.ok(Object.isFrozen(wallet));
  }
  assert.deepEqual(first.wallets.map((wallet) => wallet.asset), WALLET_ASSETS.map(({ code }) => code));
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const wallet of [...first.wallets, ...other.wallets]) {
    assert.match(wallet.wallet_id, WALLET_ID);
    assert.match(wallet.asset, ASSET);
    assert.match(wallet.available, DECIMAL);
    assert.match(wallet.hold, DECIMAL);
  }
});

test("every derived view conforms to the declared WalletsView schema", async () => {
  const directory = createSyntheticWalletDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/WalletsView" }, { ...view }), [], subject);
  }
});

test("validWalletsView fails closed on directory drift", () => {
  const bad = [
    null,
    "wallets",
    {},
    { wallets: null },
    { wallets: [], extra: true },
    { wallets: [{ wallet_id: "syn_wal_1", asset: "RUB", available: "1.00", hold: "0.00", extra: "x" }] },
    { wallets: [{ wallet_id: "syn_wal_1", asset: "RUB", available: "1.00" }] },
    { wallets: [{ wallet_id: "syn_wal_1", asset: "RUB", available: 1, hold: "0.00" }] },
    { wallets: [["syn_wal_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validWalletsView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/wallets returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticWalletDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: WALLETS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { wallets: [...expected.wallets] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: WALLETS, headers: verifiedCustomerHeaders() });
    assert.equal(repeat.body, response.body);
  });
});

test("unverified and pending customers are denied with the 403 envelope", async () => {
  const kycDirectory = createSyntheticKycDirectory({
    [VERIFIED_SUBJECT]: "verified",
    syn_cust_pending01: "pending"
  });
  await withServer({ kycDirectory }, async (port) => {
    for (const subject of [SUBJECT, "syn_cust_pending01", "syn_cust_unknown01"]) {
      const response = await checkedRequest(port, {
        path: WALLETS,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 403, subject);
      const body = JSON.parse(response.body);
      assert.equal(body.code, "CAPABILITY_DENIED");
      assert.equal(body.request_id, REQUEST_ID);
      assert.deepEqual(body.details, {});
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
    }
    const verified = await checkedRequest(port, {
      path: WALLETS,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(verified.status, 200);
  });
});

test("unauthenticated and non-customer tokens are rejected like the sibling reads", async () => {
  await withServer({}, async (port) => {
    const valid = token({ subject: VERIFIED_SUBJECT });
    const rejected = [
      null,
      "Bearer",
      `Bearer ${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, key: "b".repeat(64) })}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, ttlSeconds: 0 })}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, ttlSeconds: 3601 })}`,
      `Bearer ${valid.replace("scdev1", "scdev2")}`
    ];
    for (const value of rejected) {
      const response = await checkedRequest(port, {
        path: WALLETS,
        headers: verifiedCustomerHeaders({ Authorization: value })
      });
      assert.equal(response.status, 401, String(value));
      assert.equal(JSON.parse(response.body).code, "AUTHENTICATION_REQUIRED");
      assert.equal(header(response, "www-authenticate"), "Bearer");
    }
  });
  const operator = {
    async verify() {
      return { subject: "syn_operator_1", actorType: "operator", scopes: [], expiresAt: "2026-10-01T13:00:00.000Z" };
    }
  };
  await withServer({ verifier: operator }, async (port) => {
    const response = await checkedRequest(port, { path: WALLETS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: WALLETS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: WALLETS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: WALLETS, headers: customerHeaders() })).status, 403);
  });
});

test("wallet and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { walletDirectory: { async listFor() { throw new Error("wallet store exploded: secret=abc"); } } },
    { walletDirectory: { async listFor() { return { wallets: "nope" }; } } },
    { walletDirectory: { async listFor() { return { wallets: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: WALLETS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("wallet subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/wallets/",
      "/api/v1/customer/wallets/1",
      "/api/v1/customer/wallets/syn_wal_000000000001",
      "/api/v1/customer/wallets/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: WALLETS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
