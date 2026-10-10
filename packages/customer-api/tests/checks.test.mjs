import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  CHECK_ASSETS,
  CHECK_STATUSES,
  createSyntheticCheckDirectory,
  validChecksView
} from "../src/checks.mjs";
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

const CHECKS = "/api/v1/customer/checks";
const CHECK_ID = /^chk_[0-9a-f]{24}$/u;
const CHECK_REF = /^syn_cust_[a-z0-9]{4,64}$/u;
const CHECK_PEER = /^syn_peer_[0-9a-f]{12}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const OPEN_STATUSES = ["created", "awaiting_recipient_kyc"];
const UNRESOLVED_STATUSES = ["awaiting_confirmation", "created", "awaiting_recipient_kyc"];

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic check directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticCheckDirectory();
  const first = await directory.viewFor(VERIFIED_SUBJECT);
  const second = await directory.viewFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.checks));
  for (const check of first.checks) {
    assert.ok(Object.isFrozen(check));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.checks.length >= 1);
  const other = await directory.viewFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const check of [...first.checks, ...other.checks]) {
    assert.match(check.check_id, CHECK_ID);
    assert.equal(check.check_type, "personal");
    assert.ok(CHECK_STATUSES.includes(check.status));
    // The subject sits in exactly one of the two party refs — sender for an
    // issued (sent) check, recipient for a received one — and the
    // counterparty is an opaque synthetic peer, never a claim secret.
    const parties = new Set([check.sender_ref, check.recipient_ref]);
    assert.equal(parties.size, 2);
    assert.ok(CHECK_REF.test(check.sender_ref) || CHECK_PEER.test(check.sender_ref));
    assert.ok(CHECK_REF.test(check.recipient_ref) || CHECK_PEER.test(check.recipient_ref));
    const scale = CHECK_ASSETS[check.asset];
    assert.ok(scale !== undefined, check.asset);
    const decimal = new RegExp(`^(0|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u");
    assert.match(check.amount, decimal);
    assert.ok(BigInt(check.amount.replace(".", "")) > 0n);
    assert.match(check.fee_amount, decimal);
    assert.match(check.outstanding_amount, decimal);
    assert.match(check.created_at, ISO_TIMESTAMP);
    assert.match(check.expires_at, ISO_TIMESTAMP);
    if (check.resolved_at !== null) assert.match(check.resolved_at, ISO_TIMESTAMP);
    const created = Date.parse(check.created_at);
    const expires = Date.parse(check.expires_at);
    assert.ok(expires > created);
    // Lifecycle coherence mirrors the simulator's pinned rule: outstanding
    // is the check amount while the check is open and zero otherwise; the
    // draft and open statuses are unresolved; expired resolves exactly at
    // expiry and every other terminal resolution sits inside the window.
    const zero = `0.${"0".repeat(scale)}`;
    if (OPEN_STATUSES.includes(check.status)) {
      assert.equal(check.outstanding_amount, check.amount);
      assert.equal(check.resolved_at, null);
    } else {
      assert.equal(check.outstanding_amount, zero);
    }
    if (UNRESOLVED_STATUSES.includes(check.status)) {
      assert.equal(check.resolved_at, null);
    } else if (check.status === "expired") {
      assert.equal(check.resolved_at, check.expires_at);
    } else {
      const resolved = Date.parse(check.resolved_at);
      assert.ok(resolved > created && resolved < expires);
    }
    assert.equal(check.posting, "none");
  }
});

test("every derived view conforms to the declared ChecksView schema", async () => {
  const directory = createSyntheticCheckDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.viewFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/ChecksView" }, { ...view }), [], subject);
  }
});

test("synthetic check views cover every status, direction and asset", async () => {
  const directory = createSyntheticCheckDirectory();
  const statuses = new Set();
  const directions = new Set();
  const assets = new Set();
  for (
    let index = 0;
    index < 192 && (statuses.size < CHECK_STATUSES.length || directions.size < 2 || assets.size < Object.keys(CHECK_ASSETS).length);
    index += 1
  ) {
    const subject = `syn_cust_chk${String(index).padStart(5, "0")}`;
    const view = await directory.viewFor(subject);
    for (const check of view.checks) {
      statuses.add(check.status);
      directions.add(check.sender_ref === subject ? "sent" : "received");
      assets.add(check.asset);
    }
  }
  assert.deepEqual([...statuses].sort(), [...CHECK_STATUSES].sort());
  assert.deepEqual([...directions].sort(), ["received", "sent"]);
  assert.deepEqual([...assets].sort(), [...Object.keys(CHECK_ASSETS)].sort());
});

test("a received check is never a sender-side draft", async () => {
  const directory = createSyntheticCheckDirectory();
  for (let index = 0; index < 96; index += 1) {
    const subject = `syn_cust_chk${String(index).padStart(5, "0")}`;
    const view = await directory.viewFor(subject);
    for (const check of view.checks) {
      if (check.recipient_ref === subject) {
        assert.notEqual(check.status, "awaiting_confirmation");
      } else {
        assert.equal(check.sender_ref, subject);
      }
    }
  }
});

test("validChecksView fails closed on directory drift", () => {
  const entry = {
    check_id: "chk_0123456789abcdef01234567",
    check_type: "personal",
    status: "created",
    sender_ref: "syn_cust_00000001",
    recipient_ref: "syn_peer_0123456789ab",
    amount: "25.000000",
    asset: "USDT",
    fee_amount: "0.075000",
    outstanding_amount: "25.000000",
    created_at: "2026-10-01T00:00:10.000Z",
    expires_at: "2026-10-04T00:00:10.000Z",
    resolved_at: null,
    posting: "none"
  };
  assert.equal(validChecksView({ mode: "test", checks: [entry] }), true);
  assert.equal(
    validChecksView({ mode: "test", checks: [{ ...entry, status: "claimed", outstanding_amount: "0.000000", resolved_at: "2026-10-02T00:00:10.000Z" }] }),
    true
  );
  assert.equal(
    validChecksView({ mode: "test", checks: [{ ...entry, status: "expired", outstanding_amount: "0.000000", resolved_at: entry.expires_at }] }),
    true
  );
  assert.equal(
    validChecksView({ mode: "test", checks: [{ ...entry, status: "awaiting_confirmation", outstanding_amount: "0.000000" }] }),
    true
  );
  const bad = [
    null,
    "checks",
    {},
    { mode: "test" },
    { mode: "live", checks: [] },
    { mode: "test", checks: null },
    { mode: "test", checks: [], extra: true },
    { mode: "test", checks: [{ ...entry, extra: "x" }] },
    // The view carries only the opaque check reference — claim codes, claim
    // URLs and bearer material can never appear in a served check.
    { mode: "test", checks: [{ ...entry, claim_code: "SECRET1234" }] },
    { mode: "test", checks: [{ ...entry, claim_url: "https://t.me/c/123" }] },
    { mode: "test", checks: [{ ...entry, claim_reference: "claim_0123456789abcdef" }] },
    { mode: "test", checks: [{ ...entry, check_id: "chk_0123456789ABCDEF01234567" }] },
    { mode: "test", checks: [{ ...entry, check_type: "bearer" }] },
    { mode: "test", checks: [{ ...entry, status: "multi_claim" }] },
    { mode: "test", checks: [{ ...entry, sender_ref: "" }] },
    { mode: "test", checks: [{ ...entry, sender_ref: "sim-check-1" }] },
    { mode: "test", checks: [{ ...entry, recipient_ref: entry.sender_ref }] },
    { mode: "test", checks: [{ ...entry, asset: "RUB" }] },
    { mode: "test", checks: [{ ...entry, asset: "usdt" }] },
    { mode: "test", checks: [{ ...entry, amount: "25.00000" }] },
    { mode: "test", checks: [{ ...entry, amount: "0.000000" }] },
    { mode: "test", checks: [{ ...entry, amount: "-25.000000" }] },
    { mode: "test", checks: [{ ...entry, fee_amount: "0.075" }] },
    { mode: "test", checks: [{ ...entry, outstanding_amount: "25.00000" }] },
    // An open check must carry its full amount outstanding and stay
    // unresolved; every other state resolves with zero outstanding.
    { mode: "test", checks: [{ ...entry, status: "created", outstanding_amount: "0.000000" }] },
    { mode: "test", checks: [{ ...entry, status: "created", resolved_at: "2026-10-02T00:00:10.000Z" }] },
    { mode: "test", checks: [{ ...entry, status: "awaiting_recipient_kyc", outstanding_amount: "0.000000" }] },
    { mode: "test", checks: [{ ...entry, status: "awaiting_confirmation", outstanding_amount: "25.000000" }] },
    { mode: "test", checks: [{ ...entry, status: "awaiting_confirmation", resolved_at: "2026-10-02T00:00:10.000Z" }] },
    { mode: "test", checks: [{ ...entry, status: "claimed" }] },
    { mode: "test", checks: [{ ...entry, status: "claimed", outstanding_amount: "0.000000", resolved_at: "2026-10-05T00:00:10.000Z" }] },
    { mode: "test", checks: [{ ...entry, status: "claimed", outstanding_amount: "25.000000", resolved_at: "2026-10-02T00:00:10.000Z" }] },
    { mode: "test", checks: [{ ...entry, status: "expired", outstanding_amount: "0.000000", resolved_at: "2026-10-03T00:00:10.000Z" }] },
    { mode: "test", checks: [{ ...entry, status: "expired", outstanding_amount: "0.000000", resolved_at: null }] },
    { mode: "test", checks: [{ ...entry, status: "cancelled", outstanding_amount: "0.000000", resolved_at: "2026-10-01T00:00:10.000Z" }] },
    { mode: "test", checks: [{ ...entry, expires_at: "2026-10-01T00:00:10.000Z" }] },
    { mode: "test", checks: [{ ...entry, created_at: "soon" }] },
    { mode: "test", checks: [{ ...entry, resolved_at: "2026-10-02" }] },
    { mode: "test", checks: [{ ...entry, posting: "ledger" }] },
    { mode: "test", checks: [["chk_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validChecksView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/checks returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticCheckDirectory().viewFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: CHECKS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, checks: [...expected.checks] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: CHECKS, headers: verifiedCustomerHeaders() });
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
        path: CHECKS,
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
      path: CHECKS,
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
        path: CHECKS,
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
    const response = await checkedRequest(port, { path: CHECKS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: CHECKS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: CHECKS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: CHECKS, headers: customerHeaders() })).status, 403);
  });
});

test("check and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { checkDirectory: { async viewFor() { throw new Error("check store exploded: secret=abc"); } } },
    { checkDirectory: { async viewFor() { return { checks: "nope" }; } } },
    { checkDirectory: { async viewFor() { return { mode: "test", checks: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: CHECKS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("check subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    // The templated check paths (status read, claim and cancel commands)
    // stay declared-but-unserved, like every method variant of the
    // collection path other than GET.
    for (const path of [
      "/api/v1/customer/checks/",
      "/api/v1/customer/checks/1",
      "/api/v1/customer/checks/chk_000000000000000000000001",
      "/api/v1/customer/checks/chk_000000000000000000000001/claim",
      "/api/v1/customer/checks/chk_000000000000000000000001/cancel",
      "/api/v1/customer/checks/preview",
      "/api/v1/customer/checks/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: CHECKS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
