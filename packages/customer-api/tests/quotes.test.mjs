import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticQuoteDirectory,
  QUOTE_PAIRS,
  QUOTE_SIDES,
  validQuotesView
} from "../src/quotes.mjs";
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

const QUOTES = "/api/v1/customer/quotes";
const QUOTE_ID = /^qte_[0-9a-f]{24}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const PAIR_DEFS = new Map(QUOTE_PAIRS.map((definition) => [definition.pair, definition]));

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic quote directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticQuoteDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.quotes));
  for (const quote of first.quotes) {
    assert.ok(Object.isFrozen(quote));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.quotes.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const quote of [...first.quotes, ...other.quotes]) {
    assert.match(quote.quote_id, QUOTE_ID);
    const definition = PAIR_DEFS.get(quote.pair);
    assert.ok(definition !== undefined, quote.pair);
    assert.equal(quote.base_asset, definition.base);
    assert.equal(quote.quote_asset, definition.quote);
    assert.ok(QUOTE_SIDES.includes(quote.side));
    assert.equal(quote.rounding, quote.side === "buy" ? "up" : "down");
    assert.match(quote.base_amount, DECIMAL);
    assert.match(quote.mid_price, DECIMAL);
    assert.match(quote.price, DECIMAL);
    assert.match(quote.quote_amount, DECIMAL);
    assert.match(quote.fee_amount, DECIMAL);
    assert.match(quote.total_quote_amount, DECIMAL);
    assert.ok(Number.isSafeInteger(quote.spread_bps));
    assert.ok(quote.spread_bps >= 0 && quote.spread_bps <= 1000);
    assert.ok(Number.isSafeInteger(quote.fee_bps));
    assert.ok(quote.fee_bps >= 0 && quote.fee_bps <= 1000);
    assert.ok(Number.isSafeInteger(quote.ttl_seconds));
    assert.ok(quote.ttl_seconds >= 1 && quote.ttl_seconds <= 300);
    assert.match(quote.price_observed_at, ISO_TIMESTAMP);
    assert.match(quote.issued_at, ISO_TIMESTAMP);
    assert.match(quote.expires_at, ISO_TIMESTAMP);
    // Lifecycle coherence mirrors the simulator's signed quote: the record
    // expires exactly ttl_seconds after issuance and the price observation
    // never postdates issuance.
    const observed = Date.parse(quote.price_observed_at);
    const issued = Date.parse(quote.issued_at);
    const expires = Date.parse(quote.expires_at);
    assert.equal(expires - issued, quote.ttl_seconds * 1_000);
    assert.ok(observed <= issued);
    assert.equal(quote.status, "indicative");
    assert.equal(quote.execution, "not_supported");
    assert.equal(quote.posting, "none");
    // Derived amounts recompute against the mid and the side-adjusted price:
    // the buy price lands above the mid, the sell price below it, and the
    // total stays on the customer-unfriendly side of the quote amount.
    assert.ok(Number(quote.mid_price) > 0);
    if (quote.side === "buy") {
      assert.ok(Number(quote.price) > Number(quote.mid_price));
      assert.ok(Number(quote.total_quote_amount) > Number(quote.quote_amount));
    } else {
      assert.ok(Number(quote.price) < Number(quote.mid_price));
      assert.ok(Number(quote.total_quote_amount) < Number(quote.quote_amount));
    }
    assert.ok(Number(quote.fee_amount) > 0);
  }
});

test("every derived view conforms to the declared QuotesView schema", async () => {
  const directory = createSyntheticQuoteDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/QuotesView" }, { ...view }), [], subject);
  }
});

test("synthetic quote views cover every declared pair and side", async () => {
  const directory = createSyntheticQuoteDirectory();
  const pairs = new Set();
  const sides = new Set();
  for (let index = 0; index < 96 && (pairs.size < QUOTE_PAIRS.length || sides.size < QUOTE_SIDES.length); index += 1) {
    const view = await directory.listFor(`syn_cust_quote${String(index).padStart(4, "0")}`);
    for (const quote of view.quotes) {
      pairs.add(quote.pair);
      sides.add(quote.side);
    }
  }
  assert.deepEqual([...pairs].sort(), [...QUOTE_PAIRS.map((definition) => definition.pair)].sort());
  assert.deepEqual([...sides].sort(), [...QUOTE_SIDES].sort());
});

