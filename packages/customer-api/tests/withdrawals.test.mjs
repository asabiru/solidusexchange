import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticWithdrawalDirectory,
  validWithdrawalsView,
  WITHDRAWAL_STATUSES
} from "../src/withdrawals.mjs";
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

const WITHDRAWALS = "/api/v1/customer/withdrawals";
const WITHDRAWAL_ID = /^wdr_[0-9a-f]{24}$/u;
const LEG_ID = /^wdl_[0-9a-f]{24}$/u;
const DESTINATION_REFERENCE = /^destination_ref_[a-z0-9_]{2,32}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
// Asset/network pairs and scales mirror the custody-dev-v1 testnet allowlist
// in packages/custody-core/custody-policy.json.
const ALLOWED_PAIRS = new Map([
  ["TON", new Set(["TON_TESTNET"])],
  ["USDT", new Set(["TON_TESTNET", "TRON_TESTNET"])]
]);
const INTENT_TTL_MS = 300_000;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic withdrawal directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticWithdrawalDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.withdrawals));
  for (const withdrawal of first.withdrawals) {
    assert.ok(Object.isFrozen(withdrawal));
    assert.ok(Object.isFrozen(withdrawal.legs));
    for (const leg of withdrawal.legs) {
      assert.ok(Object.isFrozen(leg));
    }
  }
  assert.equal(first.mode, "test");
  assert.ok(first.withdrawals.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const withdrawal of [...first.withdrawals, ...other.withdrawals]) {
    assert.match(withdrawal.withdrawal_id, WITHDRAWAL_ID);
    assert.ok(ALLOWED_PAIRS.get(withdrawal.asset)?.has(withdrawal.network), `${withdrawal.asset}/${withdrawal.network}`);
    assert.ok(WITHDRAWAL_STATUSES.includes(withdrawal.status));
    assert.match(withdrawal.amount, DECIMAL);
    assert.match(withdrawal.fee_amount, DECIMAL);
    assert.match(withdrawal.destination_reference, DESTINATION_REFERENCE);
    assert.match(withdrawal.created_at, ISO_TIMESTAMP);
    assert.match(withdrawal.updated_at, ISO_TIMESTAMP);
    assert.match(withdrawal.expires_at, ISO_TIMESTAMP);
    assert.equal(withdrawal.posting, "none");
    // The legs are the declared out-movements the customer sees: one leg for
    // the requested amount and one for the fee, always in the withdrawal's
    // own asset.
    assert.equal(withdrawal.legs.length, 2);
    assert.equal(withdrawal.legs[0].amount, withdrawal.amount);
    assert.equal(withdrawal.legs[1].amount, withdrawal.fee_amount);
    const legIds = new Set();
    for (const leg of withdrawal.legs) {
      assert.match(leg.leg_id, LEG_ID);
      assert.equal(leg.asset, withdrawal.asset);
      assert.equal(leg.direction, "out");
      legIds.add(leg.leg_id);
    }
    assert.equal(legIds.size, 2);
    // Lifecycle coherence mirrors the custody intent: a drafted intent has no
    // activity yet, in-flight steps resolve inside the intent TTL, an expired
    // intent ends at its deadline and a confirmed broadcast lands after the
    // intent window closes.
    const created = Date.parse(withdrawal.created_at);
    const updated = Date.parse(withdrawal.updated_at);
    const expires = Date.parse(withdrawal.expires_at);
    assert.equal(expires - created, INTENT_TTL_MS);
    if (withdrawal.status === "draft") {
      assert.equal(updated, created);
    } else if (withdrawal.status === "expired") {
      assert.equal(updated, expires);
    } else if (withdrawal.status === "confirmed") {
      assert.ok(updated > expires);
    } else {
      assert.ok(created < updated && updated < expires, withdrawal.status);
    }
    // A fee is a fraction of the requested amount, never the whole thing.
    assert.ok(Number(withdrawal.fee_amount) > 0);
    assert.ok(Number(withdrawal.fee_amount) < Number(withdrawal.amount));
  }
});

test("every derived view conforms to the declared WithdrawalsView schema", async () => {
  const directory = createSyntheticWithdrawalDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/WithdrawalsView" }, { ...view }), [], subject);
  }
});

