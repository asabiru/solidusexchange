import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  CARD_BRANDS,
  CARD_KINDS,
  CARD_STATUSES,
  createSyntheticCardDirectory,
  validCardsView
} from "../src/cards.mjs";
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

const CARDS = "/api/v1/customer/cards";
const CARD_ID = /^crd_[0-9a-f]{24}$/u;
const LAST4 = /^[0-9]{4}$/u;
const TOKEN_REFERENCE = /^tok_[0-9a-f]{24}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)\.[0-9]{2}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic card directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticCardDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.cards));
  for (const card of first.cards) {
    assert.ok(Object.isFrozen(card));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.cards.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const card of [...first.cards, ...other.cards]) {
    assert.match(card.card_id, CARD_ID);
    assert.ok(CARD_BRANDS.includes(card.brand));
    assert.ok(CARD_KINDS.includes(card.kind));
    assert.ok(CARD_STATUSES.includes(card.status));
    // The only PAN-adjacent identifier a customer read may carry is the
    // masked last4 plus the tokenized reference — never a card number.
    assert.match(card.last4, LAST4);
    assert.match(card.token_reference, TOKEN_REFERENCE);
    assert.equal(card.asset, "RUB");
    assert.match(card.monthly_limit, DECIMAL);
    assert.ok(BigInt(card.monthly_limit.replace(".", "")) > 0n);
    assert.match(card.created_at, ISO_TIMESTAMP);
    assert.match(card.expires_at, ISO_TIMESTAMP);
    assert.match(card.updated_at, ISO_TIMESTAMP);
    // Lifecycle coherence mirrors the synthetic book: a card cannot expire
    // before issuance, a resting unactivated card has never changed, an
    // expired card last changed exactly at its expiry and every other
    // observation updates strictly after creation.
    const created = Date.parse(card.created_at);
    const expires = Date.parse(card.expires_at);
    const updated = Date.parse(card.updated_at);
    assert.ok(expires > created);
    if (card.status === "pending_activation") {
      assert.equal(updated, created);
    } else if (card.status === "expired") {
      assert.equal(updated, expires);
    } else {
      assert.ok(updated > created);
    }
    assert.equal(card.posting, "none");
  }
});

test("every derived view conforms to the declared CardsView schema", async () => {
  const directory = createSyntheticCardDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/CardsView" }, { ...view }), [], subject);
  }
});

test("synthetic card views cover every declared status, brand and kind", async () => {
  const directory = createSyntheticCardDirectory();
  const statuses = new Set();
  const brands = new Set();
  const kinds = new Set();
  for (
    let index = 0;
    index < 192 && (statuses.size < CARD_STATUSES.length || brands.size < CARD_BRANDS.length || kinds.size < CARD_KINDS.length);
    index += 1
  ) {
    const view = await directory.listFor(`syn_cust_crd${String(index).padStart(4, "0")}`);
    for (const card of view.cards) {
      statuses.add(card.status);
      brands.add(card.brand);
      kinds.add(card.kind);
    }
  }
  assert.deepEqual([...statuses].sort(), [...CARD_STATUSES].sort());
  assert.deepEqual([...brands].sort(), [...CARD_BRANDS].sort());
  assert.deepEqual([...kinds].sort(), [...CARD_KINDS].sort());
});

