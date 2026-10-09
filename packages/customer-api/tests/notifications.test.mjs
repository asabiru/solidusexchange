import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticNotificationDirectory,
  NOTIFICATION_TEMPLATES,
  validNotificationsView
} from "../src/notifications.mjs";
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

const NOTIFICATIONS = "/api/v1/customer/notifications";
const NOTIFICATION_ID = /^ntf_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic notification directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticNotificationDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.notifications));
  for (const notification of first.notifications) {
    assert.ok(Object.isFrozen(notification));
  }
  assert.equal(first.mode, "test");
  assert.equal(first.delivery, "disabled");
  assert.ok(first.notifications.length >= 1);
  assert.equal(first.unread, first.notifications.filter((notification) => !notification.read).length);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const notification of [...first.notifications, ...other.notifications]) {
    assert.match(notification.notification_id, NOTIFICATION_ID);
    assert.match(notification.created_at, ISO_TIMESTAMP);
    assert.ok(NOTIFICATION_TEMPLATES.includes(notification.template));
    assert.equal(notification.channel, "telegram-draft");
    assert.equal(notification.locale, "ru");
    assert.equal(notification.mode, "test");
    assert.equal(notification.delivered, false);
    assert.equal(typeof notification.read, "boolean");
    assert.ok(notification.text.length >= 1 && notification.text.length <= 128);
  }
});

test("every derived view conforms to the declared NotificationsView schema", async () => {
  const directory = createSyntheticNotificationDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/NotificationsView" }, { ...view }), [], subject);
  }
});

test("validNotificationsView fails closed on directory drift", () => {
  const entry = {
    notification_id: "ntf_1",
    created_at: "2026-09-01T00:00:00.000Z",
    channel: "telegram-draft",
    template: "session_login",
    locale: "ru",
    text: "ok",
    mode: "test",
    delivered: false,
    read: false
  };
  const bad = [
    null,
    "notifications",
    {},
    { mode: "test", delivery: "disabled", unread: 0 },
    { mode: "live", delivery: "disabled", unread: 0, notifications: [] },
    { mode: "test", delivery: "enabled", unread: 0, notifications: [] },
    { mode: "test", delivery: "disabled", unread: -1, notifications: [] },
    { mode: "test", delivery: "disabled", unread: 1.5, notifications: [] },
    { mode: "test", delivery: "disabled", unread: 0, notifications: null },
    { mode: "test", delivery: "disabled", unread: 0, notifications: [], extra: true },
    { mode: "test", delivery: "disabled", unread: 0, notifications: [{ ...entry, extra: "x" }] },
    { mode: "test", delivery: "disabled", unread: 0, notifications: [{ ...entry, read: undefined }] },
    { mode: "test", delivery: "disabled", unread: 0, notifications: [{ ...entry, read: "yes" }] },
    { mode: "test", delivery: "disabled", unread: 0, notifications: [{ ...entry, text: 3 }] },
    { mode: "test", delivery: "disabled", unread: 0, notifications: [["ntf_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validNotificationsView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/notifications returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticNotificationDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: NOTIFICATIONS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, notifications: [...expected.notifications] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: NOTIFICATIONS, headers: verifiedCustomerHeaders() });
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
        path: NOTIFICATIONS,
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
      path: NOTIFICATIONS,
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
        path: NOTIFICATIONS,
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
    const response = await checkedRequest(port, { path: NOTIFICATIONS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: NOTIFICATIONS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: NOTIFICATIONS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: NOTIFICATIONS, headers: customerHeaders() })).status, 403);
  });
});

test("notification and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { notificationDirectory: { async listFor() { throw new Error("notification store exploded: secret=abc"); } } },
    { notificationDirectory: { async listFor() { return { notifications: "nope" }; } } },
    { notificationDirectory: { async listFor() { return { mode: "test", delivery: "disabled", unread: 0, notifications: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: NOTIFICATIONS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("notification subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/notifications/",
      "/api/v1/customer/notifications/1",
      "/api/v1/customer/notifications/ntf_000000000000000000000001",
      "/api/v1/customer/notifications/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: NOTIFICATIONS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
