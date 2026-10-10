import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticUserDirectory,
  USER_FLAG_KEYS,
  USER_STATUSES,
  validUserView
} from "../src/users.mjs";
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

const USERS = "/api/v1/customer/users";
const USER_ID = /^usr_[0-9a-f]{24}$/u;
const SUBJECT_ID = /^syn_cust_[a-z0-9]{8,32}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic user directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticUserDirectory();
  const first = await directory.viewFor(VERIFIED_SUBJECT);
  const second = await directory.viewFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.flags));
  assert.equal(first.mode, "test");
  assert.equal(first.subject, VERIFIED_SUBJECT);
  assert.match(first.user_id, USER_ID);
  assert.ok(USER_STATUSES.includes(first.status));
  assert.deepEqual(Object.keys(first.flags).sort(), [...USER_FLAG_KEYS].sort());
  for (const key of USER_FLAG_KEYS) {
    assert.equal(typeof first.flags[key], "boolean");
  }
  assert.match(first.created_at, ISO_TIMESTAMP);
  assert.match(first.updated_at, ISO_TIMESTAMP);
  // Lifecycle coherence mirrors the synthetic book: a pending account was
  // registered but never modified, while reaching any other lifecycle state
  // is itself a later update.
  const created = Date.parse(first.created_at);
  const updated = Date.parse(first.updated_at);
  if (first.status === "pending") {
    assert.equal(updated, created);
  } else {
    assert.ok(updated > created);
  }
  const other = await directory.viewFor(SUBJECT);
  assert.notDeepEqual(other, first);
});

test("every derived view conforms to the declared UserView schema", async () => {
  const directory = createSyntheticUserDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000", "syn_cust_deadbeef"]) {
    const view = await directory.viewFor(subject);
    assert.deepEqual(
      validator.validate({ $ref: "#/components/schemas/UserView" }, { ...view }),
      [],
      subject
    );
  }
});

test("synthetic user views cover every declared status", async () => {
  const directory = createSyntheticUserDirectory();
  const statuses = new Set();
  for (let index = 0; index < 192 && statuses.size < USER_STATUSES.length; index += 1) {
    const view = await directory.viewFor(`syn_cust_user${String(index).padStart(4, "0")}`);
    statuses.add(view.status);
  }
  assert.deepEqual([...statuses].sort(), [...USER_STATUSES].sort());
});

test("validUserView fails closed on directory drift", () => {
  const flags = { terms_accepted: true, two_factor_enabled: false, marketing_opt_in: true };
  const base = {
    mode: "test",
    user_id: "usr_0123456789abcdef01234567",
    subject: "syn_cust_00000001",
    status: "active",
    flags,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z"
  };
  const pending = { ...base, status: "pending", updated_at: "2026-09-01T00:00:00.000Z" };
  assert.equal(validUserView(base), true);
  assert.equal(validUserView(pending), true);
  const bad = [
    null,
    "users",
    [],
    {},
    { mode: "test" },
    { ...base, extra: true },
    { ...base, mode: "live" },
    { ...base, user_id: "usr_0123456789ABCDEF01234567" },
    { ...base, user_id: "user_0123456789abcdef01234567" },
    { ...base, subject: "syn_operator_00000001" },
    { ...base, subject: "tg-0123456789abcdef" },
    { ...base, subject: "syn_cust_" },
    { ...base, status: "settled" },
    { ...base, status: "verified" },
    { ...base, flags: null },
    { ...base, flags: { ...flags, extra: true } },
    { ...base, flags: { terms_accepted: true, two_factor_enabled: false } },
    { ...base, flags: { ...flags, terms_accepted: "true" } },
    { ...base, flags: { ...flags, two_factor_enabled: 1 } },
    { ...base, flags: "none" },
    { ...base, created_at: "soon" },
    { ...base, created_at: "2026-09-01T00:00:00Z" },
    { ...base, updated_at: "2026-09-05T00:00:00+00:00" },
    { ...base, updated_at: 1_000 },
    { ...base, updated_at: "2026-08-31T23:59:59.000Z" },
    { ...pending, updated_at: "2026-09-05T00:00:00.000Z" },
    { ...base, status: "closed", updated_at: "2026-09-01T00:00:00.000Z" }
  ];
  for (const view of bad) {
    assert.equal(validUserView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/users returns the exact synthetic view for verified, pending and unverified customers", async () => {
  const kycDirectory = createSyntheticKycDirectory({
    [VERIFIED_SUBJECT]: "verified",
    syn_cust_pending01: "pending"
  });
  await withServer({ kycDirectory }, async (port) => {
    for (const subject of [VERIFIED_SUBJECT, "syn_cust_pending01", SUBJECT]) {
      const expected = await createSyntheticUserDirectory().viewFor(subject);
      const response = await checkedRequest(port, {
        path: USERS,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 200, subject);
      assert.deepEqual(JSON.parse(response.body), { ...expected, flags: { ...expected.flags } });
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
      assert.equal(header(response, "cache-control"), "no-store");
      const repeat = await checkedRequest(port, {
        path: USERS,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(repeat.body, response.body);
    }
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
        path: USERS,
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
    const response = await checkedRequest(port, { path: USERS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: USERS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: USERS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    // Even an unverified subject is served: the users read is the account's
    // own record surface and is not gated on a verified KYC status.
    assert.equal((await checkedRequest(port, { path: USERS, headers: customerHeaders() })).status, 200);
  });
});

test("user and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { userDirectory: { async viewFor() { throw new Error("user store exploded: secret=abc"); } } },
    { userDirectory: { async viewFor() { return { mode: "test" }; } } },
    {
      userDirectory: {
        async viewFor() {
          return {
            mode: "test",
            user_id: "usr_0123456789abcdef01234567",
            subject: VERIFIED_SUBJECT,
            status: "active",
            flags: { terms_accepted: true, two_factor_enabled: false, marketing_opt_in: true },
            created_at: "2026-09-01T00:00:00.000Z",
            updated_at: "2026-09-05T00:00:00.000Z",
            extra: "x"
          };
        }
      }
    },
    {
      userDirectory: {
        async viewFor() {
          return {
            mode: "test",
            user_id: "usr_0123456789abcdef01234567",
            subject: VERIFIED_SUBJECT,
            status: "pending",
            flags: { terms_accepted: true, two_factor_enabled: false, marketing_opt_in: true },
            created_at: "2026-09-01T00:00:00.000Z",
            updated_at: "2026-09-05T00:00:00.000Z"
          };
        }
      }
    },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: USERS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("user subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/users/",
      "/api/v1/customer/users/1",
      "/api/v1/customer/users/usr_0123456789abcdef01234567",
      "/api/v1/customer/users/me",
      "/api/v1/customer/users/suspend",
      "/api/v1/customer/users/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: USERS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
