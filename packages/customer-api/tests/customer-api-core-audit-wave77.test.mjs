// Wave-77 adversarial audit of the customer-api trust spine:
// src/app.mjs (dispatcher), src/capabilities.mjs (capability machinery),
// src/operator.mjs (roster, queue snapshots, audit feed, subject-360),
// src/auth.mjs (token verification) and the served read modules
// wallets/notifications/support/auth-sessions.
//
// Each test is a repro of the audit's attack idea run against the real
// dispatcher and directories. Every finding resolved to verified-clean;
// these assertions pin the deny-by-default outcomes so a regression in
// the spine fails here before it can serve drift.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OPERATIONS } from "../src/contract.mjs";
import {
  CUSTOMER_SCOPES,
  mintSyntheticCustomerToken,
  OPERATOR_SCOPES
} from "../src/auth.mjs";
import {
  evaluateCapabilities,
  evaluateOperatorCapabilities
} from "../src/capabilities.mjs";
import {
  createSyntheticOperatorSubjectsDirectory,
  operatorRoleFor,
  validOperatorQueueView
} from "../src/operator.mjs";
import {
  createSyntheticWalletDirectory,
  validWalletsView
} from "../src/wallets.mjs";
import {
  createSyntheticNotificationDirectory,
  validNotificationsView
} from "../src/notifications.mjs";
import {
  createSyntheticSupportDirectory,
  validSupportTicketsView
} from "../src/support.mjs";
import {
  createSyntheticAuthSessionDirectory,
  validAuthSessionsView
} from "../src/auth-sessions.mjs";

import {
  auditOperatorHeaders,
  checkedRequest,
  customerHeaders,
  header,
  operatorHeaders,
  OPERATOR_SUBJECT,
  REQUEST_ID,
  startTestServer,
  stopServer,
  SUBJECT,
  TEST_KEY,
  token,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

let port;
let server;

test.before(async () => {
  ({ server, port } = await startTestServer());
});

test.after(async () => {
  await stopServer(server);
});

async function statusOf(path, headers, method = "GET") {
  const response = await checkedRequest(port, { method, path, headers });
  return response.status;
}

async function bodyOf(path, headers) {
  const response = await checkedRequest(port, { path, headers });
  return JSON.parse(response.body);
}

const PATH_SUBSTITUTIONS = new Map([
  ["{subjectId}", SUBJECT],
  ["{instrument}", encodeURIComponent("USDT/RUB")],
  ["{kind}", "kyc"],
  ["{itemId}", "qky_0000000000000000"],
  // Schema-conformant shapes (^ord_[0-9a-f]{24}$, ^scr_[0-9a-f]{32}$) so
  // the contract validator maps the path back to its template.
  ["{orderId}", "ord_000000000000000000000000"],
  ["{operationId}", "op_00000000"],
  ["{screeningId}", "scr_00000000000000000000000000000000"]
]);

function concretePath(path) {
  let concrete = path;
  for (const [placeholder, value] of PATH_SUBSTITUTIONS) {
    concrete = concrete.replace(placeholder, value);
  }
  return concrete;
}

// --- Route table completeness and method pins -----------------------------

test("wave77: every declared operation dispatches and never fallsthrough", async () => {
  const ids = new Set(OPERATIONS.map((operation) => operation.operationId));
  assert.equal(ids.size, OPERATIONS.length, "operationIds must be unique");
  for (const operation of OPERATIONS) {
    assert.equal(operation.method, "GET", `${operation.operationId} must be GET-pinned`);
    const isOperator = operation.path.startsWith("/api/v1/operator/");
    const headers = isOperator ? operatorHeaders() : customerHeaders();
    const path = concretePath(operation.path);
    // A missing dispatch arm is the #325 fallthrough class: the handler
    // throws and the socket dies or answers 500. Every arm must answer a
    // contract envelope status for well-formed input.
    const status = await statusOf(path, headers);
    assert.ok(
      [200, 400, 401, 403, 404].includes(status),
      `${operation.operationId} GET ${path} returned ${status}`
    );
  }
});

test("wave77: non-GET methods on a served path stay misses", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
    assert.equal(
      await statusOf("/api/v1/customer/wallets", customerHeaders(), method),
      404,
      `${method} must not match a GET-pinned route`
    );
  }
});

