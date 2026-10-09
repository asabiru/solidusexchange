import assert from "node:assert/strict";
import test from "node:test";

import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticSupportDirectory,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  validSupportTicketsView
} from "../src/support.mjs";
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

const SUPPORT = "/api/v1/customer/support";
const TICKET_ID = /^tck_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

function validTicket() {
  return {
    ticket_id: "tck_0123456789abcdef01234567",
    category: "question",
    topic: "Тестовый режим. Вопрос о работе сервиса.",
    message: "Тестовый режим. Синтетическое обращение, оно никуда не отправлено.",
    status: "in_review",
    timeline: [
      { status: "received", at: "2026-09-01T00:00:00.000Z" },
      { status: "in_review", at: "2026-09-01T01:00:00.000Z" }
    ],
    complaint_acknowledged: false,
    created_at: "2026-09-01T00:00:00.000Z",
    expires_at: "2026-09-02T00:00:00.000Z"
  };
}

test("synthetic support directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticSupportDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first));
  assert.equal(first.mode, "test");
  assert.equal(first.delivery, "disabled");
  assert.ok(Array.isArray(first.tickets));
  for (const ticket of first.tickets) {
    assert.ok(Object.isFrozen(ticket));
    assert.match(ticket.ticket_id, TICKET_ID);
    assert.ok(TICKET_CATEGORIES.includes(ticket.category));
    assert.ok(TICKET_STATUSES.includes(ticket.status));
    assert.equal(ticket.timeline.at(-1).status, ticket.status);
    assert.match(ticket.created_at, ISO_TIMESTAMP);
    assert.match(ticket.expires_at, ISO_TIMESTAMP);
    assert.equal(ticket.complaint_acknowledged, ticket.category === "complaint");
  }
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
});

test("every derived view conforms to the declared SupportTicketsView schema", async () => {
  const directory = createSyntheticSupportDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000", "syn_cust_deadbeef", "syn_cust_00000002", "syn_cust_00000003"]) {
    const view = await directory.listFor(subject);
    assert.ok(view.tickets.length > 0, `${subject} should exercise at least one ticket`);
    assert.deepEqual(
      validator.validate({ $ref: "#/components/schemas/SupportTicketsView" }, { ...view }),
      [],
      subject
    );
  }
});

test("validSupportTicketsView fails closed on directory drift", () => {
  const ticket = validTicket();
  const base = { mode: "test", delivery: "disabled", tickets: [ticket] };
  const bad = [
    null,
    "support",
    [],
    {},
    { mode: "test", delivery: "disabled" },
    { ...base, extra: true },
    { ...base, mode: "live" },
    { ...base, delivery: "enabled" },
    { ...base, tickets: {} },
    { ...base, tickets: [null] },
    { ...base, tickets: [{ ...ticket, extra: true }] },
    { ...base, tickets: [{ ...ticket, ticket_id: "sup_0123456789abcdef01234567" }] },
    { ...base, tickets: [{ ...ticket, ticket_id: "TCK_0123456789ABCDEF01234567" }] },
    { ...base, tickets: [{ ...ticket, category: "security_incident" }] },
    { ...base, tickets: [{ ...ticket, topic: "" }] },
    { ...base, tickets: [{ ...ticket, topic: "x".repeat(121) }] },
    { ...base, tickets: [{ ...ticket, message: "" }] },
    { ...base, tickets: [{ ...ticket, message: "x".repeat(1001) }] },
    { ...base, tickets: [{ ...ticket, status: "escalated" }] },
    { ...base, tickets: [{ ...ticket, timeline: [] }] },
    { ...base, tickets: [{ ...ticket, timeline: [{ status: "escalated", at: "2026-09-01T00:00:00.000Z" }] }] },
    { ...base, tickets: [{ ...ticket, timeline: [{ status: "closed" }] }] },
    { ...base, tickets: [{ ...ticket, timeline: [{ status: "in_review", at: "2026-09-01T01:00:00.000Z", extra: 1 }] }] },
    { ...base, tickets: [{ ...ticket, timeline: ticket.timeline.slice(0, 1) }] },
    { ...base, tickets: [{ ...ticket, complaint_acknowledged: "yes" }] },
    { ...base, tickets: [{ ...ticket, created_at: "not-a-date" }] },
    { ...base, tickets: [{ ...ticket, created_at: "2026-09-01T00:00:00Z" }] },
    { ...base, tickets: [{ ...ticket, created_at: 12345 }] },
    { ...base, tickets: [{ ...ticket, expires_at: "2026-09-02" }] }
  ];
  for (const view of bad) {
    assert.equal(validSupportTicketsView(view), false, JSON.stringify(view));
  }
  assert.equal(validSupportTicketsView(base), true);
  assert.equal(validSupportTicketsView({ mode: "test", delivery: "disabled", tickets: [] }), true);
});

test("GET /api/v1/customer/support returns the exact synthetic view for verified, pending and unverified customers", async () => {
  await withServer({}, async (port) => {
    for (const subject of [VERIFIED_SUBJECT, "syn_cust_pending01", SUBJECT]) {
      const expected = await createSyntheticSupportDirectory().listFor(subject);
      const response = await checkedRequest(port, {
        path: SUPPORT,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 200, subject);
      assert.deepEqual(JSON.parse(response.body), { ...expected });
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
      assert.equal(header(response, "cache-control"), "no-store");
      const repeat = await checkedRequest(port, {
        path: SUPPORT,
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
        path: SUPPORT,
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
    const response = await checkedRequest(port, { path: SUPPORT, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: SUPPORT, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: SUPPORT, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    // Even an unverified subject is served: the tickets read is the account's
    // own service-requests surface and is not gated on a verified KYC status.
    assert.equal((await checkedRequest(port, { path: SUPPORT, headers: customerHeaders() })).status, 200);
  });
});

test("support directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { supportDirectory: { async listFor() { throw new Error("support store exploded: secret=abc"); } } },
    { supportDirectory: { async listFor() { return { mode: "test" }; } } },
    {
      supportDirectory: {
        async listFor() {
          return {
            mode: "test",
            delivery: "disabled",
            tickets: [{ ...validTicket(), extra: "x" }]
          };
        }
      }
    },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: SUPPORT, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("support subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/support/",
      "/api/v1/customer/support/1",
      "/api/v1/customer/support/tck_0123456789abcdef01234567",
      "/api/v1/customer/support/new",
      "/api/v1/customer/support/tickets"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: SUPPORT, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