test("validCardsView fails closed on directory drift", () => {
  const entry = {
    card_id: "crd_0123456789abcdef01234567",
    brand: "visa",
    kind: "virtual",
    status: "active",
    last4: "1234",
    token_reference: "tok_0123456789abcdef01234567",
    asset: "RUB",
    monthly_limit: "25000.00",
    created_at: "2026-09-01T00:00:10.000Z",
    expires_at: "2029-09-01T00:00:10.000Z",
    updated_at: "2026-09-01T00:05:10.000Z",
    posting: "none"
  };
  assert.equal(validCardsView({ mode: "test", cards: [entry] }), true);
  assert.equal(
    validCardsView({ mode: "test", cards: [{ ...entry, status: "pending_activation", updated_at: entry.created_at }] }),
    true
  );
  assert.equal(
    validCardsView({ mode: "test", cards: [{ ...entry, status: "expired", expires_at: "2027-09-01T00:00:10.000Z", updated_at: "2027-09-01T00:00:10.000Z" }] }),
    true
  );
  const bad = [
    null,
    "cards",
    {},
    { mode: "test" },
    { mode: "live", cards: [] },
    { mode: "test", cards: null },
    { mode: "test", cards: [], extra: true },
    { mode: "test", cards: [{ ...entry, extra: "x" }] },
    { mode: "test", cards: [{ ...entry, card_id: "card_0123456789abcdef01234567" }] },
    { mode: "test", cards: [{ ...entry, brand: "amex" }] },
    { mode: "test", cards: [{ ...entry, brand: "VISA" }] },
    { mode: "test", cards: [{ ...entry, kind: "sticker" }] },
    { mode: "test", cards: [{ ...entry, last4: "12345" }] },
    { mode: "test", cards: [{ ...entry, last4: "12a4" }] },
    { mode: "test", cards: [{ ...entry, token_reference: "4111111111111111" }] },
    { mode: "test", cards: [{ ...entry, token_reference: "tok_0123456789ABCDEF01234567" }] },
    { mode: "test", cards: [{ ...entry, asset: "USD" }] },
    { mode: "test", cards: [{ ...entry, asset: "rub" }] },
    { mode: "test", cards: [{ ...entry, monthly_limit: 25000 }] },
    { mode: "test", cards: [{ ...entry, monthly_limit: "25000,00" }] },
    { mode: "test", cards: [{ ...entry, monthly_limit: "25000.0" }] },
    { mode: "test", cards: [{ ...entry, monthly_limit: "0.00" }] },
    { mode: "test", cards: [{ ...entry, monthly_limit: "-100.00" }] },
    { mode: "test", cards: [{ ...entry, status: "settled" }] },
    { mode: "test", cards: [{ ...entry, status: "pending_activation" }] },
    { mode: "test", cards: [{ ...entry, status: "pending_activation", updated_at: "2026-09-01T00:00:09.000Z" }] },
    { mode: "test", cards: [{ ...entry, status: "expired" }] },
    { mode: "test", cards: [{ ...entry, status: "expired", updated_at: "2027-09-01T00:00:10.000Z" }] },
    { mode: "test", cards: [{ ...entry, expires_at: "2026-09-01T00:00:09.000Z" }] },
    { mode: "test", cards: [{ ...entry, updated_at: "2026-09-01T00:00:09.000Z" }] },
    { mode: "test", cards: [{ ...entry, created_at: "soon" }] },
    { mode: "test", cards: [{ ...entry, expires_at: "2029-09-01" }] },
    { mode: "test", cards: [{ ...entry, updated_at: "2026-09-01T00:05:10+00:00" }] },
    { mode: "test", cards: [{ ...entry, posting: "ledger" }] },
    { mode: "test", cards: [["crd_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validCardsView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/cards returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticCardDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: CARDS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, cards: [...expected.cards] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: CARDS, headers: verifiedCustomerHeaders() });
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
        path: CARDS,
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
      path: CARDS,
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
        path: CARDS,
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
    const response = await checkedRequest(port, { path: CARDS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: CARDS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: CARDS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: CARDS, headers: customerHeaders() })).status, 403);
  });
});

test("card and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { cardDirectory: { async listFor() { throw new Error("card store exploded: secret=abc"); } } },
    { cardDirectory: { async listFor() { return { cards: "nope" }; } } },
    { cardDirectory: { async listFor() { return { mode: "test", cards: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: CARDS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("card subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/cards/",
      "/api/v1/customer/cards/1",
      "/api/v1/customer/cards/crd_000000000000000000000001",
      "/api/v1/customer/cards/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: CARDS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
