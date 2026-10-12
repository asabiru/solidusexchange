// Wave-67 meta-consistency audit: a single systematic sweep across every
// served read in the package. Each check is stated once and applied to the
// whole operation matrix so a drift on any single route fails the cell it
// belongs to instead of hiding inside a per-surface test.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CAPABILITY_POLICY,
  evaluateCapabilities,
  evaluateOperatorCapabilities
} from "../src/capabilities.mjs";
import { createSyntheticTokenVerifier } from "../src/auth.mjs";
import { OPERATIONS } from "../src/contract.mjs";
import { createSyntheticActivityDirectory, validActivityView } from "../src/activity.mjs";
import {
  createSyntheticAddressScreeningDirectory,
  validAddressScreeningView,
  validAddressScreeningsView
} from "../src/address-screenings.mjs";
import { createSyntheticAuthSessionDirectory, validAuthSessionsView } from "../src/auth-sessions.mjs";
import { createSyntheticCardDirectory, validCardsView } from "../src/cards.mjs";
import { createSyntheticCheckDirectory, validChecksView } from "../src/checks.mjs";
import {
  createSyntheticDepositAddressDirectory,
  validDepositAddressesView
} from "../src/deposit-addresses.mjs";
import { createSyntheticDepositDirectory, validDepositsView } from "../src/deposits.mjs";
import {
  createSyntheticExchangeOrderDirectory,
  createSyntheticMarketDirectory,
  createSyntheticTradeDirectory,
  validExchangeOrderDetailView,
  validExchangeOrdersView,
  validMarketDepthView,
  validMarketsView,
  validTradesView
} from "../src/exchange-orders.mjs";
import { createSyntheticKycApplicationDirectory, validKycStatusView } from "../src/kyc.mjs";
import {
  createSyntheticNotificationDirectory,
  validNotificationsView
} from "../src/notifications.mjs";
import {
  createSyntheticOperationDirectory,
  validOperationView,
  validOperationsView
} from "../src/operations.mjs";
import {
  OPERATOR_AUDIT_PAGE_SIZE,
  createSyntheticOperatorDirectory,
  createSyntheticOperatorSubjectsDirectory,
  operatorCapabilitiesViewFor,
  operatorRoleFor,
  operatorSessionViewFor,
  validOperatorAdminView,
  validOperatorAuditView,
  validOperatorCapabilitiesView,
  validOperatorQueueItemDetail,
  validOperatorQueueView,
  validOperatorSessionView,
  validOperatorSubjectDetailView,
  validOperatorSubjectsView
} from "../src/operator.mjs";
import { createSyntheticPaymentDirectory, validPaymentsView } from "../src/payments.mjs";
import { createSyntheticProfileDirectory, validProfileView } from "../src/profile.mjs";
import { createSyntheticQuoteDirectory, validQuotesView } from "../src/quotes.mjs";
import { createSyntheticSupportDirectory, validSupportTicketsView } from "../src/support.mjs";
import { createSyntheticUserDirectory, validUserView } from "../src/users.mjs";
import { createSyntheticWalletDirectory, validWalletsView } from "../src/wallets.mjs";
import { createSyntheticWithdrawalDirectory, validWithdrawalsView } from "../src/withdrawals.mjs";
import {
  NOW_MS,
  OPERATOR_SUBJECT,
  REQUEST_ID,
  SUBJECT,
  TEST_KEY,
  VERIFIED_SUBJECT,
  auditOperatorHeaders,
  customerHeaders,
  operationIdFor,
  operatorHeaders,
  operatorToken,
  orderIdFor,
  request,
  startTestServer,
  stopServer,
  token,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const APP_SOURCE = readFileSync(new URL("../src/app.mjs", import.meta.url), "utf8");

// getOperatorQueue accepts ?kind and getOperatorAudit accepts ?cursor; every
// other served read must refuse a query string. Anything else that starts
// accepting one widens the wire without a contract entry.
const QUERY_OPERATIONS = new Set(["getOperatorQueue", "getOperatorAudit"]);

// A foreign well-formed id for each member read: correct shape, minted by a
// different family, so a prefix grammar gap would route it into a lookup
// instead of rejecting it the way a never-minted id is rejected.
function memberIds() {
  return (async () => {
    const screenings = await createSyntheticAddressScreeningDirectory().listFor(VERIFIED_SUBJECT);
    const subjects = createSyntheticOperatorSubjectsDirectory();
    const subjectList = await subjects.subjectsFor();
    const kycQueue = await subjects.queueFor("kyc");
    return {
      orderId: await orderIdFor(VERIFIED_SUBJECT),
      operationId: await operationIdFor(VERIFIED_SUBJECT),
      screeningId: screenings.screenings[0].screening_id,
      instrument: "USDT/RUB",
      subjectId: subjectList.subjects[0].subject_id,
      kind: "kyc",
      itemId: kycQueue.queue.items[0].queue_id
    };
  })();
}

// The {param} -> concrete id substitution for one operation. Member routes
// always resolve against VERIFIED_SUBJECT's own minted ids.
function concretePath(operation, ids) {
  return operation.path
    .replace("{orderId}", ids.orderId)
    .replace("{instrument}", encodeURIComponent(ids.instrument))
    .replace("{screeningId}", ids.screeningId)
    .replace("{operationId}", ids.operationId)
    .replace("{subjectId}", ids.subjectId)
    .replace("{kind}", ids.kind)
    .replace("{itemId}", ids.itemId);
}

function headersFor(operation) {
  if (!operation.authenticated) {
    return [["x-request-id", REQUEST_ID]];
  }
  if (operation.operationId === "getOperatorAudit") {
    return auditOperatorHeaders();
  }
  if (operation.operationId.startsWith("getOperator")) {
    return operatorHeaders();
  }
  return verifiedCustomerHeaders();
}

// The capability a route must consult before serving, derived from its
// contract path: /<ns>/<tail> -> <ns>.<tail>.read. Member routes share the
// collection's capability (a member read is never its own capability).
function expectedCapability(operation) {
  const segments = operation.path.split("/").filter((s) => s.length > 0 && !s.startsWith("{"));
  const namespace = operation.path.startsWith("/api/v1/operator/") ? "operator" : "customer";
  return `${namespace}.${segments[segments.length - 1]}.read`;
}

// Whether the policy marks an operation's capability KYC-gated. Ungated
// reads (session, capabilities, kyc, profile, support, auth, users) must
// serve unverified subjects; gated ones must 403 them.
function requiresVerifiedKyc(operation) {
  const entry = CAPABILITY_POLICY.find((policy) => policy.capability === expectedCapability(operation));
  return entry === undefined ? null : entry.requiresVerifiedKyc;
}

const ENVELOPE_KEYS = JSON.stringify(["code", "details", "message", "request_id"]);
function assertEnvelope(response, operation, context) {
  const body = JSON.parse(response.body);
  assert.equal(
    JSON.stringify(Object.keys(body).sort()),
    ENVELOPE_KEYS,
    `${operation.operationId} ${context}: error body must carry exactly {code, message, request_id, details}`
  );
  assert.equal(typeof body.details, "object", `${operation.operationId} ${context}: details must be an object`);
  return body;
}

test("method gate: every served read answers non-GET methods with the uniform 404 envelope", async () => {
  const { server, port } = await startTestServer();
  try {
    const ids = await memberIds();
    for (const operation of OPERATIONS) {
      const path = concretePath(operation, ids);
      for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
        const response = await request(port, { method, path, headers: headersFor(operation) });
        assert.equal(response.status, 404, `${method} ${operation.operationId}`);
        assert.equal(assertEnvelope(response, operation, `${method}`).code, "CAPABILITY_DENIED");
      }
      const head = await request(port, { method: "HEAD", path, headers: headersFor(operation) });
      assert.equal(head.status, 404, `HEAD ${operation.operationId}`);
      assert.equal(head.body, "", `HEAD ${operation.operationId} must not emit a body`);
    }
  } finally {
    await stopServer(server);
  }
});

