import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import {
  mintSyntheticCustomerToken,
  mintSyntheticOperatorToken
} from "@solidchange/customer-api/synthetic-token";
import { evaluateOperatorCapabilities } from "../../customer-api/src/capabilities.mjs";
import {
  createSyntheticOperatorDirectory,
  createSyntheticOperatorSubjectsDirectory,
  operatorRoleFor
} from "../../customer-api/src/operator.mjs";
import { customerApiSubject } from "../../../backoffice/.server-dist/server/customer-api-client.js";
import {
  backofficeEntry,
  cookieOf,
  customerApiEntry,
  readJson,
  startService,
  startServiceOnFreePort,
  stopService,
  verifyEnvelope
} from "./stack.mjs";

// Operator read chain of the dev stack: the REAL backoffice BFF (subprocess,
// dev mode, device-binding enforced) wired to the REAL customer-api
// (subprocess, synthetic HMAC auth) through the operator audience. Drives the
// whole served namespace — BFF dev session → subjects → subject-360 → queue →
// queue item → audit feed — plus the fail-closed paths (out-of-enum kind,
// wrong-kind item, missing audit:read, a customer-family token on an operator
// route) and the degrade arm (upstream kill → 503 → restart → recover). Every
// BFF payload is a signed envelope verified against the live keyset and deep
// compared to the upstream synthetic directories, so a wiring break — a
// capability drift, a signed-resource mismatch, a lost device binding — fails
// here rather than escaping e2e coverage.

const backofficeOrigin = "http://127.0.0.1:5174";
const devTokenKey = randomBytes(32).toString("hex");
const sessionCookieName = "solidchange_bo_session";
const deviceCookie = `solidchange_bo_device=${randomUUID()}`;
const deviceId = deviceCookie.split("=")[1];
// The session store binds one active session per workstation device, so the
// denied-role session (support-l1) runs on a second approved device — sharing
// one device would evict the earlier session under the device-binding rule.
const supportDeviceCookie = `solidchange_bo_device=${randomUUID()}`;
const supportDeviceId = supportDeviceCookie.split("=")[1];
// The approved-device digest is pinned to the documented recipe rather than
// recomputed through the BFF's own deviceDigest: a drift in either direction
// must fail here, not be absorbed.
const digestOf = (id) =>
  createHash("sha256").update(`solidchange-operator-device:v1:${id}`).digest("hex");
const approvedDeviceDigest = `${digestOf(deviceId)},${digestOf(supportDeviceId)}`;

let customerApi;
let customerApiBase;
let customerApiPort;
let backoffice;
let backofficeBase;
let keyset;
const subjectsDirectory = createSyntheticOperatorSubjectsDirectory();
const operatorDirectory = createSyntheticOperatorDirectory();

const customerApiEnv = {
  CUSTOMER_API_HOST: "127.0.0.1",
  // The kernel assigns the port and the ready match reports it back — no
  // probe-release-bind window a sibling test file could steal. On the
  // degrade restart the same port is rebound explicitly because the BFF's
  // configured upstream URL points at it.
  CUSTOMER_API_PORT: "0",
  CUSTOMER_API_DEV_AUTH: "synthetic",
  CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey,
  // The BFF's own upstream traffic and this file's direct probes share the
  // loopback-IP rate bucket; pinning the window explicitly keeps the margin
  // honest instead of borrowing it from the route-count coincidence.
  CUSTOMER_API_RATE_LIMIT_PER_MINUTE: "5000"
};

function startCustomerApi() {
  return startService(
    customerApiEntry,
    customerApiEnv,
    /listening on http:\/\/127\.0\.0\.1:(\d+) auth=synthetic/
  );
}