test("validQuotesView fails closed on directory drift", () => {
  const entry = {
    quote_id: "qte_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "buy",
    base_amount: "100.000000",
    mid_price: "90.00000000",
    price: "90.09000000",
    spread_bps: 20,
    fee_bps: 25,
    quote_amount: "9009.00",
    fee_amount: "22.53",
    total_quote_amount: "9031.53",
    rounding: "up",
    price_observed_at: "2026-09-01T00:00:02.000Z",
    issued_at: "2026-09-01T00:00:10.000Z",
    expires_at: "2026-09-01T00:00:40.000Z",
    ttl_seconds: 30,
    status: "indicative",
    execution: "not_supported",
    posting: "none"
  };
  assert.equal(validQuotesView({ mode: "test", quotes: [entry] }), true);
  const bad = [
    null,
    "quotes",
    {},
    { mode: "test" },
    { mode: "live", quotes: [] },
    { mode: "test", quotes: null },
    { mode: "test", quotes: [], extra: true },
    { mode: "test", quotes: [{ ...entry, extra: "x" }] },
    { mode: "test", quotes: [{ ...entry, quote_id: "quote_0123456789abcdef01234567" }] },
    { mode: "test", quotes: [{ ...entry, pair: "USDT/EUR" }] },
    { mode: "test", quotes: [{ ...entry, base_asset: "TON" }] },
    { mode: "test", quotes: [{ ...entry, side: "swap" }] },
    { mode: "test", quotes: [{ ...entry, side: "sell" }] },
    { mode: "test", quotes: [{ ...entry, base_amount: 100 }] },
    { mode: "test", quotes: [{ ...entry, mid_price: "90,00000000" }] },
    { mode: "test", quotes: [{ ...entry, price: "90.001" }] },
    { mode: "test", quotes: [{ ...entry, spread_bps: -1 }] },
    { mode: "test", quotes: [{ ...entry, spread_bps: 1001 }] },
    { mode: "test", quotes: [{ ...entry, fee_bps: 2.5 }] },
    { mode: "test", quotes: [{ ...entry, quote_amount: "9000.9" }] },
    { mode: "test", quotes: [{ ...entry, fee_amount: "-2.26" }] },
    { mode: "test", quotes: [{ ...entry, total_quote_amount: "0.00" }] },
    { mode: "test", quotes: [{ ...entry, rounding: "down" }] },
    { mode: "test", quotes: [{ ...entry, price_observed_at: "soon" }] },
    { mode: "test", quotes: [{ ...entry, expires_at: "2026-09-01T00:00:40+00:00" }] },
    { mode: "test", quotes: [{ ...entry, ttl_seconds: 31 }] },
    { mode: "test", quotes: [{ ...entry, ttl_seconds: 0 }] },
    { mode: "test", quotes: [{ ...entry, status: "executed" }] },
    { mode: "test", quotes: [{ ...entry, execution: "supported" }] },
    { mode: "test", quotes: [{ ...entry, posting: "ledger" }] },
    { mode: "test", quotes: [["qte_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validQuotesView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/quotes returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticQuoteDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: QUOTES, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, quotes: [...expected.quotes] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: QUOTES, headers: verifiedCustomerHeaders() });
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
        path: QUOTES,
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
      path: QUOTES,
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
        path: QUOTES,
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
    const response = await checkedRequest(port, { path: QUOTES, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: QUOTES, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: QUOTES, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: QUOTES, headers: customerHeaders() })).status, 403);
  });
});

test("quote and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { quoteDirectory: { async listFor() { throw new Error("quote store exploded: secret=abc"); } } },
    { quoteDirectory: { async listFor() { return { quotes: "nope" }; } } },
    { quoteDirectory: { async listFor() { return { mode: "test", quotes: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: QUOTES, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("quote subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/quotes/",
      "/api/v1/customer/quotes/1",
      "/api/v1/customer/quotes/qte_000000000000000000000001",
      "/api/v1/customer/quotes/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: QUOTES, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