// --- Query grammar gate ----------------------------------------------------

test("wave77: query grammar gate — queries on non-query ops are misses", async () => {
  assert.equal(await statusOf("/api/v1/customer/wallets?x=1", customerHeaders()), 404);
  assert.equal(await statusOf("/api/v1/customer/wallets?", customerHeaders()), 404);
  assert.equal(await statusOf("/api/v1/meta?x=1", [["X-Request-Id", REQUEST_ID]]), 404);
  assert.equal(await statusOf("/api/v1/operator/subjects?kind=kyc", operatorHeaders()), 404);
});

test("wave77: query grammar gate — queue and audit accept only their grammar", async () => {
  assert.equal(await statusOf("/api/v1/operator/queue?foo=1", operatorHeaders()), 400);
  assert.equal(await statusOf("/api/v1/operator/queue?kind=KYC", operatorHeaders()), 400);
  assert.equal(await statusOf("/api/v1/operator/queue?kind=kyc&kind=aml", operatorHeaders()), 400);
  assert.equal(await statusOf("/api/v1/operator/queue?kind=kyc&foo=1", operatorHeaders()), 400);
  assert.equal(await statusOf("/api/v1/operator/audit?foo=1", auditOperatorHeaders()), 400);
  assert.equal(await statusOf("/api/v1/operator/audit?cursor=not-a-cursor", auditOperatorHeaders()), 400);
  assert.equal(await statusOf("/api/v1/operator/audit?cursor=auc_xyz", auditOperatorHeaders()), 400);
  assert.equal(
    await statusOf("/api/v1/operator/audit?cursor=auc_0123456789abcdef&cursor=auc_0123456789abcdef", auditOperatorHeaders()),
    400
  );
  // Absent parameters fall back to the declared defaults.
  assert.equal(await statusOf("/api/v1/operator/queue", operatorHeaders()), 200);
  assert.equal(await statusOf("/api/v1/operator/audit", auditOperatorHeaders()), 200);
});

test("wave77: percent-decoded parameter names feed the same strict allowlist", async () => {
  // %6b decodes to 'k': the decoded name is the allowlist key, so this is
  // the same grammar check — not a bypass.
  assert.equal(await statusOf("/api/v1/operator/queue?%6bind=kyc", operatorHeaders()), 200);
  assert.equal(await statusOf("/api/v1/operator/queue?%6bind=nope", operatorHeaders()), 400);
  assert.equal(await statusOf("/api/v1/operator/audit?%63ursor=auc_ffffffffffffffff", auditOperatorHeaders()), 404);
  // An encoded '=' inside the name does not forge a second key.
  assert.equal(await statusOf("/api/v1/operator/queue?kind%3dkyc", operatorHeaders()), 400);
});

// --- Path-parameter decode safety -----------------------------------------

test("wave77: instrument path parameters decode exactly once and revalidate", async () => {
  const headers = verifiedCustomerHeaders();
  // USDT/RUB is a declared instrument — the encoded slash decodes once.
  assert.equal(await statusOf("/api/v1/customer/markets/USDT%2FRUB", headers), 200);
  // Double-encoded, wrong case, NUL, whitespace, traversal and overlong
  // decodes never reach the directory: the decoded value must match the
  // instrument grammar.
  for (const encoded of [
    "USDT%252FRUB",
    "usdt%2Frub",
    "USDT%2FRUB%00",
    "USDT%2F",
    "%2FUSDT",
    "USDT%20%2FRUB",
    "%2e%2e%2Fetc",
    "USDT%2FRUBTOOLONG"
  ]) {
    assert.equal(
      await statusOf(`/api/v1/customer/markets/${encoded}`, headers),
      404,
      `${encoded} must decode-and-reject, not pass through`
    );
  }
  // A raw extra slash changes the segment count — the template misses.
  assert.equal(await statusOf("/api/v1/customer/markets/USDT/RUB", headers), 404);
  // A grammar-valid non-member instrument is a miss like any absent member.
  assert.equal(await statusOf("/api/v1/customer/markets/AAA%2FBBB", headers), 404);
});