before(async () => {
  customerApi = await startCustomerApi();
  customerApiPort = customerApi.match[1];
  customerApiBase = `http://127.0.0.1:${customerApiPort}`;

  backoffice = await startServiceOnFreePort(
    backofficeEntry,
    {
      BACKOFFICE_BFF_HOST: "127.0.0.1",
      BACKOFFICE_BFF_PORT: "",
      BACKOFFICE_ALLOWED_ORIGINS: backofficeOrigin,
      BACKOFFICE_ALLOW_DEV_LOGIN: "true",
      BACKOFFICE_CUSTOMER_API_URL: customerApiBase,
      BACKOFFICE_CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey,
      BACKOFFICE_DEVICE_BINDING: "enforce",
      BACKOFFICE_APPROVED_DEVICE_DIGESTS: approvedDeviceDigest
    },
    /Backoffice BFF listening on http:\/\/127\.0\.0\.1:(\d+)/,
    "BACKOFFICE_BFF_PORT"
  );
  backofficeBase = `http://127.0.0.1:${backoffice.match[1]}`;

  const response = await fetch(`${backofficeBase}/bff/api/signing-keys`);
  assert.equal(response.status, 200);
  keyset = await readJson(response);
  // The published keyset is the contract the envelopes verify against: pin
  // its advertised shape too, not only that envelopes happen to match it.
  assert.equal(keyset.formatVersion, 1);
  assert.equal(keyset.backend, "ephemeral-dev");
  assert.ok(
    keyset.keys.some(
      (key) =>
        key.keyId === keyset.activeKeyId &&
        key.status === "active" &&
        key.algorithm === "Ed25519"
    )
  );
});

after(async () => {
  await Promise.all([stopService(customerApi), stopService(backoffice)]);
});