test("body gate: every served read rejects a request body uniformly", async () => {
  const { server, port } = await startTestServer();
  try {
    const ids = await memberIds();
    for (const operation of OPERATIONS) {
      const path = concretePath(operation, ids);
      for (const bodyHeaders of [
        [["content-length", "3"]],
        [["transfer-encoding", "chunked"]]
      ]) {
        const response = await request(port, {
          method: "GET",
          path,
          headers: [...headersFor(operation), ...bodyHeaders]
        });
        assert.equal(response.status, 400, `${operation.operationId} body headers ${JSON.stringify(bodyHeaders)}`);
        assert.equal(assertEnvelope(response, operation, "body gate").code, "VALIDATION_FAILED");
      }
    }
  } finally {
    await stopServer(server);
  }
});

test("query gate: only the two query-declaring reads accept a query string", async () => {
  const { server, port } = await startTestServer();
  try {
    const ids = await memberIds();
    for (const operation of OPERATIONS) {
      const path = `${concretePath(operation, ids)}?unexpected=1`;
      const response = await request(port, { method: "GET", path, headers: headersFor(operation) });
      if (QUERY_OPERATIONS.has(operation.operationId)) {
        // The two query reads run a strict single-parameter allowlist: a
        // query that is not exactly the declared parameter fails as
        // malformed input rather than falling through to a 404.
        assert.equal(response.status, 400, `${operation.operationId} must fail undeclared query parameters`);
        assert.equal(assertEnvelope(response, operation, "query gate").code, "VALIDATION_FAILED");
      } else {
        assert.equal(response.status, 404, `${operation.operationId} must refuse any query string`);
        assert.equal(assertEnvelope(response, operation, "query gate").code, "CAPABILITY_DENIED");
      }
    }
    // A declared parameter carrying an extra sibling parameter is equally
    // malformed on the query reads.
    const extra = await request(port, {
      method: "GET",
      path: "/api/v1/operator/queue?kind=kyc&unexpected=1",
      headers: operatorHeaders()
    });
    assert.equal(extra.status, 400, "queue must refuse extra parameters alongside kind");
  } finally {
    await stopServer(server);
  }
});