test("synthetic withdrawal views cover every intent lifecycle status", async () => {
  const directory = createSyntheticWithdrawalDirectory();
  const seen = new Set();
  for (let index = 0; index < 96 && seen.size < WITHDRAWAL_STATUSES.length; index += 1) {
    const view = await directory.listFor(`syn_cust_status${String(index).padStart(4, "0")}`);
    for (const withdrawal of view.withdrawals) {
      seen.add(withdrawal.status);
    }
  }
  assert.deepEqual([...seen].sort(), [...WITHDRAWAL_STATUSES].sort());
});

test("validWithdrawalsView fails closed on directory drift", () => {
  const entry = {
    withdrawal_id: "wdr_0123456789abcdef01234567",
    asset: "USDT",
    network: "TON_TESTNET",
    status: "unsigned_intent_ready",
    amount: "350.000000",
    fee_amount: "1.000000",
    destination_reference: "destination_ref_0123456789abcdef",
    legs: [
      { leg_id: "wdl_0123456789abcdef01234567", asset: "USDT", amount: "350.000000", direction: "out" },
      { leg_id: "wdl_89abcdef0123456701234567", asset: "USDT", amount: "1.000000", direction: "out" }
    ],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:01:20.000Z",
    expires_at: "2026-09-01T00:05:00.000Z",
    posting: "none"
  };
  const bad = [
    null,
    "withdrawals",
    {},
    { mode: "test" },
    { mode: "live", withdrawals: [] },
    { mode: "test", withdrawals: null },
    { mode: "test", withdrawals: [], extra: true },
    { mode: "test", withdrawals: [{ ...entry, extra: "x" }] },
    { mode: "test", withdrawals: [{ ...entry, withdrawal_id: "wdl_0123456789abcdef01234567" }] },
    { mode: "test", withdrawals: [{ ...entry, network: "TON_MAINNET" }] },
    { mode: "test", withdrawals: [{ ...entry, asset: "TON", network: "TRON_TESTNET" }] },
    { mode: "test", withdrawals: [{ ...entry, asset: "EUR" }] },
    { mode: "test", withdrawals: [{ ...entry, status: "paid" }] },
    { mode: "test", withdrawals: [{ ...entry, amount: 350 }] },
    { mode: "test", withdrawals: [{ ...entry, fee_amount: "1,000" }] },
    { mode: "test", withdrawals: [{ ...entry, destination_reference: "addr_123" }] },
    { mode: "test", withdrawals: [{ ...entry, legs: [] }] },
    { mode: "test", withdrawals: [{ ...entry, legs: [...entry.legs].reverse() }] },
    { mode: "test", withdrawals: [{ ...entry, legs: [entry.legs[0], { ...entry.legs[1], direction: "in" }] }] },
    { mode: "test", withdrawals: [{ ...entry, legs: [entry.legs[0], { ...entry.legs[1], asset: "TON" }] }] },
    { mode: "test", withdrawals: [{ ...entry, legs: [entry.legs[0], { ...entry.legs[1], extra: 1 }] }] },
    { mode: "test", withdrawals: [{ ...entry, created_at: "yesterday" }] },
    { mode: "test", withdrawals: [{ ...entry, expires_at: "2026-09-01T00:05:00+00:00" }] },
    { mode: "test", withdrawals: [{ ...entry, posting: "ledger" }] },
    { mode: "test", withdrawals: [["wdr_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validWithdrawalsView(view), false, JSON.stringify(view));
  }
  assert.equal(validWithdrawalsView({ mode: "test", withdrawals: [entry] }), true);
});

test("GET /api/v1/customer/withdrawals returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticWithdrawalDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: WITHDRAWALS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, withdrawals: [...expected.withdrawals] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: WITHDRAWALS, headers: verifiedCustomerHeaders() });
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
        path: WITHDRAWALS,
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
      path: WITHDRAWALS,
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
        path: WITHDRAWALS,
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
    const response = await checkedRequest(port, { path: WITHDRAWALS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: WITHDRAWALS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: WITHDRAWALS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: WITHDRAWALS, headers: customerHeaders() })).status, 403);
  });
});

test("withdrawal and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { withdrawalDirectory: { async listFor() { throw new Error("withdrawal store exploded: secret=abc"); } } },
    { withdrawalDirectory: { async listFor() { return { withdrawals: "nope" }; } } },
    { withdrawalDirectory: { async listFor() { return { mode: "test", withdrawals: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: WITHDRAWALS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("withdrawal subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/withdrawals/",
      "/api/v1/customer/withdrawals/1",
      "/api/v1/customer/withdrawals/wdr_000000000000000000000001",
      "/api/v1/customer/withdrawals/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: WITHDRAWALS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