test("wave77: other path parameters never decode", async () => {
  const headers = operatorHeaders();
  const rosterSubject = (await bodyOf("/api/v1/operator/subjects", headers)).subjects[0].subject_id;
  assert.equal(await statusOf(`/api/v1/operator/subjects/${rosterSubject}`, headers), 200);
  // %73 decodes to 's' but {subjectId} has no decode step: literal miss.
  assert.equal(await statusOf("/api/v1/operator/subjects/%73yn_cust_00000001", headers), 404);
  // Case variants, suffixes and NUL-injected ids stay misses.
  assert.equal(await statusOf(`/api/v1/operator/subjects/${SUBJECT.toUpperCase()}`, headers), 404);
  assert.equal(await statusOf(`/api/v1/operator/subjects/${SUBJECT}x`, headers), 404);
  assert.equal(await statusOf("/api/v1/operator/subjects/syn_cust_00000001%00", headers), 404);
  assert.equal(await statusOf("/api/v1/operator/queue/kyc/qky_0000000000000000%00", headers), 404);
});

// --- Audience binding and token machinery ---------------------------------

test("wave77: audience binding fails closed in both directions", async () => {
  const operatorBearer = operatorHeaders().find(([name]) => name === "Authorization");
  const customerBearer = customerHeaders().find(([name]) => name === "Authorization");
  const operatorOnCustomer = customerHeaders({ Authorization: operatorBearer[1] });
  const customerOnOperator = operatorHeaders({ Authorization: customerBearer[1] });
  assert.equal(await statusOf("/api/v1/customer/wallets", operatorOnCustomer), 401);
  assert.equal(await statusOf("/api/v1/operator/session", customerOnOperator), 401);
  assert.equal(await statusOf("/api/v1/operator/subjects", customerOnOperator), 401);
  // An absent bearer is a fail-closed 401, not a 403.
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: null })), 401);
});

test("wave77: forged, expired and over-TTL tokens all fail closed", async () => {
  const domain = "solidchange-customer-api-synthetic-dev-token-v1";
  const expiresText = "1780000000";
  // A sha256-shaped signature over the payload is not the HMAC: forgery
  // fails closed.
  const forged = `scdev1.${SUBJECT}.${expiresText}.${"0".repeat(64)}`;
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Bearer ${forged}` })), 401);
  // Honest HMAC over a wrong subject inside a valid-grammar token.
  const wrongSubjectSig = createHmac("sha256", Buffer.from(TEST_KEY, "hex"))
    .update(`${domain}\nsyn_cust_evil\n${expiresText}`)
    .digest("hex");
  const swapped = `scdev1.${SUBJECT}.${expiresText}.${wrongSubjectSig}`;
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Bearer ${swapped}` })), 401);
  // Expired and over-TTL tokens carry valid signatures — only the time
  // bound denies them.
  const expired = mintSyntheticCustomerToken({
    key: TEST_KEY,
    subject: SUBJECT,
    expiresAtSeconds: 1700000000
  });
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Bearer ${expired}` })), 401);
  const overTtl = mintSyntheticCustomerToken({
    key: TEST_KEY,
    subject: SUBJECT,
    expiresAtSeconds: Math.floor(Date.parse("2026-10-01T12:00:00.000Z") / 1000) + 7200
  });
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Bearer ${overTtl}` })), 401);
  // A truncated signature and a wrong scheme keyword.
  const truncated = token().slice(0, -8);
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Bearer ${truncated}` })), 401);
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Token ${token()}` })), 401);
});

