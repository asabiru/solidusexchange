import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticExchangeOrderDirectory,
  ORDER_PAIRS,
  ORDER_SIDES,
  ORDER_STATUSES,
  ORDER_TYPES,
  validExchangeOrdersView
} from "../src/exchange-orders.mjs";
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

const EXCHANGE_ORDERS = "/api/v1/customer/exchange-orders";
const ORDER_ID = /^ord_[0-9a-f]{24}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const PAIR_DEFS = new Map(ORDER_PAIRS.map((definition) => [definition.pair, definition]));

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic exchange order directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.orders));
  for (const order of first.orders) {
    assert.ok(Object.isFrozen(order));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.orders.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const order of [...first.orders, ...other.orders]) {
    assert.match(order.order_id, ORDER_ID);
    const definition = PAIR_DEFS.get(order.pair);
    assert.ok(definition !== undefined, order.pair);
    assert.equal(order.base_asset, definition.base);
    assert.equal(order.quote_asset, definition.quote);
    assert.ok(ORDER_SIDES.includes(order.side));
    assert.ok(ORDER_TYPES.includes(order.order_type));
    assert.ok(ORDER_STATUSES.includes(order.status));
    assert.match(order.base_amount, DECIMAL);
    assert.match(order.price, DECIMAL);
    assert.match(order.quote_amount, DECIMAL);
    assert.match(order.fee_amount, DECIMAL);
    assert.match(order.total_quote_amount, DECIMAL);
    assert.ok(Number.isSafeInteger(order.fee_bps));
    assert.ok(order.fee_bps >= 0 && order.fee_bps <= 1000);
    assert.match(order.created_at, ISO_TIMESTAMP);
    assert.match(order.updated_at, ISO_TIMESTAMP);
    // Lifecycle coherence mirrors the synthetic book: a resting open order
    // has never changed and a terminal order updates at or after creation.
    const created = Date.parse(order.created_at);
    const updated = Date.parse(order.updated_at);
    assert.ok(updated >= created);
    if (order.status === "open") {
      assert.equal(updated, created);
    }
    assert.equal(order.execution, "not_supported");
    assert.equal(order.posting, "none");
    // Derived amounts recompute against the order's fixed price: the quote
    // leg is the base amount at that price, the fee is charged on it, and
    // the total stays on the customer-unfriendly side.
    assert.ok(Number(order.price) > 0);
    assert.ok(Number(order.fee_amount) > 0);
    if (order.side === "buy") {
      assert.ok(Number(order.total_quote_amount) > Number(order.quote_amount));
    } else {
      assert.ok(Number(order.total_quote_amount) < Number(order.quote_amount));
    }
  }
});

test("every derived view conforms to the declared ExchangeOrdersView schema", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/ExchangeOrdersView" }, { ...view }), [], subject);
  }
});

test("synthetic exchange order views cover every declared pair, side, type and status", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const pairs = new Set();
  const sides = new Set();
  const types = new Set();
  const statuses = new Set();
  for (
    let index = 0;
    index < 192 &&
    (pairs.size < ORDER_PAIRS.length ||
      sides.size < ORDER_SIDES.length ||
      types.size < ORDER_TYPES.length ||
      statuses.size < ORDER_STATUSES.length);
    index += 1
  ) {
    const view = await directory.listFor(`syn_cust_order${String(index).padStart(4, "0")}`);
    for (const order of view.orders) {
      pairs.add(order.pair);
      sides.add(order.side);
      types.add(order.order_type);
      statuses.add(order.status);
    }
  }
  assert.deepEqual([...pairs].sort(), [...ORDER_PAIRS.map((definition) => definition.pair)].sort());
  assert.deepEqual([...sides].sort(), [...ORDER_SIDES].sort());
  assert.deepEqual([...types].sort(), [...ORDER_TYPES].sort());
  assert.deepEqual([...statuses].sort(), [...ORDER_STATUSES].sort());
});

test("validExchangeOrdersView fails closed on directory drift", () => {
  const entry = {
    order_id: "ord_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "buy",
    order_type: "market",
    base_amount: "100.000000",
    price: "90.00000000",
    quote_amount: "9000.00",
    fee_bps: 25,
    fee_amount: "22.50",
    total_quote_amount: "9022.50",
    status: "open",
    created_at: "2026-09-01T00:00:10.000Z",
    updated_at: "2026-09-01T00:00:10.000Z",
    execution: "not_supported",
    posting: "none"
  };
  assert.equal(validExchangeOrdersView({ mode: "test", orders: [entry] }), true);
  const bad = [
    null,
    "orders",
    {},
    { mode: "test" },
    { mode: "live", orders: [] },
    { mode: "test", orders: null },
    { mode: "test", orders: [], extra: true },
    { mode: "test", orders: [{ ...entry, extra: "x" }] },
    { mode: "test", orders: [{ ...entry, order_id: "order_0123456789abcdef01234567" }] },
    { mode: "test", orders: [{ ...entry, pair: "USDT/EUR" }] },
    { mode: "test", orders: [{ ...entry, base_asset: "TON" }] },
    { mode: "test", orders: [{ ...entry, side: "swap" }] },
    { mode: "test", orders: [{ ...entry, order_type: "stop" }] },
    { mode: "test", orders: [{ ...entry, base_amount: 100 }] },
    { mode: "test", orders: [{ ...entry, price: "90,00000000" }] },
    { mode: "test", orders: [{ ...entry, price: "90.001" }] },
    { mode: "test", orders: [{ ...entry, quote_amount: "9000.9" }] },
    { mode: "test", orders: [{ ...entry, quote_amount: "8999.99" }] },
    { mode: "test", orders: [{ ...entry, fee_bps: -1 }] },
    { mode: "test", orders: [{ ...entry, fee_bps: 1001 }] },
    { mode: "test", orders: [{ ...entry, fee_bps: 2.5 }] },
    { mode: "test", orders: [{ ...entry, fee_amount: "-2.26" }] },
    { mode: "test", orders: [{ ...entry, total_quote_amount: "0.00" }] },
    { mode: "test", orders: [{ ...entry, status: "filled" }] },
    { mode: "test", orders: [{ ...entry, status: "open", updated_at: "2026-09-01T00:00:11.000Z" }] },
    { mode: "test", orders: [{ ...entry, status: "cancelled", updated_at: "2026-09-01T00:00:09.000Z" }] },
    { mode: "test", orders: [{ ...entry, created_at: "soon" }] },
    { mode: "test", orders: [{ ...entry, updated_at: "2026-09-01T00:00:10+00:00" }] },
    { mode: "test", orders: [{ ...entry, execution: "supported" }] },
    { mode: "test", orders: [{ ...entry, posting: "ledger" }] },
    { mode: "test", orders: [["ord_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validExchangeOrdersView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/exchange-orders returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticExchangeOrderDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, orders: [...expected.orders] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
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
        path: EXCHANGE_ORDERS,
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
      path: EXCHANGE_ORDERS,
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
        path: EXCHANGE_ORDERS,
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
    const response = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: customerHeaders() })).status, 403);
  });
});

test("exchange order and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { exchangeOrderDirectory: { async listFor() { throw new Error("order store exploded: secret=abc"); } } },
    { exchangeOrderDirectory: { async listFor() { return { orders: "nope" }; } } },
    { exchangeOrderDirectory: { async listFor() { return { mode: "test", orders: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("exchange order subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/exchange-orders/",
      "/api/v1/customer/exchange-orders/1",
      "/api/v1/customer/exchange-orders/ord_000000000000000000000001",
      "/api/v1/customer/exchange-orders/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