test("id grammar: member reads answer a wrong-shape id identically to a well-formed unknown id", async () => {
  const { server, port } = await startTestServer();
  try {
    const probes = [
      ["/api/v1/customer/exchange-orders/not_an_id", "/api/v1/customer/exchange-orders/ord_000000000000000000000000", verifiedCustomerHeaders()],
      ["/api/v1/customer/exchange-orders/usr_xxxxxxxxxxxxxxxxxxxxxxxx", "/api/v1/customer/exchange-orders/ord_000000000000000000000000", verifiedCustomerHeaders()],
      ["/api/v1/customer/operations/not_an_id", "/api/v1/customer/operations/ope_000000000000000000000000", verifiedCustomerHeaders()],
      ["/api/v1/customer/address-screenings/not_an_id", "/api/v1/customer/address-screenings/scr_00000000000000000000000000000000", verifiedCustomerHeaders()],
      ["/api/v1/operator/subjects/not_an_id", "/api/v1/operator/subjects/syn_cust_00000000", operatorHeaders()],
      ["/api/v1/operator/subjects/usr_xxxxxxxxxxxx", "/api/v1/operator/subjects/syn_cust_00000000", operatorHeaders()],
      ["/api/v1/operator/queue/kyc/not_an_id", "/api/v1/operator/queue/kyc/qky_000000000000000000000000", operatorHeaders()],
      ["/api/v1/operator/queue/badkind/qky_000000000000000000000000", "/api/v1/operator/queue/kyc/qky_000000000000000000000000", operatorHeaders()]
    ];
    for (const [bad, unknown, headers] of probes) {
      const badResponse = await request(port, { method: "GET", path: bad, headers });
      const unknownResponse = await request(port, { method: "GET", path: unknown, headers });
      assert.equal(badResponse.status, 404, `${bad}: malformed id must not leak`);
      assert.equal(unknownResponse.status, 404, `${unknown}: never-minted well-formed id must not leak`);
      assert.equal(badResponse.body, unknownResponse.body, `${bad}: wrong-shape and unknown ids must answer identically`);
    }
    // Customer variants of the same probes use customer headers.
    const customerProbes = [
      ["/api/v1/customer/exchange-orders/not_an_id", "/api/v1/customer/exchange-orders/ord_000000000000000000000000"],
      ["/api/v1/customer/operations/not_an_id", "/api/v1/customer/operations/ope_000000000000000000000000"],
      ["/api/v1/customer/address-screenings/not_an_id", "/api/v1/customer/address-screenings/scr_00000000000000000000000000000000"]
    ];
    for (const [bad, unknown] of customerProbes) {
      const badResponse = await request(port, { method: "GET", path: bad, headers: verifiedCustomerHeaders() });
      const unknownResponse = await request(port, { method: "GET", path: unknown, headers: verifiedCustomerHeaders() });
      assert.equal(badResponse.status, 404, `${bad}: malformed id must not leak`);
      assert.equal(unknownResponse.status, 404, `${unknown}: never-minted well-formed id must not leak`);
      assert.equal(badResponse.body, unknownResponse.body, `${bad}: wrong-shape and unknown ids must answer identically`);
    }
    // The instrument member read fails closed uniformly on every malformed
    // shape — missing %2F separator, empty side, or lower-case non-shape.
    const depthBase = "/api/v1/customer/markets/";
    for (const malformed of ["USDTRUB", "USDT%2F", "%2FRUB", "usdt%2Frub", "not_an_id"]) {
      const malformedResponse = await request(port, { method: "GET", path: `${depthBase}${malformed}`, headers: verifiedCustomerHeaders() });
      const unknownResponse = await request(port, { method: "GET", path: `${depthBase}AAA%2FBBB`, headers: verifiedCustomerHeaders() });
      assert.equal(malformedResponse.status, 404, `markets/${malformed}: malformed instrument must not leak`);
      assert.equal(malformedResponse.body, unknownResponse.body, `markets/${malformed}: malformed and unknown must answer identically`);
    }
    // A queue item minted for another kind is indistinguishable from an
    // unknown item inside the requested kind.
    const amlQueue = await createSyntheticOperatorSubjectsDirectory().queueFor("aml");
    const amlItemId = amlQueue.queue.items[0].queue_id;
    const crossKind = await request(port, {
      method: "GET",
      path: `/api/v1/operator/queue/kyc/${amlItemId}`,
      headers: operatorHeaders()
    });
    const unknownItem = await request(port, {
      method: "GET",
      path: "/api/v1/operator/queue/kyc/qky_000000000000000000000000",
      headers: operatorHeaders()
    });
    assert.equal(crossKind.status, 404, "a foreign-kind queue id must not 200 under another kind");
    assert.equal(crossKind.body, unknownItem.body, "foreign-kind and unknown item ids must answer identically");
  } finally {
    await stopServer(server);
  }
});