async function operatorSession(role, device = deviceCookie) {
  const response = await fetch(`${backofficeBase}/bff/auth/dev-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: backofficeOrigin,
      cookie: device
    },
    body: JSON.stringify({ role })
  });
  assert.equal(response.status, 200, role);
  const session = cookieOf(response);
  assert.equal(session.startsWith(`${sessionCookieName}=`), true);
  const envelope = await readJson(response);
  assert.equal(envelope.resource, "auth/dev-session");
  assert.equal(envelope.payload.authenticated, true);
  assert.equal(verifyEnvelope(envelope, keyset), true);
  return `${session}; ${device}`;
}

function bffGet(path, cookie) {
  return fetch(`${backofficeBase}${path}`, { headers: { cookie } });
}

async function signedGet(path, cookie, resource) {
  const response = await bffGet(path, cookie);
  assert.equal(response.status, 200, path);
  const envelope = await readJson(response);
  assert.equal(envelope.resource, resource, path);
  // No key rotation is configured in this chain: every envelope must be
  // signed under the advertised active key. `verifyEnvelope` enforces the
  // full consumer-side contract (requestId non-empty, canonical issuedAt and
  // signature, canonical payload) — not merely the Ed25519 check.
  assert.equal(envelope.keyId, keyset.activeKeyId, path);
  assert.equal(verifyEnvelope(envelope, keyset), true, `${path} signature`);
  return envelope.payload;
}

async function deniedGet(path, cookie, status, error) {
  const response = await bffGet(path, cookie);
  assert.equal(response.status, status, path);
  assert.deepEqual(await readJson(response), { error }, path);
}

function upstreamHeaders(token, { device = deviceId, extra = {} } = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
    "x-request-id": generateUuidV7(),
    "x-client-version": "e2e-dev-operator-chain",
    "x-platform": "operator-web",
    ...extra
  };
  if (device !== null) {
    headers["x-device-id"] = device;
  }
  return headers;
}

function mintOperator(subject) {
  return mintSyntheticOperatorToken({
    key: devTokenKey,
    subject,
    expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
  });
}

async function upstreamGet(path, token, options = {}) {
  const response = await fetch(`${customerApiBase}${path}`, {
    headers: upstreamHeaders(token, options)
  });
  return response;
}

// The camelCase projections the BFF adapters must reproduce verbatim from the
// upstream contract rows: each maps exactly the fields server.ts maps, in the
// same order, so the deep comparison below proves the pass-through.
function subjectRowOf(row) {
  return {
    subjectId: row.subject_id,
    displayName: row.display_name,
    kycStatus: row.kyc_status,
    flags: row.flags,
    registeredAt: row.registered_at,
    lastActiveAt: row.last_active_at,
    posting: row.posting
  };
}

function subjectDetailOf(subject) {
  return {
    ...subjectRowOf(subject),
    accountStatus: subject.account_status,
    contactHash: subject.contact_hash,
    sessions: subject.sessions,
    devices: [...subject.devices],
    limits: {
      maxSessions: subject.limits.max_sessions,
      maxDevices: subject.limits.max_devices
    },
    recentActivity: subject.recent_activity.map((item) => ({
      activityId: item.activity_id,
      kind: item.kind,
      occurredAt: item.occurred_at,
      summary: item.summary,
      money: item.money === null ? null : { amount: item.money.amount, asset: item.money.asset }
    })),
    kyc: kycOf(subject.kyc),
    balances: subject.balances.map((entry) => ({
      asset: entry.asset,
      assetScale: entry.asset_scale,
      available: entry.available,
      hold: entry.hold
    }))
  };
}

// The subject detail's kyc block and the kyc queue item detail's kyc block
// share the exact upstream contract object, so they share one mapper.
function kycOf(kyc) {
  if (kyc === null) {
    return null;
  }
  return {
    status: kyc.status,
    level: kyc.level,
    sessionId: kyc.session_id,
    history: kyc.history.map((attempt) => ({
      sessionId: attempt.session_id,
      state: attempt.state,
      submittedAt: attempt.submitted_at,
      decidedAt: attempt.decided_at,
      rejectionReason: attempt.rejection_reason
    }))
  };
}

function queueItemOf(item, kind) {
  const core = {
    queueId: item.queue_id,
    subjectId: item.subject_id,
    state: item.state,
    priority: item.priority,
    assignee: item.assignee === null ? null : { subject: item.assignee.subject },
    ageMs: item.age_ms
  };
  if (kind === "aml") {
    return {
      ...core,
      alertType: item.alert_type,
      evidenceRefs: [...item.evidence_refs],
      slaDueAt: item.sla_due_at
    };
  }
  if (kind === "tickets") {
    return { ...core, category: item.category, openedAt: item.opened_at };
  }
  return {
    ...core,
    displayName: item.display_name,
    submittedAt: item.submitted_at,
    slaDueAt: item.sla_due_at
  };
}

function queueOf(view, kind) {
  const summary = view.queue.summary;
  return {
    kind,
    items: view.queue.items.map((item) => queueItemOf(item, kind)),
    summary: {
      count: summary.count,
      byState:
        kind === "tickets"
          ? { open: summary.by_state.open, waiting: summary.by_state.waiting, escalated: summary.by_state.escalated }
          : { pending: summary.by_state.pending, inReview: summary.by_state.in_review, escalated: summary.by_state.escalated }
    },
    posting: view.queue.posting
  };
}

function queueItemDetailOf(view) {
  const detail = view.item;
  const core = queueItemOf(detail, view.kind);
  if (view.kind === "aml") {
    return {
      ...core,
      flags: detail.flags.map((flag) => ({
        flagId: flag.flag_id,
        alertType: flag.alert_type,
        raisedAt: flag.raised_at
      }))
    };
  }
  if (view.kind === "tickets") {
    return {
      ...core,
      subject: detail.subject,
      lastMessageAt: detail.last_message_at,
      otherOpenTickets: detail.other_open_tickets
    };
  }
  return {
    ...core,
    kyc: kycOf(detail.kyc)
  };
}

function auditFeedOf(view) {
  return {
    asOf: view.audit.as_of,
    entries: view.audit.entries.map((entry) => ({
      auditId: entry.audit_id,
      actorSubjectId: entry.actor_subject_id,
      actorRole: entry.actor_role,
      action: entry.action,
      targetKind: entry.target_kind,
      targetId: entry.target_id,
      at: entry.at,
      detailHash: entry.detail_hash
    })),
    nextCursor: view.audit.next_cursor
  };
}

describe("operator chain through the live customer-api", () => {
  let lead;

  before(async () => {
    lead = await operatorSession("compliance-lead");
  });

  it("serves the operator admin overview bound to the session's mapped subject", async () => {
    // The BFF mints the upstream principal from the session subject: the
    // deterministic syn_oper_* mapping, whose role draw decides the granted
    // capability echo. Comparing all three pins the token family, the dev key
    // and the capability policy end to end.
    const expectedSubject = customerApiSubject("dev:compliance-lead");
    const expectedRole = operatorRoleFor(expectedSubject);
    const expected = await operatorDirectory.viewFor(
      expectedSubject,
      evaluateOperatorCapabilities({ role: expectedRole }).granted
    );
    const admin = await signedGet("/bff/api/operator/admin", lead, "operator-admin");
    assert.deepEqual(admin, {
      mode: "test",
      operatorId: expected.operator_id,
      subject: expectedSubject,
      role: expectedRole,
      grantedCapabilities: [...expected.granted_capabilities],
      createdAt: expected.created_at,
      updatedAt: expected.updated_at
    });
  });

  it("serves the subject roster, the member detail and roster coherence", async () => {
    const upstream = await subjectsDirectory.subjectsFor();
    const list = await signedGet("/bff/api/operator/subjects", lead, "operator-subjects");
    assert.deepEqual(list, {
      mode: "test",
      subjects: upstream.subjects.map((row) => subjectRowOf(row))
    });
    assert.equal(list.subjects.length, 24);
    for (const row of list.subjects) {
      assert.match(row.subjectId, /^syn_cust_[0-9a-f]{24}$/);
    }

    const picked = upstream.subjects[3];
    const detail = await signedGet(
      `/bff/api/operator/subjects/${picked.subject_id}`,
      lead,
      `operator-subject:${picked.subject_id}`
    );
    const expectedDetail = await subjectsDirectory.subjectFor(picked.subject_id);
    assert.deepEqual(detail, { mode: "test", subject: subjectDetailOf(expectedDetail.subject) });
    // Roster coherence: the member read must equal the list row verbatim on
    // every shared field — a detail minted from another row fails here.
    const shared = Object.fromEntries(
      Object.keys(list.subjects[3]).map((key) => [key, detail.subject[key]])
    );
    assert.deepEqual(shared, list.subjects[3]);
    assert.match(detail.subject.contactHash, /^cth_[0-9a-f]{32}$/);
    assert.ok(detail.subject.devices.every((device) => /^dev_[0-9a-f]{16}$/.test(device)));
  });

  it("serves every queue kind's collection and member detail behind signed envelopes", async () => {
    // One member read per kind: the detail adapter's kind-specific block
    // (aml flags, tickets subject/otherOpenTickets, kyc dossier) is only
    // exercised here — a wrong or dropped block fails the verbatim compare.
    const idPatterns = {
      kyc: /^qky_[0-9a-f]{24}$/,
      aml: /^qml_[0-9a-f]{24}$/,
      tickets: /^qtick_[0-9a-f]{24}$/
    };
    // `kind` absent defaults to kyc at both the route and the signed
    // resource — the default is part of the contract, not convenience.
    const defaulted = await signedGet("/bff/api/operator/queue", lead, "operator-queue:kyc");
    assert.equal(defaulted.queue.kind, "kyc");

    for (const kind of ["kyc", "aml", "tickets"]) {
      const upstream = await subjectsDirectory.queueFor(kind);
      const list = await signedGet(`/bff/api/operator/queue?kind=${kind}`, lead, `operator-queue:${kind}`);
      assert.deepEqual(list, { mode: "test", queue: queueOf(upstream, kind) });
      assert.equal(list.queue.summary.count, list.queue.items.length);

      const item = upstream.queue.items[0];
      assert.match(item.queue_id, idPatterns[kind]);
      const detail = await signedGet(
        `/bff/api/operator/queue/${kind}/${item.queue_id}`,
        lead,
        `operator-queue-item:${kind}:${item.queue_id}`
      );
      const expectedDetail = await subjectsDirectory.queueItemFor(kind, item.queue_id);
      assert.deepEqual(detail, {
        mode: "test",
        kind,
        item: queueItemDetailOf(expectedDetail)
      });
      // Member coherence like the subject read: every collection-axis field
      // must equal the collection row verbatim.
      const collectionRow = queueItemOf(item, kind);
      for (const key of Object.keys(collectionRow)) {
        assert.deepEqual(detail.item[key], collectionRow[key], `${kind} queue item ${key}`);
      }
    }
  });

  it("serves the audit feed across its page boundary", async () => {
    const first = await signedGet("/bff/api/operator/audit", lead, "operator-audit:first");
    const upstreamFirst = await subjectsDirectory.auditFor();
    assert.deepEqual(first, { mode: "test", audit: auditFeedOf(upstreamFirst) });
    assert.equal(first.audit.entries.length, 32);
    assert.match(first.audit.nextCursor ?? "", /^auc_[0-9a-f]{16}$/);

    // The signed resource binds the cursor: a replayed first-page envelope
    // can never stand in for page two.
    const second = await signedGet(
      `/bff/api/operator/audit?cursor=${first.audit.nextCursor}`,
      lead,
      `operator-audit:${first.audit.nextCursor}`
    );
    const upstreamSecond = await subjectsDirectory.auditFor(first.audit.nextCursor);
    assert.deepEqual(second, { mode: "test", audit: auditFeedOf(upstreamSecond) });
    const seen = new Set(first.audit.entries.map((entry) => entry.auditId));
    for (const entry of second.audit.entries) {
      assert.equal(seen.has(entry.auditId), false);
    }

    // Walk the cursor chain to exhaustion: the tail page is exactly the
    // remaining entries, disjoint from both earlier pages, and mints no
    // further cursor — a replayed, re-derived or short last page fails here.
    const third = await signedGet(
      `/bff/api/operator/audit?cursor=${second.audit.nextCursor}`,
      lead,
      `operator-audit:${second.audit.nextCursor}`
    );
    const upstreamThird = await subjectsDirectory.auditFor(second.audit.nextCursor);
    assert.deepEqual(third, { mode: "test", audit: auditFeedOf(upstreamThird) });
    assert.equal(third.audit.entries.length, 8);
    assert.equal(third.audit.nextCursor, null);
    for (const entry of second.audit.entries) {
      seen.add(entry.auditId);
    }
    for (const entry of third.audit.entries) {
      assert.equal(seen.has(entry.auditId), false);
    }
  });

  it("serves the signed session view bound to the dev-session profile", async () => {
    // `/bff/api/session` is the one signed read every session-scoped check
    // depends on: the operator profile it signs must equal the dev-session
    // contract verbatim, including the full capability echo.
    const session = await signedGet("/bff/api/session", lead, "session");
    assert.deepEqual(session, {
      operator: {
        subject: "dev:compliance-lead",
        email: "compliance-lead@dev.solidchange.invalid",
        name: "Мария Коваль",
        role: "compliance-lead",
        label: "Compliance lead",
        initials: "МК",
        capabilities: [
          "dashboard:read",
          "customers:read",
          "checks:read",
          "custody:read",
          "support:read",
          "kyc:read",
          "aml:read",
          "investigations:read",
          "fraud:read",
          "subjects:read",
          "approvals:read",
          "approvals:review",
          "approvals:preview",
          "approvals:step-up",
          "audit:read",
          "audit:export",
          "reports:read"
        ]
      },
      expiresAt: session.expiresAt
    });
    assert.match(session.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const expiresAt = Date.parse(session.expiresAt);
    assert.ok(expiresAt > Date.now());
  });
});

describe("operator chain fail-closed paths", () => {
  let lead;
  let support;
  let kycItemId;

  before(async () => {
    lead = await operatorSession("compliance-lead");
    support = await operatorSession("support-l1", supportDeviceCookie);
    const kycQueue = await subjectsDirectory.queueFor("kyc");
    kycItemId = kycQueue.queue.items[0].queue_id;
  });

  it("rejects tampered and wrong-kind queue input at both layers", async () => {
    // `kind` outside the enum is invalid input at the BFF edge (400) and a
    // uniform not-found on the member read — it is never propagated upstream.
    await deniedGet("/bff/api/operator/queue?kind=evil", lead, 400, "operator_queue_kind_invalid");
    await deniedGet(`/bff/api/operator/queue/evil/${kycItemId}`, lead, 404, "operator_queue_item_not_found");
    // A well-formed kyc id under the aml kind shares the same uniform 404 —
    // neither layer reveals which ids the other kinds hold.
    await deniedGet(`/bff/api/operator/queue/aml/${kycItemId}`, lead, 404, "operator_queue_item_not_found");
    await deniedGet("/bff/api/operator/subjects/syn_cust_not-hex!!", lead, 404, "operator_subject_not_found");
    await deniedGet(
      "/bff/api/operator/subjects/syn_cust_000000000000000000000000",
      lead,
      404,
      "operator_subject_not_found"
    );

    // Upstream the same input fails closed as contract pins: 400
    // VALIDATION_FAILED for the malformed kind, 404 CAPABILITY_DENIED for the
    // well-formed wrong-kind member.
    const token = mintOperator(customerApiSubject("dev:compliance-lead"));
    const badKind = await upstreamGet("/api/v1/operator/queue?kind=evil", token);
    assert.equal(badKind.status, 400);
    assert.equal((await readJson(badKind)).code, "VALIDATION_FAILED");
    const wrongKind = await upstreamGet(`/api/v1/operator/queue/aml/${kycItemId}`, token);
    assert.equal(wrongKind.status, 404);
    assert.equal((await readJson(wrongKind)).code, "CAPABILITY_DENIED");
    const unknownSubject = await upstreamGet(
      "/api/v1/operator/subjects/syn_cust_000000000000000000000000",
      token
    );
    assert.equal(unknownSubject.status, 404);
    assert.equal((await readJson(unknownSubject)).code, "CAPABILITY_DENIED");
  });

  it("rejects tampered audit input and unknown cursors at both layers", async () => {
    // `cursor` is the feed's only query parameter and must match the auc_*
    // grammar: anything else is invalid input the BFF fails closed locally.
    await deniedGet("/bff/api/operator/audit?bogus=1", lead, 400, "invalid_request");
    await deniedGet("/bff/api/operator/audit?cursor=evil", lead, 400, "operator_audit_cursor_invalid");
    await deniedGet(
      "/bff/api/operator/audit?cursor=AUC_0000000000000000",
      lead,
      400,
      "operator_audit_cursor_invalid"
    );
    // A grammar-valid but unminted cursor reaches upstream and comes back
    // the uniform not-found the BFF surfaces as 404.
    await deniedGet(
      "/bff/api/operator/audit?cursor=auc_0000000000000000",
      lead,
      404,
      "operator_audit_not_found"
    );

    const token = mintOperator(customerApiSubject("dev:compliance-lead"));
    const badParam = await upstreamGet("/api/v1/operator/audit?bogus=1", token);
    assert.equal(badParam.status, 400);
    assert.equal((await readJson(badParam)).code, "VALIDATION_FAILED");
    const badCursor = await upstreamGet("/api/v1/operator/audit?cursor=evil", token);
    assert.equal(badCursor.status, 400);
    assert.equal((await readJson(badCursor)).code, "VALIDATION_FAILED");
    const unknownCursor = await upstreamGet(
      "/api/v1/operator/audit?cursor=auc_0000000000000000",
      token
    );
    assert.equal(unknownCursor.status, 404);
    assert.equal((await readJson(unknownCursor)).code, "CAPABILITY_DENIED");
  });

  it("keeps the audit feed behind audit:read at both layers", async () => {
    // support-l1 holds no audit:read in the backoffice role matrix: the read
    // dies at the BFF capability gate before any upstream call — while the
    // same session still reads the shared-tier surfaces (the gate is the
    // capability, not the session).
    await deniedGet("/bff/api/operator/audit", support, 403, "capability_denied");
    const subjects = await signedGet("/bff/api/operator/subjects", support, "operator-subjects");
    assert.equal(subjects.subjects.length, 24);
    const queue = await signedGet("/bff/api/operator/queue?kind=aml", support, "operator-queue:aml");
    assert.equal(queue.queue.kind, "aml");

    // Upstream the role is a deterministic draw of the token subject, so a
    // staff ref that draws a non-oversight role gets the uniform 403 on the
    // role-scoped feed and still reads the unconditional tiers.
    const oversight = new Set(["auditor", "compliance-lead"]);
    let restricted = "";
    for (let index = 0; index < 64 && restricted === ""; index += 1) {
      const candidate = `syn_oper_restricted${index}`;
      if (!oversight.has(operatorRoleFor(candidate))) restricted = candidate;
    }
    assert.notEqual(restricted, "");
    const token = mintOperator(restricted);
    const audit = await upstreamGet("/api/v1/operator/audit", token);
    assert.equal(audit.status, 403);
    assert.equal((await readJson(audit)).code, "CAPABILITY_DENIED");
    const subjectsUpstream = await upstreamGet("/api/v1/operator/subjects", token);
    assert.equal(subjectsUpstream.status, 200);
  });

  it("rejects a customer-family token, an absent device and an unauthenticated caller", async () => {
    // Audience binding: a customer scdev1.* token never authenticates an
    // operator route — the signature domain alone makes forgery impossible,
    // but the check is what e2e can see.
    const customerToken = mintSyntheticCustomerToken({
      key: devTokenKey,
      subject: "syn_cust_e2e000000000000000001",
      expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
    });
    const direct = await upstreamGet("/api/v1/operator/subjects", customerToken);
    assert.equal(direct.status, 401);
    assert.equal(direct.headers.get("www-authenticate"), "Bearer");
    assert.equal((await readJson(direct)).code, "AUTHENTICATION_REQUIRED");

    // Signature and lifetime are the whole synthetic-token contract: an
    // expired token, a beyond-TTL token and a well-formed token signed under
    // a different key all fail as unauthenticated with the Bearer challenge.
    const subject = customerApiSubject("dev:compliance-lead");
    const now = Math.floor(Date.now() / 1_000);
    for (const token of [
      mintSyntheticOperatorToken({ key: devTokenKey, subject, expiresAtSeconds: now - 1 }),
      mintSyntheticOperatorToken({ key: devTokenKey, subject, expiresAtSeconds: now + 7_200 }),
      mintSyntheticOperatorToken({ key: randomBytes(32).toString("hex"), subject, expiresAtSeconds: now + 300 })
    ]) {
      const response = await upstreamGet("/api/v1/operator/subjects", token);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.equal((await readJson(response)).code, "AUTHENTICATION_REQUIRED");
    }

    // The declared request headers are part of the contract: absent or
    // malformed x-request-id / x-client-version / x-platform fail closed as
    // VALIDATION_FAILED before authn — they are not tolerated decoration.
    for (const [name, value] of [
      ["x-request-id", null],
      ["x-request-id", "not-a-uuidv7"],
      ["x-client-version", null],
      ["x-client-version", ""],
      ["x-platform", null],
      ["x-platform", "not-a-platform"]
    ]) {
      const headers = upstreamHeaders(mintOperator(subject));
      if (value === null) {
        delete headers[name];
      } else {
        headers[name] = value;
      }
      const response = await fetch(`${customerApiBase}/api/v1/operator/subjects`, { headers });
      assert.equal(response.status, 400, name);
      assert.equal((await readJson(response)).code, "VALIDATION_FAILED", name);
    }

    // An operator token without the bound workstation device fails closed:
    // X-Device-Id is mandatory on every operator operation.
    const operatorToken = mintOperator(customerApiSubject("dev:compliance-lead"));
    const noDevice = await upstreamGet("/api/v1/operator/subjects", operatorToken, { device: null });
    assert.equal(noDevice.status, 400);
    assert.equal((await readJson(noDevice)).code, "VALIDATION_FAILED");
    const badDevice = await upstreamGet("/api/v1/operator/subjects", operatorToken, {
      device: "not-a-uuid"
    });
    assert.equal(badDevice.status, 400);
    assert.equal((await readJson(badDevice)).code, "VALIDATION_FAILED");

    // At the BFF edge: no session, or a session without its bound device
    // cookie, or a device the allowlist never approved — all denied before
    // the capability check, as unauthenticated.
    await deniedGet("/bff/api/operator/subjects", "", 401, "operator_session_required");
    const sessionOnly = lead.split(";")[0];
    await deniedGet("/bff/api/operator/subjects", sessionOnly, 401, "operator_session_required");
    const foreignDevice = `solidchange_bo_device=${randomUUID()}`;
    await deniedGet(
      "/bff/api/operator/subjects",
      `${sessionOnly}; ${foreignDevice}`,
      401,
      "operator_session_required"
    );

    // A forged session bearer — exactly the store's sbt_<64hex> shape but
    // never minted — denies identically to an absent one: the store resolves
    // the token digest, not the bearer shape.
    const forged = `${sessionCookieName}=sbt_${"0".repeat(64)}`;
    await deniedGet("/bff/api/operator/subjects", `${forged}; ${foreignDevice}`, 401, "operator_session_required");

    // And an unapproved device cannot even mint a session: the login itself
    // is denied and only the opaque digest comes back.
    const login = await fetch(`${backofficeBase}/bff/auth/dev-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: backofficeOrigin, cookie: foreignDevice },
      body: JSON.stringify({ role: "compliance-lead" })
    });
    assert.equal(login.status, 403);
    const denied = await readJson(login);
    assert.equal(denied.error, "device_not_approved");
    assert.match(denied.deviceDigest, /^[0-9a-f]{64}$/);
  });
});

