import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticDepositDirectory,
  DEPOSIT_STATUSES,
  validDepositsView
} from "../src/deposits.mjs";
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

const DEPOSITS = "/api/v1/customer/deposits";
const DEPOSIT_ID = /^dep_[0-9a-f]{24}$/u;
const PAYMENT_REFERENCE = /^SIMSBP[0-9A-F]{12}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic deposit directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticDepositDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.deposits));
  for (const deposit of first.deposits) {
    assert.ok(Object.isFrozen(deposit));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.deposits.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const deposit of [...first.deposits, ...other.deposits]) {
    assert.match(deposit.deposit_id, DEPOSIT_ID);
    assert.equal(deposit.asset, "RUB");
    assert.equal(deposit.method, "sbp");
    assert.ok(DEPOSIT_STATUSES.includes(deposit.status));
    for (const field of ["expected_amount", "received_total", "reversed_total"]) {
      assert.match(deposit[field], DECIMAL);
    }
    assert.match(deposit.payment_reference, PAYMENT_REFERENCE);
    assert.match(deposit.created_at, ISO_TIMESTAMP);
    assert.match(deposit.updated_at, ISO_TIMESTAMP);
    assert.ok(Date.parse(deposit.updated_at) >= Date.parse(deposit.created_at));
    assert.equal(deposit.posting, "none");
    // Coherence mirrors the bank simulator's payment events: no money is
    // received while a payment is awaited or after it expires unpaid, a
    // reversal always follows a received payment, and a duplicate doubles
    // the received total.
    const received = Number(deposit.received_total);
    const expected = Number(deposit.expected_amount);
    const reversed = Number(deposit.reversed_total);
    if (deposit.status === "awaiting_payment" || deposit.status === "expired_no_payment") {
      assert.equal(received, 0);
      assert.equal(reversed, 0);
      assert.equal(deposit.updated_at === deposit.created_at, deposit.status === "awaiting_payment");
    } else if (deposit.status === "payment_received") {
      assert.equal(received, expected);
      assert.equal(reversed, 0);
    } else if (deposit.status === "partial_payment") {
      assert.ok(received > 0 && received < expected);
      assert.equal(reversed, 0);
    } else if (deposit.status === "duplicate_payment") {
      assert.equal(received, expected * 2);
      assert.equal(reversed, 0);
    } else {
      assert.equal(received, expected);
      assert.ok(reversed > 0 && reversed <= expected);
    }
  }
});

test("every derived view conforms to the declared DepositsView schema", async () => {
  const directory = createSyntheticDepositDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/DepositsView" }, { ...view }), [], subject);
  }
});

test("synthetic deposit views cover every bank simulator status", async () => {
  const directory = createSyntheticDepositDirectory();
  const seen = new Set();
  for (let index = 0; index < 64 && seen.size < DEPOSIT_STATUSES.length; index += 1) {
    const view = await directory.listFor(`syn_cust_status${String(index).padStart(4, "0")}`);
    for (const deposit of view.deposits) {
      seen.add(deposit.status);
    }
  }
  assert.deepEqual([...seen].sort(), [...DEPOSIT_STATUSES].sort());
});

test("validDepositsView fails closed on directory drift", () => {
  const entry = {
    deposit_id: "dep_0123456789abcdef01234567",
    asset: "RUB",
    method: "sbp",
    status: "payment_received",
    expected_amount: "100.00",
    received_total: "100.00",
    reversed_total: "0.00",
    payment_reference: "SIMSBP0123456789AB",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:20.000Z",
    posting: "none"
  };
  const bad = [
    null,
    "deposits",
    {},
    { mode: "test" },
    { mode: "live", deposits: [] },
    { mode: "test", deposits: null },
    { mode: "test", deposits: [], extra: true },
    { mode: "test", deposits: [{ ...entry, extra: "x" }] },
    { mode: "test", deposits: [{ ...entry, deposit_id: "dep_short" }] },
    { mode: "test", deposits: [{ ...entry, method: "card" }] },
    { mode: "test", deposits: [{ ...entry, status: "confirmed" }] },
    { mode: "test", deposits: [{ ...entry, expected_amount: 100 }] },
    { mode: "test", deposits: [{ ...entry, received_total: "1,234" }] },
    { mode: "test", deposits: [{ ...entry, payment_reference: "PAY-1" }] },
    { mode: "test", deposits: [{ ...entry, created_at: "yesterday" }] },
    { mode: "test", deposits: [{ ...entry, posting: "ledger" }] },
    { mode: "test", deposits: [["dep_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validDepositsView(view), false, JSON.stringify(view));
  }
  assert.equal(validDepositsView({ mode: "test", deposits: [entry] }), true);
});

test("GET /api/v1/customer/deposits returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticDepositDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: DEPOSITS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, deposits: [...expected.deposits] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: DEPOSITS, headers: verifiedCustomerHeaders() });
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
        path: DEPOSITS,
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
      path: DEPOSITS,
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
        path: DEPOSITS,
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
    const response = await checkedRequest(port, { path: DEPOSITS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: DEPOSITS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: DEPOSITS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: DEPOSITS, headers: customerHeaders() })).status, 403);
  });
});

test("deposit and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { depositDirectory: { async listFor() { throw new Error("deposit store exploded: secret=abc"); } } },
    { depositDirectory: { async listFor() { return { deposits: "nope" }; } } },
    { depositDirectory: { async listFor() { return { mode: "test", deposits: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: DEPOSITS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("deposit subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/deposits/",
      "/api/v1/customer/deposits/1",
      "/api/v1/customer/deposits/dep_000000000000000000000001",
      "/api/v1/customer/deposits/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: DEPOSITS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