test("capability gate: unverified subjects get 403 on exactly the KYC-gated capability set", async () => {
  const { server, port } = await startTestServer();
  try {
    const ids = await memberIds();
    for (const operation of OPERATIONS) {
      if (!operation.authenticated || operation.operationId.startsWith("getOperator")) {
        continue;
      }
      const gated = requiresVerifiedKyc(operation);
      assert.notEqual(gated, null, `${operation.operationId}: capability ${expectedCapability(operation)} must exist in CAPABILITY_POLICY`);
      const response = await request(port, {
        method: "GET",
        path: concretePath(operation, ids),
        headers: customerHeaders()
      });
      if (gated) {
        assert.equal(response.status, 403, `${operation.operationId}: unverified subject must be denied`);
        assert.equal(assertEnvelope(response, operation, "kyc gate").code, "CAPABILITY_DENIED");
      } else {
        assert.equal(response.status, 200, `${operation.operationId}: ungated read must serve unverified subjects`);
      }
    }
    // The gated set must gate before lookup: an unverified subject holding
    // a real member id still gets 403, never 404.
    for (const memberPath of [
      `/api/v1/customer/exchange-orders/${ids.orderId}`,
      `/api/v1/customer/operations/${ids.operationId}`,
      `/api/v1/customer/address-screenings/${ids.screeningId}`,
      "/api/v1/customer/markets/USDT%2FRUB"
    ]) {
      const response = await request(port, { method: "GET", path: memberPath, headers: customerHeaders() });
      assert.equal(response.status, 403, `${memberPath}: gate must run before the id lookup`);
    }
  } finally {
    await stopServer(server);
  }
});

