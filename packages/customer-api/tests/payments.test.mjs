import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticPaymentDirectory,
  PAYMENT_STATUSES,
  validPaymentsView
} from "../src/payments.mjs";
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

const PAYMENTS = "/api/v1/customer/payments";
const PAYMENT_ID = /^pay_[0-9a-f]{24}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)\.[0-9]{2}$/u;
const RECIPIENT_REFERENCE = /^recipient_ref_[a-z0-9_]{2,32}$/u;
const PROVIDER_REFERENCE = /^SIMBANK[0-9A-F]{16}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
// Mirrors RAIL_OBSERVED_STATUSES in src/payments.mjs: the bank rail could
// have observed — and therefore referenced — the payment in these states.
const RAIL_OBSERVED = ["processing", "completed", "failed", "reversed"];

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic payment directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticPaymentDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.payments));
  for (const payment of first.payments) {
    assert.ok(Object.isFrozen(payment));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.payments.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const payment of [...first.payments, ...other.payments]) {
    assert.match(payment.payment_id, PAYMENT_ID);
    assert.equal(payment.asset, "RUB");
    assert.equal(payment.method, "sbp");
    assert.ok(PAYMENT_STATUSES.includes(payment.status));
    assert.match(payment.amount, DECIMAL);
    assert.match(payment.fee_amount, DECIMAL);
    assert.match(payment.total_amount, DECIMAL);
    assert.match(payment.recipient_reference, RECIPIENT_REFERENCE);
    // provider_reference mirrors the simulator's bank_transaction_id: it
    // exists exactly when the rail could have observed the payment.
    if (RAIL_OBSERVED.includes(payment.status)) {
      assert.match(payment.provider_reference, PROVIDER_REFERENCE);
    } else {
      assert.equal(payment.provider_reference, null);
    }
    assert.match(payment.created_at, ISO_TIMESTAMP);
    assert.match(payment.updated_at, ISO_TIMESTAMP);
    // Lifecycle coherence mirrors the synthetic book: a resting created
    // instruction has never changed and every later observation updates at
    // or after creation.
    const created = Date.parse(payment.created_at);
    const updated = Date.parse(payment.updated_at);
    assert.ok(updated >= created);
    if (payment.status === "created") {
      assert.equal(updated, created);
    }
    assert.equal(payment.posting, "none");
    // The debited total recomputes exactly as principal plus the rail fee.
    const minor = (value) => BigInt(value.replace(".", ""));
    assert.equal(minor(payment.total_amount), minor(payment.amount) + minor(payment.fee_amount));
    assert.ok(minor(payment.amount) > 0n);
    assert.ok(minor(payment.fee_amount) > 0n);
  }
});

test("every derived view conforms to the declared PaymentsView schema", async () => {
  const directory = createSyntheticPaymentDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/PaymentsView" }, { ...view }), [], subject);
  }
});

test("synthetic payment views cover every declared status and both reference states", async () => {
  const directory = createSyntheticPaymentDirectory();
  const statuses = new Set();
  let referenced = false;
  let unreferenced = false;
  for (
    let index = 0;
    index < 192 && (statuses.size < PAYMENT_STATUSES.length || !referenced || !unreferenced);
    index += 1
  ) {
    const view = await directory.listFor(`syn_cust_pay${String(index).padStart(4, "0")}`);
    for (const payment of view.payments) {
      statuses.add(payment.status);
      if (payment.provider_reference === null) {
        unreferenced = true;
      } else {
        referenced = true;
      }
    }
  }
  assert.deepEqual([...statuses].sort(), [...PAYMENT_STATUSES].sort());
  assert.ok(referenced);
  assert.ok(unreferenced);
});

test("validPaymentsView fails closed on directory drift", () => {
  const entry = {
    payment_id: "pay_0123456789abcdef01234567",
    asset: "RUB",
    method: "sbp",
    status: "completed",
    amount: "500.00",
    fee_amount: "5.00",
    total_amount: "505.00",
    recipient_reference: "recipient_ref_ab12cd34",
    provider_reference: "SIMBANK0123456789ABCDEF",
    created_at: "2026-09-01T00:00:10.000Z",
    updated_at: "2026-09-01T00:05:10.000Z",
    posting: "none"
  };
  assert.equal(validPaymentsView({ mode: "test", payments: [entry] }), true);
  assert.equal(validPaymentsView({ mode: "test", payments: [{ ...entry, status: "created", provider_reference: null, updated_at: entry.created_at }] }), true);
  const bad = [
    null,
    "payments",
    {},
    { mode: "test" },
    { mode: "live", payments: [] },
    { mode: "test", payments: null },
    { mode: "test", payments: [], extra: true },
    { mode: "test", payments: [{ ...entry, extra: "x" }] },
    { mode: "test", payments: [{ ...entry, payment_id: "payment_0123456789abcdef01234567" }] },
    { mode: "test", payments: [{ ...entry, asset: "USD" }] },
    { mode: "test", payments: [{ ...entry, asset: "usdt" }] },
    { mode: "test", payments: [{ ...entry, method: "card" }] },
    { mode: "test", payments: [{ ...entry, amount: 500 }] },
    { mode: "test", payments: [{ ...entry, amount: "500,00" }] },
    { mode: "test", payments: [{ ...entry, amount: "500.0" }] },
    { mode: "test", payments: [{ ...entry, fee_amount: "-5.00" }] },
    { mode: "test", payments: [{ ...entry, fee_amount: "0.00" }] },
    { mode: "test", payments: [{ ...entry, total_amount: "505.01" }] },
    { mode: "test", payments: [{ ...entry, recipient_reference: "ref_ab12cd34" }] },
    { mode: "test", payments: [{ ...entry, provider_reference: null }] },
    { mode: "test", payments: [{ ...entry, provider_reference: "SIMBANK0123456789abcdef" }] },
    { mode: "test", payments: [{ ...entry, provider_reference: "SIMBAN0123456789ABCDEF" }] },
    { mode: "test", payments: [{ ...entry, status: "created" }] },
    { mode: "test", payments: [{ ...entry, status: "settled" }] },
    { mode: "test", payments: [{ ...entry, status: "created", provider_reference: null, updated_at: "2026-09-01T00:05:10.000Z" }] },
    { mode: "test", payments: [{ ...entry, status: "created", provider_reference: null, updated_at: "2026-09-01T00:00:09.000Z" }] },
    { mode: "test", payments: [{ ...entry, created_at: "soon" }] },
    { mode: "test", payments: [{ ...entry, updated_at: "2026-09-01T00:05:10+00:00" }] },
    { mode: "test", payments: [{ ...entry, posting: "ledger" }] },
    { mode: "test", payments: [["pay_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validPaymentsView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/payments returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticPaymentDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: PAYMENTS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, payments: [...expected.payments] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: PAYMENTS, headers: verifiedCustomerHeaders() });
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
        path: PAYMENTS,
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
      path: PAYMENTS,
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
        path: PAYMENTS,
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
    const response = await checkedRequest(port, { path: PAYMENTS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: PAYMENTS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: PAYMENTS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: PAYMENTS, headers: customerHeaders() })).status, 403);
  });
});

test("payment and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { paymentDirectory: { async listFor() { throw new Error("payment store exploded: secret=abc"); } } },
    { paymentDirectory: { async listFor() { return { payments: "nope" }; } } },
    { paymentDirectory: { async listFor() { return { mode: "test", payments: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: PAYMENTS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("payment subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/payments/",
      "/api/v1/customer/payments/1",
      "/api/v1/customer/payments/pay_000000000000000000000001",
      "/api/v1/customer/payments/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: PAYMENTS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