describe("operator chain degrade and recovery", () => {
  it("fails closed while customer-api is down and recovers on restart", async () => {
    const lead = await operatorSession("compliance-lead");
    const live = await signedGet("/bff/api/operator/subjects", lead, "operator-subjects");
    assert.equal(live.subjects.length, 24);

    await stopService(customerApi);
    customerApi = undefined;
    for (const [path, error] of [
      ["/bff/api/operator/admin", "operator_admin_unavailable"],
      ["/bff/api/operator/subjects", "operator_subjects_unavailable"],
      ["/bff/api/operator/queue?kind=kyc", "operator_queue_unavailable"],
      ["/bff/api/operator/audit", "operator_audit_unavailable"]
    ]) {
      await deniedGet(path, lead, 503, error);
    }

    // Recovery: the same session and device bind pick the restarted upstream
    // up without a fresh login — the chain serves live rows again.
    customerApiEnv.CUSTOMER_API_PORT = customerApiPort;
    customerApi = await startCustomerApi();
    const recovered = await signedGet("/bff/api/operator/subjects", lead, "operator-subjects");
    assert.deepEqual(recovered, live);
    const audit = await signedGet("/bff/api/operator/audit", lead, "operator-audit:first");
    assert.equal(audit.audit.entries.length, 32);
  });
});