test("capabilities read: the advertised set equals the evaluated grant set per actor", async () => {
  const { server, port } = await startTestServer();
  try {
    for (const [headers, kycStatus] of [
      [verifiedCustomerHeaders(), "verified"],
      [customerHeaders(), "unverified"]
    ]) {
      const response = await request(port, { method: "GET", path: "/api/v1/customer/capabilities", headers });
      assert.equal(response.status, 200);
      const view = JSON.parse(response.body);
      assert.deepEqual(
        [...view.capabilities].sort(),
        [...evaluateCapabilities({ kycStatus }).granted].sort(),
        `${kycStatus}: served capabilities must equal evaluateCapabilities().granted`
      );
      assert.equal(view.commands_enabled, false);
    }
    for (const [headers, subject] of [
      [operatorHeaders(), OPERATOR_SUBJECT],
      [auditOperatorHeaders(), "syn_oper_0000000000000002"]
    ]) {
      const response = await request(port, { method: "GET", path: "/api/v1/operator/capabilities", headers });
      assert.equal(response.status, 200);
      const view = JSON.parse(response.body);
      assert.deepEqual(
        [...view.capabilities].sort(),
        [...evaluateOperatorCapabilities({ role: operatorRoleFor(subject) }).granted].sort(),
        `${subject}: served capabilities must equal evaluateOperatorCapabilities().granted`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test("audience isolation: cross-audience tokens fail closed as unauthenticated", async () => {
  const { server, port } = await startTestServer();
  try {
    const ids = await memberIds();
    // A customer token on an operator route keeps the mandatory device
    // header (its absence would 400 before auth); the audience check then
    // answers 401. An operator token on a customer route must NOT carry
    // X-Device-Id — customer surfaces refuse the header itself — so it is
    // sent inside the customer header shape.
    const customerTokenOnOperator = operatorHeaders({ Authorization: `Bearer ${token({ subject: VERIFIED_SUBJECT })}` });
    const operatorTokenOnCustomer = verifiedCustomerHeaders({ Authorization: `Bearer ${operatorToken()}` });
    for (const operation of OPERATIONS) {
      if (!operation.authenticated) {
        continue;
      }
      const path = concretePath(operation, ids);
      if (operation.operationId.startsWith("getOperator")) {
        const response = await request(port, { method: "GET", path, headers: customerTokenOnOperator });
        assert.equal(response.status, 401, `${operation.operationId}: customer token must not authenticate`);
      } else {
        const response = await request(port, { method: "GET", path, headers: operatorTokenOnCustomer });
        assert.equal(response.status, 401, `${operation.operationId}: operator token must not authenticate`);
      }
    }
  } finally {
    await stopServer(server);
  }
});

test("audit pagination: bounded pages, stable as_of, byte-identical cursor replay, foreign cursors refused", async () => {
  const { server, port } = await startTestServer();
  try {
    const first = await request(port, { method: "GET", path: "/api/v1/operator/audit", headers: auditOperatorHeaders() });
    assert.equal(first.status, 200);
    const page1 = JSON.parse(first.body);
    assert.ok(page1.audit.entries.length > 0 && page1.audit.entries.length <= OPERATOR_AUDIT_PAGE_SIZE, "audit page must be bounded");
    assert.equal(typeof page1.audit.as_of, "string");
    assert.ok(page1.audit.next_cursor === null || /^auc_[0-9a-f]{16}$/u.test(page1.audit.next_cursor));

    // Replay page 1: byte-identical.
    const firstAgain = await request(port, { method: "GET", path: "/api/v1/operator/audit", headers: auditOperatorHeaders() });
    assert.equal(firstAgain.body, first.body, "page 1 must be byte-identical on repeat fetch");

    // Walk every page; as_of stays pinned, each next_cursor replays
    // byte-identically, and the walk terminates with next_cursor null.
    const seen = new Set();
    let cursor = page1.audit.next_cursor;
    let pages = 1;
    const asOf = page1.audit.as_of;
    while (cursor !== null) {
      const response = await request(port, { method: "GET", path: `/api/v1/operator/audit?cursor=${cursor}`, headers: auditOperatorHeaders() });
      assert.equal(response.status, 200, `cursor ${cursor} must resolve`);
      const replay = await request(port, { method: "GET", path: `/api/v1/operator/audit?cursor=${cursor}`, headers: auditOperatorHeaders() });
      assert.equal(replay.body, response.body, `cursor ${cursor} must replay byte-identically`);
      const page = JSON.parse(response.body);
      assert.equal(page.audit.as_of, asOf, "as_of must be stable across pages");
      assert.ok(page.audit.entries.length <= OPERATOR_AUDIT_PAGE_SIZE, "every page must be bounded");
      for (const entry of page.audit.entries) {
        assert.ok(!seen.has(entry.audit_id), `entry ${entry.audit_id} must not repeat across pages`);
        seen.add(entry.audit_id);
      }
      cursor = page.audit.next_cursor;
      pages += 1;
      assert.ok(pages <= 10, "cursor walk must terminate");
    }
    assert.ok(seen.size > 0, "the walk must have covered at least one audit entry");

    // Malformed cursors fail as malformed input; a well-formed
    // never-minted cursor 404s; a foreign-family cursor never resolves.
    for (const [cursorValue, expected] of [
      ["not_a_cursor", 400],
      ["auc_zzzzzzzzzzzzzzzz", 400],
      ["auc_0000000000000000", 404],
      [`ord_${"0".repeat(24)}`, 400],
      ["auc_0000000000000000extra", 400],
      ["auc_000000000000000", 400],
      ["auc_00000000000000000", 400]
    ]) {
      const response = await request(port, { method: "GET", path: `/api/v1/operator/audit?cursor=${cursorValue}`, headers: auditOperatorHeaders() });
      assert.equal(response.status, expected, `cursor ${cursorValue}`);
    }
  } finally {
    await stopServer(server);
  }
});

test("envelope uniformity: every failure class emits exactly {code, message, request_id, details}", async () => {
  const { server, port } = await startTestServer();
  try {
    const ids = await memberIds();
    const checks = [
      // 401 missing token
      ["GET", "/api/v1/customer/session", [["x-request-id", REQUEST_ID], ["x-client-version", "1"], ["x-platform", "ios"]]],
      // 400 malformed request id
      ["GET", "/api/v1/customer/session", verifiedCustomerHeaders().map(([n, v]) => (n.toLowerCase() === "x-request-id" ? [n, "not-a-uuid"] : [n, v]))],
      // 403 kyc gate
      ["GET", "/api/v1/customer/wallets", customerHeaders()],
      // 404 unmatched route
      ["GET", "/api/v1/nowhere", verifiedCustomerHeaders()],
      // 404 member miss
      ["GET", `/api/v1/customer/exchange-orders/ord_${"0".repeat(24)}`, verifiedCustomerHeaders()],
      // 400 body on GET
      ["GET", "/api/v1/customer/session", [...verifiedCustomerHeaders(), ["content-length", "3"]]],
      // 400 bad cursor
      ["GET", "/api/v1/operator/audit?cursor=not_a_cursor", auditOperatorHeaders()],
      // 403 role gate on audit
      ["GET", "/api/v1/operator/audit", operatorHeaders()],
      // 429 after exhausting the fixed window is covered by rate-limit
      // tests; here assert only the shared envelope on the sampled classes.
      ["GET", `/api/v1/customer/operations/${ids.operationId}?extra=1`, verifiedCustomerHeaders()]
    ];
    for (const [method, path, headers] of checks) {
      const response = await request(port, { method, path, headers });
      assert.ok(response.status >= 400, `${method} ${path} must fail`);
      const body = assertEnvelope(response, { operationId: path }, "envelope");
      assert.equal(JSON.stringify(body.details), "{}", `${path}: details must stay empty on wire failures`);
      assert.ok(!("stack" in body) && !("_meta" in body) && !("error" in body), `${path}: no internal fields`);
    }
  } finally {
    await stopServer(server);
  }
});

test("determinism: every served read is byte-identical across repeated fetches", async () => {
  const { server, port } = await startTestServer();
  try {
    const ids = await memberIds();
    for (const operation of OPERATIONS) {
      const path = concretePath(operation, ids);
      const first = await request(port, { method: "GET", path, headers: headersFor(operation) });
      const second = await request(port, { method: "GET", path, headers: headersFor(operation) });
      assert.equal(second.status, first.status, `${operation.operationId} status must be stable`);
      assert.equal(second.body, first.body, `${operation.operationId} body must be byte-identical`);
    }
  } finally {
    await stopServer(server);
  }
});

test("subject isolation: member reads never serve another subject's record", async () => {
  const { server, port } = await startTestServer();
  try {
    // Mint VERIFIED_SUBJECT's real ids but request them as the unverified
    // SUBJECT (403 gate) and — stronger — mint the *other* subject's ids on
    // a route family that is ungated would still 404. For gated routes the
    // isolation check is that a foreign id answers identically to unknown.
    const foreignOrder = await orderIdFor(SUBJECT);
    const foreignOperation = await operationIdFor(SUBJECT);
    const foreignScreenings = await createSyntheticAddressScreeningDirectory().listFor(SUBJECT);
    const foreignScreening = foreignScreenings.screenings[0].screening_id;
    for (const path of [
      `/api/v1/customer/exchange-orders/${foreignOrder}`,
      `/api/v1/customer/operations/${foreignOperation}`,
      `/api/v1/customer/address-screenings/${foreignScreening}`
    ]) {
      const response = await request(port, { method: "GET", path, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, `${path}: a foreign subject's id must never 200`);
    }
    // Operator subject member reads: a real customer subject id always
    // resolves — assert a malformed subject id cannot.
    const malformedSubject = await request(port, {
      method: "GET",
      path: "/api/v1/operator/subjects/usr_000000000000000000000000",
      headers: operatorHeaders()
    });
    assert.equal(malformedSubject.status, 404, "wrong-prefix subject id must not resolve");
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// Defect reproduction: the two audit findings. These tests are expected to
// fail before the fixes in this same change and pass after them.
// ---------------------------------------------------------------------------

// Every ISO-8601-shaped string field in a view is replaced in depth; the
// validator for that view must answer false — never throw — because a
// validator that throws on hostile input turns a data bug into a 500.
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
function corruptInstants(value, replacement) {
  if (typeof value === "string") {
    return INSTANT_PATTERN.test(value) ? replacement : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => corruptInstants(entry, replacement));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, corruptInstants(entry, replacement)]));
  }
  return value;
}
function countInstants(value) {
  if (typeof value === "string") {
    return INSTANT_PATTERN.test(value) ? 1 : 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countInstants(entry), 0);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce((total, entry) => total + countInstants(entry), 0);
  }
  return 0;
}

const instantViews = [
  ["activity", () => createSyntheticActivityDirectory().viewFor(VERIFIED_SUBJECT), validActivityView],
  ["address-screenings", () => createSyntheticAddressScreeningDirectory().listFor(VERIFIED_SUBJECT), validAddressScreeningsView],
  [
    "address-screening",
    async () => {
      const directory = createSyntheticAddressScreeningDirectory();
      const list = await directory.listFor(VERIFIED_SUBJECT);
      return directory.viewFor(VERIFIED_SUBJECT, list.screenings[0].screening_id);
    },
    validAddressScreeningView
  ],
  ["auth-sessions", () => createSyntheticAuthSessionDirectory().listFor(VERIFIED_SUBJECT), validAuthSessionsView],
  ["cards", () => createSyntheticCardDirectory().listFor(VERIFIED_SUBJECT), validCardsView],
  ["checks", () => createSyntheticCheckDirectory().viewFor(VERIFIED_SUBJECT), validChecksView],
  ["deposit-addresses", () => createSyntheticDepositAddressDirectory().listFor(VERIFIED_SUBJECT), validDepositAddressesView],
  ["deposits", () => createSyntheticDepositDirectory().listFor(VERIFIED_SUBJECT), validDepositsView],
  ["exchange-orders", () => createSyntheticExchangeOrderDirectory().listFor(VERIFIED_SUBJECT), validExchangeOrdersView],
  [
    "exchange-order",
    async () =>
      createSyntheticExchangeOrderDirectory().orderFor(VERIFIED_SUBJECT, await orderIdFor(VERIFIED_SUBJECT)),
    validExchangeOrderDetailView
  ],
  ["markets", () => createSyntheticMarketDirectory().listFor(VERIFIED_SUBJECT), validMarketsView],
  ["market-depth", () => createSyntheticMarketDirectory().depthFor(VERIFIED_SUBJECT, "USDT/RUB"), validMarketDepthView],
  ["trades", () => createSyntheticTradeDirectory().listFor(VERIFIED_SUBJECT), validTradesView],
  ["kyc", () => createSyntheticKycApplicationDirectory().viewFor(VERIFIED_SUBJECT, "verified"), validKycStatusView],
  ["notifications", () => createSyntheticNotificationDirectory().listFor(VERIFIED_SUBJECT), validNotificationsView],
  ["operations", () => createSyntheticOperationDirectory().viewFor(VERIFIED_SUBJECT), validOperationsView],
  [
    "operation",
    async () => createSyntheticOperationDirectory().operationFor(VERIFIED_SUBJECT, await operationIdFor(VERIFIED_SUBJECT)),
    validOperationView
  ],
  [
    "operator-admin",
    async () => {
      const granted = evaluateOperatorCapabilities({ role: operatorRoleFor(OPERATOR_SUBJECT) }).granted;
      return createSyntheticOperatorDirectory().viewFor(OPERATOR_SUBJECT, granted);
    },
    validOperatorAdminView
  ],
  [
    "operator-session",
    async () => {
      const verifier = createSyntheticTokenVerifier({ key: TEST_KEY, clock: () => NOW_MS });
      const principal = await verifier.verify(operatorToken());
      return operatorSessionViewFor(principal);
    },
    validOperatorSessionView
  ],
  ["operator-subjects", () => createSyntheticOperatorSubjectsDirectory().subjectsFor(), validOperatorSubjectsView],
  [
    "operator-subject",
    async () => {
      const directory = createSyntheticOperatorSubjectsDirectory();
      const list = await directory.subjectsFor();
      return directory.subjectFor(list.subjects[0].subject_id);
    },
    validOperatorSubjectDetailView
  ],
  ["operator-queue", () => createSyntheticOperatorSubjectsDirectory().queueFor("kyc"), validOperatorQueueView],
  [
    "operator-queue-item",
    async () => {
      const directory = createSyntheticOperatorSubjectsDirectory();
      const queue = await directory.queueFor("kyc");
      return directory.queueItemFor("kyc", queue.queue.items[0].queue_id);
    },
    validOperatorQueueItemDetail
  ],
  ["operator-audit", () => createSyntheticOperatorSubjectsDirectory().auditFor(), validOperatorAuditView],
  ["payments", () => createSyntheticPaymentDirectory().listFor(VERIFIED_SUBJECT), validPaymentsView],
  ["profile", () => createSyntheticProfileDirectory().viewFor(VERIFIED_SUBJECT), validProfileView],
  ["quotes", () => createSyntheticQuoteDirectory().listFor(VERIFIED_SUBJECT), validQuotesView],
  ["support", () => createSyntheticSupportDirectory().listFor(VERIFIED_SUBJECT), validSupportTicketsView],
  ["users", () => createSyntheticUserDirectory().viewFor(VERIFIED_SUBJECT), validUserView],
  ["withdrawals", () => createSyntheticWithdrawalDirectory().listFor(VERIFIED_SUBJECT), validWithdrawalsView]
];

// The control views carry no instant fields: corruption must be a no-op and
// the validator must still accept — this proves the sweep only mutates
// instant-shaped strings.
const noInstantViews = [
  ["wallets", () => createSyntheticWalletDirectory().listFor(VERIFIED_SUBJECT), validWalletsView],
  [
    "operator-capabilities",
    () => operatorCapabilitiesViewFor(evaluateOperatorCapabilities({ role: operatorRoleFor(OPERATOR_SUBJECT) })),
    validOperatorCapabilitiesView
  ]
];

test("timestamp hygiene: every instant-bearing view validator returns false — never throws — on impossible instants", async () => {
  for (const [name, viewFor, validator] of instantViews) {
    const view = await viewFor();
    assert.ok(countInstants(view) > 0, `${name}: expected at least one instant field in the synthetic view`);
    for (const impossible of ["2026-13-01T00:00:00.000Z", "2026-02-30T00:00:00.000Z", "2026-01-01T24:00:00.000Z"]) {
      const corrupted = corruptInstants(view, impossible);
      let result;
      assert.doesNotThrow(() => {
        result = validator(corrupted);
      }, `${name}: validating ${impossible} must not throw`);
      assert.equal(result, false, `${name}: ${impossible} must fail validation`);
    }
    // Sanity: the uncorrupted view still validates.
    assert.equal(validator(view), true, `${name}: the unmolested view must still validate`);
  }
  for (const [name, viewFor, validator] of noInstantViews) {
    const view = await viewFor();
    assert.equal(countInstants(view), 0, `${name}: control view must carry no instant fields`);
    assert.equal(validator(corruptInstants(view, "2026-13-01T00:00:00.000Z")), true, `${name}: corruption must be a no-op`);
  }
});

test("dispatch consistency: every served operation has an explicit arm that consults its capability", () => {
  for (const operation of OPERATIONS) {
    const marker = `operation.operationId === "${operation.operationId}"`;
    const start = APP_SOURCE.indexOf(marker);
    assert.notEqual(start, -1, `${operation.operationId} must be dispatched by an explicit operationId arm, not a property check or fallthrough`);
    const next = APP_SOURCE.indexOf("operation.operationId ===", start + marker.length);
    const slice = APP_SOURCE.slice(start, next === -1 ? undefined : next);
    if (operation.authenticated) {
      const capability = expectedCapability(operation);
      assert.ok(
        slice.includes(`granted.includes("${capability}")`),
        `${operation.operationId} must consult the capability registry for ${capability} before serving`
      );
    }
  }
  // The dispatcher must fail closed past the last arm: a contract entry
  // without a handler can never reach a default response.
  const lastArm = APP_SOURCE.lastIndexOf("operation.operationId ===");
  const tail = APP_SOURCE.slice(lastArm);
  assert.ok(tail.includes("throw new Error("), "the pipeline must end in a fail-closed throw, not an implicit response");
});