test("wave77: subject binding — a token reads only its own views", async () => {
  const tokenA = token({ subject: SUBJECT });
  const tokenB = token({ subject: VERIFIED_SUBJECT });
  // The served session echoes the bound subject verbatim — a token can
  // never point at another subject's identity.
  for (const [bearer, expected] of [[tokenA, SUBJECT], [tokenB, VERIFIED_SUBJECT]]) {
    const body = await bodyOf("/api/v1/customer/session", customerHeaders({ Authorization: `Bearer ${bearer}` }));
    assert.equal(body.subject, expected);
  }
  // Member reads carry no subject selector: a B-token request can never
  // name A's data — binding is structural, not a filter.
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Bearer ${tokenA}` })), 403);
  assert.equal(await statusOf("/api/v1/customer/wallets", customerHeaders({ Authorization: `Bearer ${tokenB}` })), 200);
});

// --- Operator queue machinery -----------------------------------------------

test("wave77: queue item detail is kind-scoped — wrong kind stays a miss", async () => {
  const headers = operatorHeaders();
  const view = await bodyOf("/api/v1/operator/queue?kind=kyc", headers);
  assert.ok(view.queue.items.length > 0, "kyc queue must serve items");
  const itemId = view.queue.items[0].queue_id;
  assert.equal(await statusOf(`/api/v1/operator/queue/kyc/${itemId}`, headers), 200);
  // The same item under a different kind is a miss — the detail is scoped
  // to its queue, not reachable through a sibling collection.
  assert.equal(await statusOf(`/api/v1/operator/queue/aml/${itemId}`, headers), 404);
  assert.equal(await statusOf(`/api/v1/operator/queue/tickets/${itemId}`, headers), 404);
  // Out-of-enum kinds and forged ids are uniform misses.
  assert.equal(await statusOf(`/api/v1/operator/queue/escalated/${itemId}`, headers), 404);
  assert.equal(await statusOf("/api/v1/operator/queue/kyc/qky_ffffffffffffffff", headers), 404);
  assert.equal(await statusOf(`/api/v1/operator/queue/kyc/${itemId.toUpperCase()}`, headers), 404);
});

test("wave77: queue view is verbatim-recompute gated — fabrication fails", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const view = await directory.queueFor("kyc");
  assert.ok(view.queue.items.length > 0);
  // A foreign item injected into the served page fails the verbatim
  // recompute — the validator holds the exact expected set.
  const tampered = structuredClone(view);
  tampered.queue.items[0] = { ...tampered.queue.items[0], queue_id: "qky_deadbeefdeadbeef" };
  assert.equal(validOperatorQueueView("kyc", tampered), false);
  const truncated = structuredClone(view);
  truncated.queue.items.pop();
  assert.equal(validOperatorQueueView("kyc", truncated), false);
});

// --- Operator audit feed ----------------------------------------------------

test("wave77: audit pagination resolves only minted boundary tokens", async () => {
  const headers = auditOperatorHeaders();
  const feed1 = (await bodyOf("/api/v1/operator/audit", headers)).audit;
  assert.ok(feed1.entries.length > 0);
  const cursor = feed1.next_cursor;
  if (cursor !== null) {
    assert.match(cursor, /^auc_[0-9a-f]{16}$/u);
    const feed2 = (await bodyOf(`/api/v1/operator/audit?cursor=${cursor}`, headers)).audit;
    assert.ok(feed2.entries.length > 0);
    assert.notDeepEqual(
      feed1.entries.map((entry) => entry.audit_id),
      feed2.entries.map((entry) => entry.audit_id),
      "pages must not replay"
    );
  }
  // Well-formed tokens never minted at a page boundary are misses — forged
  // continuation state cannot skip or replay entries.
  for (const forged of ["auc_0000000000000000", "auc_ffffffffffffffff", "auc_1234567890abcdee"]) {
    assert.equal(await statusOf(`/api/v1/operator/audit?cursor=${forged}`, headers), 404, forged);
  }
  // Cursor-shaped garbage is a grammar failure before resolution.
  assert.equal(await statusOf("/api/v1/operator/audit?cursor=auc_0123456789ABCDEF", headers), 400);
  assert.equal(await statusOf("/api/v1/operator/audit?cursor=auc_0123456789abcde", headers), 400);
});

test("wave77: a directory missing auditFor fails at boot, not at request time", async () => {
  // Pre-fix the constructor's wiring check named only the four subject
  // methods: a directory lacking auditFor booted and the audit route 500'd
  // on the TypeError. The miswire now throws at construction like every
  // other missing method.
  const directory = createSyntheticOperatorSubjectsDirectory();
  const incomplete = Object.freeze({
    subjectsFor: directory.subjectsFor,
    subjectFor: directory.subjectFor,
    queueFor: directory.queueFor,
    queueItemFor: directory.queueItemFor
  });
  await assert.rejects(
    () => startTestServer({ operatorSubjectsDirectory: incomplete }),
    /operator subjects directory/iu
  );
});

test("wave77: audit feed stays oversight-role gated on the whole surface", async () => {
  // OPERATOR_SUBJECT draws a non-audit role: grammar errors parse first
  // (400), then the capability gate denies (403). A denied caller can learn
  // the grammar is well-formed but never whether a token resolves.
  assert.equal(await statusOf("/api/v1/operator/audit", operatorHeaders()), 403);
  assert.equal(await statusOf("/api/v1/operator/audit?cursor=auc_0123456789abcdef", operatorHeaders()), 403);
  assert.equal(await statusOf("/api/v1/operator/audit?cursor=garbage", operatorHeaders()), 400);
});

// --- Capability machinery ---------------------------------------------------

test("wave77: every dispatch-arm capability exists in the dictionary", async () => {
  // An arm could name a capability id the dictionary cannot grant — then it
  // would deny forever, or worse, grant on a typo'd evaluator entry. Pin:
  // every granted.includes("...") the dispatcher checks is grantable by
  // its own audience's evaluation.
  const source = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");
  const claimed = [...source.matchAll(/granted\.includes\("([^"]+)"\)/gu)].map((match) => match[1]);
  // getApiMetadata is the one unauthenticated arm; every other arm gates.
  assert.ok(claimed.length >= OPERATIONS.length - 1, "every served arm must gate on a capability");
  const customerEvaluation = evaluateCapabilities({ kycStatus: "verified" });
  const operatorEvaluation = evaluateOperatorCapabilities({ role: "auditor" });
  for (const capability of new Set(claimed)) {
    if (capability.startsWith("operator.")) {
      assert.ok(
        operatorEvaluation.granted.includes(capability),
        `${capability} is checked by an arm but the operator dictionary never grants it`
      );
    } else {
      assert.ok(
        customerEvaluation.granted.includes(capability),
        `${capability} is checked by an arm but the customer dictionary never grants it`
      );
    }
  }
});

test("wave77: subject and operator capability domains never cross", async () => {
  const customerEvaluation = evaluateCapabilities({ kycStatus: "verified" });
  const operatorEvaluation = evaluateOperatorCapabilities({ role: "auditor" });
  assert.ok(customerEvaluation.granted.every((capability) => capability.startsWith("customer.")));
  assert.ok(operatorEvaluation.granted.every((capability) => capability.startsWith("operator.")));
  // A garbage role grants the role-free vocabulary only — audit stays out.
  const garbageRole = evaluateOperatorCapabilities({ role: "superuser" });
  assert.equal(garbageRole.granted.includes("operator.audit.read"), false);
  assert.ok(garbageRole.granted.length < operatorEvaluation.granted.length);
  // Role derivation is deterministic per subject — no ambient role leak.
  assert.equal(operatorRoleFor(OPERATOR_SUBJECT), operatorRoleFor(OPERATOR_SUBJECT));
  assert.notEqual(operatorRoleFor(OPERATOR_SUBJECT), "auditor");
  assert.notEqual(operatorRoleFor(OPERATOR_SUBJECT), "compliance-lead");
  // Customer evaluation ignores roles entirely.
  const withRole = evaluateCapabilities({ kycStatus: "verified", role: "auditor" });
  assert.deepEqual(withRole.granted, customerEvaluation.granted);
  // The scope vocabularies stay disjoint.
  assert.equal(CUSTOMER_SCOPES.filter((scope) => OPERATOR_SCOPES.includes(scope)).length, 0);
});

// --- Served read modules ----------------------------------------------------

test("wave77: served read views are verbatim-recompute gated per module", async () => {
  const walletView = await createSyntheticWalletDirectory().listFor(VERIFIED_SUBJECT);
  assert.equal(validWalletsView(walletView), true);
  const tamperedWallets = structuredClone(walletView);
  tamperedWallets.wallets[0] = { ...tamperedWallets.wallets[0], wallet_id: "wal_forged" };
  assert.equal(validWalletsView(tamperedWallets), false);

  const notificationView = await createSyntheticNotificationDirectory().listFor(SUBJECT);
  assert.equal(validNotificationsView(notificationView), true);
  // unread is a recount — a drifted badge fails.
  const tamperedNotifications = structuredClone(notificationView);
  tamperedNotifications.unread += 1;
  assert.equal(validNotificationsView(tamperedNotifications), false);

  const supportView = await createSyntheticSupportDirectory().listFor(SUBJECT);
  assert.equal(validSupportTicketsView(supportView), true);
  // The ticket lifecycle is a strict status prefix at fixed steps, expiring
  // exactly one TTL after creation — drift in either fails.
  const tamperedSupport = structuredClone(supportView);
  tamperedSupport.tickets[0] = {
    ...tamperedSupport.tickets[0],
    expires_at: new Date(Date.parse(tamperedSupport.tickets[0].expires_at) + 86_400_000).toISOString()
  };
  assert.equal(validSupportTicketsView(tamperedSupport), false);

  const sessionView = await createSyntheticAuthSessionDirectory().listFor(SUBJECT);
  assert.equal(validAuthSessionsView(sessionView), true);
  const tamperedSessions = structuredClone(sessionView);
  tamperedSessions.sessions.push({ ...tamperedSessions.sessions[0], session_id: "sat_forged" });
  assert.equal(validAuthSessionsView(tamperedSessions), false);
});

test("wave77: per-subject accumulations stay bounded in served views", async () => {
  // Auth sessions: bounded list, at most one current.
  const auth = await bodyOf("/api/v1/customer/auth", customerHeaders());
  assert.ok(auth.sessions.length <= 8, `auth sessions served ${auth.sessions.length}`);
  assert.ok(auth.sessions.filter((session) => session.current).length <= 1);
  // Notifications: unread is a recount, not a stored counter.
  const notifications = await bodyOf("/api/v1/customer/notifications", verifiedCustomerHeaders());
  assert.equal(notifications.unread, notifications.notifications.filter((n) => !n.read).length);
  // Audit feed: bounded page, never the whole log.
  const audit = await bodyOf("/api/v1/operator/audit", auditOperatorHeaders());
  assert.ok(audit.audit.entries.length <= 32);
  // Subject roster: bounded fixed size.
  const subjects = await bodyOf("/api/v1/operator/subjects", operatorHeaders());
  assert.ok(subjects.subjects.length <= 24);
});

// --- Error envelope coherence -----------------------------------------------

test("wave77: every error response carries the uniform envelope and echoes request_id", async () => {
  const cases = [
    ["/api/v1/customer/wallets", customerHeaders({ Authorization: null }), 401],
    ["/api/v1/customer/wallets", customerHeaders(), 403],
    ["/api/v1/operator/queue?kind=bogus", operatorHeaders(), 400],
    ["/api/v1/operator/subjects/syn_cust_deadbeef", operatorHeaders(), 404],
    ["/api/v1/customer/wallets", customerHeaders({ "X-Device-Id": "4d1c3a52-1f43-4c6b-9b3a-2a1f7e9c0d11" }), 400]
  ];
  for (const [path, headers, expected] of cases) {
    const response = await checkedRequest(port, { path, headers });
    assert.equal(response.status, expected, `${path} -> ${response.status}`);
    const envelope = JSON.parse(response.body);
    assert.deepEqual(Object.keys(envelope).sort(), ["code", "details", "message", "request_id"]);
    assert.equal(envelope.request_id, REQUEST_ID);
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.match(envelope.code, /^[A-Z_]+$/u);
  }
});
