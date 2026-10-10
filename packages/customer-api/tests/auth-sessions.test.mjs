import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  AUTH_SESSION_PLATFORMS,
  AUTH_SESSION_STATES,
  createSyntheticAuthSessionDirectory,
  validAuthSessionsView
} from "../src/auth-sessions.mjs";
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

const AUTH = "/api/v1/customer/auth";
const SESSION_ID = /^sess_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic auth session directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticAuthSessionDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.sessions));
  for (const session of first.sessions) {
    assert.ok(Object.isFrozen(session));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.sessions.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const view of [first, other]) {
    assert.equal(view.sessions.filter((session) => session.current === true).length, 1);
    assert.equal(view.sessions[0].current, true);
  }
  for (const session of [...first.sessions, ...other.sessions]) {
    assert.match(session.session_id, SESSION_ID);
    assert.ok(AUTH_SESSION_PLATFORMS.includes(session.platform));
    assert.ok(AUTH_SESSION_STATES.includes(session.state));
    assert.match(session.created_at, ISO_TIMESTAMP);
    assert.match(session.last_seen_at, ISO_TIMESTAMP);
    // Lifecycle coherence mirrors the synthetic book: a session cannot be
    // observed before it began, a current session is live by definition, a
    // session that ended was necessarily observed after it began, and a live
    // session may never have been re-observed since creation.
    const created = Date.parse(session.created_at);
    const lastSeen = Date.parse(session.last_seen_at);
    assert.ok(lastSeen >= created);
    if (session.state === "active") {
      assert.ok(lastSeen >= created);
    } else {
      assert.ok(lastSeen > created);
    }
    if (session.current) {
      assert.equal(session.state, "active");
    }
  }
});

test("every derived view conforms to the declared AuthSessionsView schema", async () => {
  const directory = createSyntheticAuthSessionDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/AuthSessionsView" }, { ...view }), [], subject);
  }
});

test("synthetic auth session views cover every declared state and platform", async () => {
  const directory = createSyntheticAuthSessionDirectory();
  const states = new Set();
  const platforms = new Set();
  for (
    let index = 0;
    index < 192 && (states.size < AUTH_SESSION_STATES.length || platforms.size < AUTH_SESSION_PLATFORMS.length);
    index += 1
  ) {
    const view = await directory.listFor(`syn_cust_auth${String(index).padStart(4, "0")}`);
    for (const session of view.sessions) {
      states.add(session.state);
      platforms.add(session.platform);
    }
  }
  assert.deepEqual([...states].sort(), [...AUTH_SESSION_STATES].sort());
  assert.deepEqual([...platforms].sort(), [...AUTH_SESSION_PLATFORMS].sort());
});

test("validAuthSessionsView fails closed on directory drift", () => {
  const entry = {
    session_id: "sess_0123456789abcdef01234567",
    platform: "web",
    state: "active",
    created_at: "2026-09-01T00:00:10.000Z",
    last_seen_at: "2026-09-01T00:00:10.000Z",
    current: true
  };
  const ended = { ...entry, state: "revoked", last_seen_at: "2026-09-01T01:00:10.000Z", current: false };
  assert.equal(validAuthSessionsView({ mode: "test", sessions: [entry] }), true);
  assert.equal(validAuthSessionsView({ mode: "test", sessions: [entry, ended] }), true);
  assert.equal(
    validAuthSessionsView({ mode: "test", sessions: [{ ...entry, last_seen_at: "2026-09-01T02:00:10.000Z" }] }),
    true
  );
  const bad = [
    null,
    "sessions",
    {},
    { mode: "test" },
    { mode: "live", sessions: [] },
    { mode: "test", sessions: null },
    { mode: "test", sessions: [], extra: true },
    { mode: "test", sessions: [] },
    { mode: "test", sessions: [entry, { ...entry, session_id: "sess_ffffffffffffffffffffffff" }] },
    { mode: "test", sessions: [{ ...entry, extra: "x" }] },
    { mode: "test", sessions: [{ ...entry, session_id: "ses_0123456789abcdef01234567" }] },
    { mode: "test", sessions: [{ ...entry, session_id: "sess_0123456789ABCDEF01234567" }] },
    { mode: "test", sessions: [{ ...entry, platform: "operator-web" }] },
    { mode: "test", sessions: [{ ...entry, platform: "service" }] },
    { mode: "test", sessions: [{ ...entry, platform: "desktop" }] },
    { mode: "test", sessions: [{ ...entry, state: "settled" }] },
    { mode: "test", sessions: [{ ...entry, state: "pending" }] },
    { mode: "test", sessions: [{ ...entry, current: "true" }] },
    { mode: "test", sessions: [{ ...entry, current: 1 }] },
    { mode: "test", sessions: [{ ...entry, current: false }] },
    { mode: "test", sessions: [{ ...entry, state: "revoked" }] },
    { mode: "test", sessions: [{ ...entry, state: "expired", last_seen_at: "2026-09-01T01:00:10.000Z" }] },
    { mode: "test", sessions: [{ ...ended, state: "expired", current: true }] },
    { mode: "test", sessions: [{ ...ended, last_seen_at: "2026-09-01T00:00:09.000Z" }] },
    { mode: "test", sessions: [{ ...entry, created_at: "soon" }] },
    { mode: "test", sessions: [{ ...entry, created_at: "2026-09-01T00:00:10Z" }] },
    { mode: "test", sessions: [{ ...entry, last_seen_at: "2026-09-01T00:00:10+00:00" }] },
    { mode: "test", sessions: [{ ...entry, last_seen_at: 1_000 }] },
    { mode: "test", sessions: [{ ...entry, token: "scdev1.abc" }] },
    { mode: "test", sessions: [["sess_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validAuthSessionsView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/auth returns the exact synthetic view for verified, pending and unverified customers", async () => {
  const kycDirectory = createSyntheticKycDirectory({
    [VERIFIED_SUBJECT]: "verified",
    syn_cust_pending01: "pending"
  });
  await withServer({ kycDirectory }, async (port) => {
    for (const subject of [VERIFIED_SUBJECT, "syn_cust_pending01", SUBJECT]) {
      const expected = await createSyntheticAuthSessionDirectory().listFor(subject);
      const response = await checkedRequest(port, {
        path: AUTH,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 200, subject);
      assert.deepEqual(JSON.parse(response.body), { ...expected, sessions: [...expected.sessions] });
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
      assert.equal(header(response, "cache-control"), "no-store");
      const repeat = await checkedRequest(port, {
        path: AUTH,
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
        path: AUTH,
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
    const response = await checkedRequest(port, { path: AUTH, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: AUTH, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: AUTH, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    // Even an unverified subject is served: the auth sessions read is the
    // account's own sign-in surface and is not gated on a verified KYC
    // status.
    assert.equal((await checkedRequest(port, { path: AUTH, headers: customerHeaders() })).status, 200);
  });
});

test("auth session and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { authSessionDirectory: { async listFor() { throw new Error("session store exploded: secret=abc"); } } },
    { authSessionDirectory: { async listFor() { return { sessions: "nope" }; } } },
    { authSessionDirectory: { async listFor() { return { mode: "test", sessions: [], extra: "x" }; } } },
    { authSessionDirectory: { async listFor() { return { mode: "test", sessions: [] }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: AUTH, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("auth session subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/auth/",
      "/api/v1/customer/auth/1",
      "/api/v1/customer/auth/sess_0123456789abcdef01234567",
      "/api/v1/customer/auth/revoke",
      "/api/v1/customer/auth/revoke-others",
      "/api/v1/customer/auth/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: AUTH, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
