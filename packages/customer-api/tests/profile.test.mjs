import assert from "node:assert/strict";
import test from "node:test";

import { PROFILE_LOCALES, createSyntheticProfileDirectory, validProfileView } from "../src/profile.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
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

const PROFILE = "/api/v1/customer/profile";
const CUSTOMER_REF = /^SC-DEV-[0-9A-Z]{5}$/u;
const DISPLAY_NAME = /^Customer [0-9a-f]{8}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic profile directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticProfileDirectory();
  const first = await directory.viewFor(VERIFIED_SUBJECT);
  const second = await directory.viewFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first));
  assert.equal(first.mode, "test");
  assert.match(first.customer_ref, CUSTOMER_REF);
  assert.match(first.display_name, DISPLAY_NAME);
  assert.ok(PROFILE_LOCALES.includes(first.locale));
  assert.match(first.registered_at, ISO_TIMESTAMP);
  const other = await directory.viewFor(SUBJECT);
  assert.notDeepEqual(other, first);
});

test("every derived view conforms to the declared ProfileView schema", async () => {
  const directory = createSyntheticProfileDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000", "syn_cust_deadbeef"]) {
    const view = await directory.viewFor(subject);
    assert.deepEqual(
      validator.validate({ $ref: "#/components/schemas/ProfileView" }, { ...view }),
      [],
      subject
    );
  }
});

test("validProfileView fails closed on directory drift", () => {
  const base = {
    mode: "test",
    customer_ref: "SC-DEV-A1B2C",
    display_name: "Customer 01234567",
    locale: "ru",
    registered_at: "2026-09-01T00:00:00.000Z"
  };
  const bad = [
    null,
    "profile",
    [],
    {},
    { ...base, extra: true },
    { ...base, mode: "live" },
    { ...base, customer_ref: "sc-dev-a1b2c" },
    { ...base, customer_ref: "SC-A1B2C" },
    { ...base, display_name: "Customer" },
    { ...base, display_name: "Customer ABCDEFGH" },
    { ...base, display_name: "customer 01234567" },
    { ...base, locale: "de" },
    { ...base, locale: "ru-RU" },
    { ...base, registered_at: "not-a-date" },
    { ...base, registered_at: "2026-09-01T00:00:00Z" },
    { ...base, registered_at: 12345 }
  ];
  for (const view of bad) {
    assert.equal(validProfileView(view), false, JSON.stringify(view));
  }
  assert.equal(validProfileView(base), true);
});

test("GET /api/v1/customer/profile returns the exact synthetic view for verified, pending and unverified customers", async () => {
  await withServer({}, async (port) => {
    for (const subject of [VERIFIED_SUBJECT, "syn_cust_pending01", SUBJECT]) {
      const expected = await createSyntheticProfileDirectory().viewFor(subject);
      const response = await checkedRequest(port, {
        path: PROFILE,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 200, subject);
      assert.deepEqual(JSON.parse(response.body), { ...expected });
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
      assert.equal(header(response, "cache-control"), "no-store");
      const repeat = await checkedRequest(port, {
        path: PROFILE,
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
        path: PROFILE,
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
    const response = await checkedRequest(port, { path: PROFILE, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: PROFILE, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: PROFILE, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    // Even an unverified subject is served: the profile read is the account's
    // own identity surface and is not gated on a verified KYC status.
    assert.equal((await checkedRequest(port, { path: PROFILE, headers: customerHeaders() })).status, 200);
  });
});

test("profile directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { profileDirectory: { async viewFor() { throw new Error("profile store exploded: secret=abc"); } } },
    { profileDirectory: { async viewFor() { return { locale: "ru" }; } } },
    {
      profileDirectory: {
        async viewFor() {
          return {
            mode: "test",
            customer_ref: "SC-DEV-A1B2C",
            display_name: "Customer 01234567",
            locale: "ru",
            registered_at: "2026-09-01T00:00:00.000Z",
            extra: "x"
          };
        }
      }
    },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: PROFILE, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("profile subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/profile/",
      "/api/v1/customer/profile/1",
      "/api/v1/customer/profile/SC-DEV-00001",
      "/api/v1/customer/profile/edit",
      "/api/v1/customer/profile/status"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: PROFILE, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
