import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import {
  mintSyntheticCustomerToken,
  mintSyntheticOperatorToken
} from "@solidchange/customer-api/synthetic-token";
import { syntheticActivityItems } from "../../customer-api/src/activity.mjs";
import { evaluateOperatorCapabilities } from "../../customer-api/src/capabilities.mjs";
import {
  OPERATOR_AUDIT_PAGE_SIZE,
  OPERATOR_QUEUE_KINDS,
  OPERATOR_ROLES,
  createSyntheticOperatorDirectory,
  createSyntheticOperatorSubjectsDirectory,
  operatorRoleFor,
  validOperatorAdminView,
  validOperatorAuditView,
  validOperatorQueueItemDetail,
  validOperatorQueueView,
  validOperatorSubjectDetailView,
  validOperatorSubjectsView
} from "../../customer-api/src/operator.mjs";
import { syntheticSupportTickets } from "../../customer-api/src/support.mjs";
import { WALLET_ASSETS, buildWalletsView } from "../../customer-api/src/wallets.mjs";
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
// whole served operator journey end to end — BFF dev session → subjects →
// subject-360 (every block: recent_activity, kyc dossier, balances, sessions)
// → every queue kind's collection and member detail → the full audit feed —
// plus the fail-closed paths (out-of-enum kind, wrong-kind item, missing
// audit:read, a customer-family token on an operator route, malformed member
// ids, absent/foreign devices) and the degrade arm (upstream kill → the exact
// *_unavailable table → restart → live values resume). Every BFF payload is a
// signed envelope verified against the live keyset, deep compared to the
// upstream synthetic directories, and cross-checked against the customer-side
// universes the blocks project — so a wiring break, a derivation drift shared
// by both adapters, a capability drift, a signed-resource mismatch or a lost
// device binding fails here rather than escaping e2e coverage.

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

// The customer activity feed's pinned epoch: the operator recent_activity
// page re-anchors each feed item onto its account's own registration —
// occurred_at = registered + (created_at - epoch) — so every matched pair
// must carry exactly this offset.
const ACTIVITY_FEED_EPOCH_MS = Date.parse("2026-09-01T00:00:00.000Z");
const RECENT_ACTIVITY_BOUND = 8;
const KYC_HISTORY_BOUND = 4;
// The contract vocabularies the composed views draw from. These are pins,
// not re-exports: a served value outside the declared set must fail here
// even when both adapters agree on it.
const SUBJECT_ACCOUNT_STATUSES = new Set(["active", "dormant", "restricted", "closed"]);
const SUBJECT_KYC_LEVELS = new Set(["basic", "enhanced"]);
const SUBJECT_KYC_DOSSIER_STATES = new Set([
  "approved",
  "in_review",
  "needs_more_data",
  "rejected",
  "submitted",
  "timed_out"
]);
const SUBJECT_KYC_PENDING = new Set(["submitted", "in_review"]);
const SUBJECT_KYC_ENDINGS = new Set(["rejected", "needs_more_data", "timed_out"]);
const SUBJECT_KYC_REASON_CODES = new Set(["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"]);
const AML_ALERT_TYPES = new Set(["structuring", "velocity", "geo_mismatch"]);
const KYC_TRANSITION_SUMMARIES = new Set(["submitted", "approved"]);
const OPERATOR_ONLY_ACTIVITY_KINDS = new Set(["kyc_transition", "flag_added"]);
const AUDIT_ACTION_TARGET = {
  "session.opened": ["session", /^osn_[0-9a-f]{24}$/u],
  "session.rotated": ["session", /^osn_[0-9a-f]{24}$/u],
  "queue.viewed": ["queue_item", /^(qky|qml|qtick)_[0-9a-f]{24}$/u],
  "subject.viewed": ["subject", /^syn_cust_[a-z0-9]{8,32}$/u],
  "flag.reviewed": ["flag", /^flg_[0-9a-f]{24}$/u]
};
const QUEUE_ID_PATTERNS = {
  kyc: /^qky_[0-9a-f]{24}$/u,
  aml: /^qml_[0-9a-f]{24}$/u,
  tickets: /^qtick_[0-9a-f]{24}$/u
};

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

function upstreamHeaders(token, { device = deviceId, platform = "operator-web", extra = {} } = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
    "x-request-id": generateUuidV7(),
    "x-client-version": "e2e-dev-operator-chain",
    "x-platform": platform,
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

function mintCustomer(subject) {
  return mintSyntheticCustomerToken({
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

// The upstream member reads are the contract layer the BFF adapters
// project: a served view must answer 200, pass the upstream's own
// validator and equal the synthetic-directory oracle verbatim — anything
// else is adapter slack the signed envelope would carry downstream.
async function upstreamView(path, token, valid) {
  const response = await upstreamGet(path, token);
  assert.equal(response.status, 200, path);
  const body = await readJson(response);
  assert.equal(valid(body), true, path);
  return body;
}

// The customer-channel twin of upstreamGet: the miniapp-side headers the
// customer routes declare (telegram-mini-app platform, and no device —
// X-Device-Id is operator-only and rejected on customer operations).
async function customerGet(path, token) {
  return fetch(`${customerApiBase}${path}`, {
    headers: upstreamHeaders(token, { device: null, platform: "telegram-mini-app" })
  });
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
  // Cross-surface state collected as the arm walks the journey: the audit
  // feed must only cite targets the live surfaces actually served, so the
  // roster, the subject-360 details, the queue member ids and the served
  // flag ids accumulate here in declaration order.
  const subjectDetailById = new Map();
  const queueItemIdByKind = { kyc: new Set(), aml: new Set(), tickets: new Set() };
  const flagIdSet = new Set();
  let auditAsOf = "";

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

    // Upstream the same reads answer the verbatim contract view: collection
    // and member both pass the upstream validator and equal the directory —
    // the BFF envelope can only ever carry what this layer serves.
    const token = mintOperator(customerApiSubject("dev:compliance-lead"));
    const subjectsView = await upstreamView(
      "/api/v1/operator/subjects", token, validOperatorSubjectsView);
    assert.deepEqual(subjectsView, upstream);
    const memberView = await upstreamView(
      `/api/v1/operator/subjects/${picked.subject_id}`, token, validOperatorSubjectDetailView);
    assert.deepEqual(memberView, expectedDetail);
  });

  it("assembles the complete subject-360 across the roster with coherent blocks", async () => {
    // The as-of horizon every dossier and activity instant must stay inside
    // is the feed's own pinned snapshot — read it live off the audit page
    // rather than re-deriving the constant here.
    const feed = await signedGet("/bff/api/operator/audit", lead, "operator-audit:first");
    auditAsOf = feed.audit.asOf;
    const asOfMs = Date.parse(auditAsOf);
    assert.equal(new Date(asOfMs).toISOString(), auditAsOf);

    // The aml collection hands the flag-bearing subjects their member ids —
    // the roster's open flag count alone decides queue membership.
    const amlQueue = await subjectsDirectory.queueFor("aml");
    const amlIdBySubject = new Map(
      amlQueue.queue.items.map((item) => [item.subject_id, item.queue_id]));

    const upstream = await subjectsDirectory.subjectsFor();
    const token = mintOperator(customerApiSubject("dev:compliance-lead"));
    for (const row of upstream.subjects) {
      const subjectId = row.subject_id;
      const payload = await signedGet(
        `/bff/api/operator/subjects/${subjectId}`, lead, `operator-subject:${subjectId}`);
      const expected = await subjectsDirectory.subjectFor(subjectId);
      assert.deepEqual(payload, { mode: "test", subject: subjectDetailOf(expected.subject) });
      const subject = payload.subject;
      subjectDetailById.set(subjectId, subject);

      // Upstream validity on the member read — same check the collection
      // got above, exercised on every subject this arm touches.
      const memberView = await upstreamView(
        `/api/v1/operator/subjects/${subjectId}`, token, validOperatorSubjectDetailView);
      assert.deepEqual(memberView, expected);

      // Every block is served — the detail view never drops one — and the
      // member row still equals its roster row verbatim on shared fields.
      assert.ok(Array.isArray(subject.recentActivity), subjectId);
      assert.ok(Array.isArray(subject.balances), subjectId);
      assert.equal(typeof subject.sessions, "number", subjectId);
      assert.ok(subject.kyc === null || typeof subject.kyc === "object", subjectId);
      assert.ok(SUBJECT_ACCOUNT_STATUSES.has(subject.accountStatus), subjectId);
      assert.match(subject.contactHash, /^cth_[0-9a-f]{32}$/, subjectId);
      const shared = Object.fromEntries(
        Object.keys(subjectRowOf(row)).map((key) => [key, subject[key]]));
      assert.deepEqual(shared, subjectRowOf(row));

      // Sessions are active-clamped: bounded by the declared limit, and a
      // device-less or closed account holds none.
      assert.ok(subject.sessions >= 0 && subject.sessions <= subject.limits.maxSessions, subjectId);
      assert.ok(subject.devices.length <= subject.limits.maxDevices, subjectId);
      if (subject.accountStatus === "closed" || subject.devices.length === 0) {
        assert.equal(subject.sessions, 0, subjectId);
      }

      // The balances block is the customer's own wallet universe minus the
      // wallet handle plus the asset scale — the identity-by-construction
      // pin exercised live on the wire payload. A closed account reports
      // the zeroed surface instead.
      const wallets = buildWalletsView(subjectId).wallets;
      assert.equal(subject.balances.length, WALLET_ASSETS.length, subjectId);
      for (const [index, entry] of subject.balances.entries()) {
        const spec = WALLET_ASSETS[index];
        assert.equal(entry.asset, spec.code, subjectId);
        assert.equal(entry.assetScale, spec.scale, subjectId);
        const wallet = wallets.find((entry2) => entry2.asset === spec.code);
        assert.notEqual(wallet, undefined, subjectId);
        if (subject.accountStatus === "closed") {
          assert.equal(entry.available, `0.${"0".repeat(spec.scale)}`, subjectId);
          assert.equal(entry.hold, `0.${"0".repeat(spec.scale)}`, subjectId);
        } else {
          assert.equal(entry.available, wallet.available, `${subjectId} ${spec.code}`);
          assert.equal(entry.hold, wallet.hold, `${subjectId} ${spec.code}`);
        }
      }

      // recent_activity: a bounded page, newest first, every instant inside
      // the account window [registered, as_of]. Customer-family rows must
      // equal the subject's own feed row verbatim — kind and money
      // identical, the status promoted to the summary, the instant
      // re-anchored onto this account's registration epoch — and stay
      // inside last_active; operator-side events (kyc transitions, flag
      // additions) may postdate it.
      assert.ok(subject.recentActivity.length >= 1, subjectId);
      assert.ok(subject.recentActivity.length <= RECENT_ACTIVITY_BOUND, subjectId);
      const feedItems = syntheticActivityItems(subjectId);
      const feedById = new Map(feedItems.map((item) => [item.activity_id, item]));
      const registeredMs = Date.parse(subject.registeredAt);
      const lastActiveMs = Date.parse(subject.lastActiveAt);
      const activityIds = new Set();
      let previousMs = Number.POSITIVE_INFINITY;
      let previousId = "";
      const flagItems = [];
      let sawTransition = false;
      for (const item of subject.recentActivity) {
        assert.match(item.activityId, /^(act|opact)_[0-9a-f]{24}$/, subjectId);
        assert.equal(activityIds.has(item.activityId), false, subjectId);
        activityIds.add(item.activityId);
        const occurredMs = Date.parse(item.occurredAt);
        assert.ok(occurredMs >= registeredMs && occurredMs <= asOfMs, `${subjectId} ${item.activityId}`);
        assert.ok(
          occurredMs < previousMs || (occurredMs === previousMs && item.activityId > previousId),
          `${subjectId} ${item.activityId} ordering`
        );
        previousMs = occurredMs;
        previousId = item.activityId;
        if (item.activityId.startsWith("opact_")) {
          assert.ok(OPERATOR_ONLY_ACTIVITY_KINDS.has(item.kind), `${subjectId} ${item.kind}`);
          assert.equal(item.money, null, subjectId);
          if (item.kind === "kyc_transition") {
            sawTransition = true;
            assert.ok(KYC_TRANSITION_SUMMARIES.has(item.summary), `${subjectId} ${item.summary}`);
            // The transition instants are the dossier's own attempts.
            assert.notEqual(subject.kyc, null, subjectId);
            const expectedInstant = item.summary === "submitted"
              ? subject.kyc.history[0].submittedAt
              : subject.kyc.history[0].decidedAt;
            assert.equal(item.occurredAt, expectedInstant, `${subjectId} ${item.summary}`);
          } else {
            assert.ok(AML_ALERT_TYPES.has(item.summary), `${subjectId} ${item.summary}`);
            flagItems.push(item);
          }
        } else {
          const source = feedById.get(item.activityId);
          assert.notEqual(source, undefined, `${subjectId} ${item.activityId}`);
          assert.equal(item.kind, source.kind, `${subjectId} ${item.activityId}`);
          assert.equal(item.summary, source.status, `${subjectId} ${item.activityId}`);
          assert.deepEqual(item.money, source.money, `${subjectId} ${item.activityId}`);
          assert.equal(
            occurredMs - Date.parse(source.created_at),
            registeredMs - ACTIVITY_FEED_EPOCH_MS,
            `${subjectId} ${item.activityId} re-anchor`
          );
          assert.ok(occurredMs <= lastActiveMs, `${subjectId} ${item.activityId} last_active`);
        }
      }
      // Transitions are minted only for accounts that ever applied — a
      // never-applied account can still hold a dossier of endings but no
      // transitions. Presence in the page isn't pinned the other way: the
      // ≤8 bound can legitimately crowd an old transition out.
      if (subject.kycStatus === "unverified") {
        assert.equal(sawTransition, false, `${subjectId} transition on a never-applied account`);
      }

      // The flag_added rows resolve against the subject's aml member
      // detail: each shares the flag's mint digest (opact_X ↔ flg_X), and
      // the summary carries the alert type verbatim. Queue membership
      // itself follows the roster flag count.
      const amlId = amlIdBySubject.get(subjectId);
      if (subject.flags >= 1) {
        assert.notEqual(amlId, undefined, `${subjectId} aml membership`);
        const amlDetail = await signedGet(
          `/bff/api/operator/queue/aml/${amlId}`, lead, `operator-queue-item:aml:${amlId}`);
        assert.equal(amlDetail.item.subjectId, subjectId, subjectId);
        assert.equal(amlDetail.item.flags.length, subject.flags, subjectId);
        const flagByActivityId = new Map(
          amlDetail.item.flags.map((flag) => [`opact_${flag.flagId.slice(4)}`, flag]));
        for (const flag of amlDetail.item.flags) {
          flagIdSet.add(flag.flagId);
        }
        for (const item of flagItems) {
          const flag = flagByActivityId.get(item.activityId);
          assert.notEqual(flag, undefined, `${subjectId} ${item.activityId}`);
          assert.equal(flag.alertType, item.summary, `${subjectId} ${item.activityId}`);
          assert.equal(flag.raisedAt, item.occurredAt, `${subjectId} ${item.activityId}`);
        }
      } else {
        assert.equal(amlId, undefined, `${subjectId} no aml membership`);
        assert.equal(flagItems.length, 0, subjectId);
      }

      // KYC dossier: the roster's kyc_status bounds the application state;
      // every instant stays inside [registered, as_of]; the header echoes
      // the newest attempt; a reason rides only a rejected attempt.
      if (subject.kyc === null) {
        assert.equal(subject.kycStatus, "unverified", subjectId);
      } else {
        const dossier = subject.kyc;
        assert.ok(SUBJECT_KYC_DOSSIER_STATES.has(dossier.status), `${subjectId} ${dossier.status}`);
        assert.ok(SUBJECT_KYC_LEVELS.has(dossier.level), subjectId);
        assert.ok(dossier.history.length >= 1 && dossier.history.length <= KYC_HISTORY_BOUND, subjectId);
        assert.equal(dossier.sessionId, dossier.history[0].sessionId, subjectId);
        assert.equal(dossier.status, dossier.history[0].state, subjectId);
        const sessionIds = new Set();
        for (const [index, attempt] of dossier.history.entries()) {
          assert.match(attempt.sessionId, /^kys_[0-9a-f]{24}$/, subjectId);
          assert.equal(sessionIds.has(attempt.sessionId), false, subjectId);
          sessionIds.add(attempt.sessionId);
          const submittedMs = Date.parse(attempt.submittedAt);
          assert.ok(submittedMs >= registeredMs && submittedMs <= asOfMs, `${subjectId} ${attempt.sessionId}`);
          if (attempt.decidedAt === null) {
            assert.ok(SUBJECT_KYC_PENDING.has(attempt.state), `${subjectId} ${attempt.state}`);
          } else {
            const decidedMs = Date.parse(attempt.decidedAt);
            assert.ok(decidedMs >= submittedMs && decidedMs <= asOfMs, `${subjectId} ${attempt.sessionId}`);
            assert.equal(SUBJECT_KYC_PENDING.has(attempt.state), false, `${subjectId} ${attempt.state}`);
          }
          if (attempt.state === "rejected") {
            assert.ok(SUBJECT_KYC_REASON_CODES.has(attempt.rejectionReason), `${subjectId} ${attempt.rejectionReason}`);
          } else {
            assert.equal(attempt.rejectionReason, null, subjectId);
          }
          if (index > 0) {
            // Earlier attempts always ended — a pending attempt can only
            // ever be the newest — and history stays newest-first.
            assert.ok(SUBJECT_KYC_ENDINGS.has(attempt.state), `${subjectId} ${attempt.state}`);
            assert.ok(submittedMs <= Date.parse(dossier.history[index - 1].submittedAt), subjectId);
          }
        }
        if (subject.kycStatus === "verified") {
          assert.equal(dossier.status, "approved", subjectId);
        } else if (subject.kycStatus === "pending") {
          assert.ok(SUBJECT_KYC_PENDING.has(dossier.status), `${subjectId} ${dossier.status}`);
        } else {
          assert.ok(SUBJECT_KYC_ENDINGS.has(dossier.status), `${subjectId} ${dossier.status}`);
        }
      }
    }
  });

  it("binds the subject-360 projections to the customer-side universes", async () => {
    // A roster subject through the customer channel: the customer token
    // authenticates the always-granted reads, while the wallet and activity
    // universes the subject-360 projects stay behind the customer KYC gate —
    // the synthetic accounts are all unverified, so the operator read is the
    // only live surface for them and the gate itself is pinned here.
    const subject = [...subjectDetailById.values()].find(
      (entry) => entry.accountStatus !== "closed" && entry.kyc !== null
    );
    assert.notEqual(subject, undefined);
    const token = mintCustomer(subject.subjectId);
    const session = await customerGet("/api/v1/customer/session", token);
    assert.equal(session.status, 200);
    const sessionView = await readJson(session);
    assert.equal(sessionView.subject, subject.subjectId);
    assert.equal(sessionView.actor_type, "customer");
    for (const gated of ["/api/v1/customer/wallets", "/api/v1/customer/activity"]) {
      const denied = await customerGet(gated, token);
      assert.equal(denied.status, 403, gated);
      assert.equal((await readJson(denied)).code, "CAPABILITY_DENIED", gated);
    }

    // The identity pin exercised live: the served balances block equals the
    // wallet universe the gated customer read would have served, field for
    // field minus the wallet handle — not an operator-side re-derivation.
    const wallets = buildWalletsView(subject.subjectId).wallets;
    for (const [index, entry] of subject.balances.entries()) {
      const spec = WALLET_ASSETS[index];
      const wallet = wallets.find((candidate) => candidate.asset === spec.code);
      assert.equal(entry.asset, spec.code);
      assert.equal(entry.assetScale, spec.scale);
      assert.equal(entry.available, wallet.available);
      assert.equal(entry.hold, wallet.hold);
    }
    // And every customer row inside recent_activity is the feed's own item
    // re-anchored — the whole operator activity page is a projection of
    // served customer data plus the operator-side events.
    const feedItems = syntheticActivityItems(subject.subjectId);
    const feedById = new Map(feedItems.map((item) => [item.activity_id, item]));
    for (const item of subject.recentActivity) {
      if (!item.activityId.startsWith("act_")) continue;
      const source = feedById.get(item.activityId);
      assert.notEqual(source, undefined, item.activityId);
      assert.equal(item.kind, source.kind);
      assert.equal(item.summary, source.status);
      assert.deepEqual(item.money, source.money);
    }
  });

  it("serves every queue kind's collection and member detail behind signed envelopes", async () => {
    // The member sweep walks every queued item of every kind: the detail
    // must be bound to the requested id, carry at least the collection row
    // verbatim, and the kind block must cohere with the surfaces it draws
    // from — the subject-360 dossier for kyc, the aml flag universe for
    // aml, the subject's own support tickets for tickets.
    // `kind` absent defaults to kyc at both the route and the signed
    // resource — the default is part of the contract, not convenience.
    const defaulted = await signedGet("/bff/api/operator/queue", lead, "operator-queue:kyc");
    assert.equal(defaulted.queue.kind, "kyc");

    const token = mintOperator(customerApiSubject("dev:compliance-lead"));
    const asOfMs = Date.parse(auditAsOf);
    for (const kind of OPERATOR_QUEUE_KINDS) {
      const upstream = await subjectsDirectory.queueFor(kind);
      const list = await signedGet(`/bff/api/operator/queue?kind=${kind}`, lead, `operator-queue:${kind}`);
      assert.deepEqual(list, { mode: "test", queue: queueOf(upstream, kind) });
      assert.equal(list.queue.summary.count, list.queue.items.length);
      // The collection summary totals its own page, and the page is the
      // declared sort: the kind's ordering key, queue id as the tie-break.
      const byStateTotal = Object.values(list.queue.summary.byState)
        .reduce((sum, count) => sum + count, 0);
      assert.equal(byStateTotal, list.queue.summary.count, kind);
      const sortKey = kind === "tickets" ? "openedAt" : "slaDueAt";
      for (let index = 1; index < list.queue.items.length; index += 1) {
        const previous = list.queue.items[index - 1];
        const current = list.queue.items[index];
        assert.ok(
          previous[sortKey] < current[sortKey]
            || (previous[sortKey] === current[sortKey] && previous.queueId < current.queueId),
          `${kind} ordering ${index}`
        );
      }
      const collectionView = await upstreamView(
        `/api/v1/operator/queue?kind=${kind}`, token, validOperatorQueueView);
      assert.deepEqual(collectionView, upstream);

      for (const item of upstream.queue.items) {
        assert.match(item.queue_id, QUEUE_ID_PATTERNS[kind]);
        queueItemIdByKind[kind].add(item.queue_id);
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
        // Member binding: the detail is the requested row plus its kind
        // block — never a neighbour's item under this id.
        assert.equal(detail.item.queueId, item.queue_id);
        const collectionRow = queueItemOf(item, kind);
        for (const key of Object.keys(collectionRow)) {
          assert.deepEqual(detail.item[key], collectionRow[key], `${kind} ${item.queue_id} ${key}`);
        }
        const memberView = await upstreamView(
          `/api/v1/operator/queue/${kind}/${item.queue_id}`, token, validOperatorQueueItemDetail);
        assert.deepEqual(memberView, expectedDetail);

        // The age is the as-of distance of the item's own anchor instant —
        // submitted for kyc, opened for tickets — while aml hides its
        // anchor (the alert raise) behind age and sla: sla = raised +
        // [1d, 4d), so sla_due is always strictly after the raise.
        const anchor = kind === "kyc" ? item.submitted_at : item.opened_at;
        if (kind !== "aml") {
          assert.equal(item.age_ms, asOfMs - Date.parse(anchor), `${kind} ${item.queue_id} age`);
        } else {
          assert.ok(Date.parse(item.sla_due_at) > asOfMs - item.age_ms, `${kind} ${item.queue_id} sla`);
        }

        const subject = subjectDetailById.get(item.subject_id);
        assert.notEqual(subject, undefined, `${kind} ${item.queue_id} subject`);
        if (kind === "kyc") {
          // The member's dossier is the subject-360's own dossier verbatim —
          // one derivation serves both reads.
          assert.deepEqual(detail.item.kyc, subject.kyc, `${item.queue_id} dossier`);
        } else if (kind === "aml") {
          assert.equal(detail.item.flags.length, subject.flags, `${item.queue_id} flags`);
          let previousRaisedAt = "";
          let previousFlagId = "";
          for (const flag of detail.item.flags) {
            assert.match(flag.flagId, /^flg_[0-9a-f]{24}$/, item.queue_id);
            assert.ok(AML_ALERT_TYPES.has(flag.alertType), `${item.queue_id} ${flag.alertType}`);
            assert.ok(Date.parse(flag.raisedAt) <= asOfMs, `${item.queue_id} ${flag.flagId}`);
            assert.ok(
              flag.raisedAt > previousRaisedAt
                || (flag.raisedAt === previousRaisedAt && flag.flagId > previousFlagId),
              `${item.queue_id} flag ordering`
            );
            previousRaisedAt = flag.raisedAt;
            previousFlagId = flag.flagId;
            flagIdSet.add(flag.flagId);
          }
        } else {
          // The ticket member projects the subject's own support universe:
          // the newest ticket's topic and last note, and the count of the
          // remaining still-open tickets.
          const tickets = syntheticSupportTickets(item.subject_id);
          const newest = tickets[0];
          assert.equal(detail.item.subject, newest.topic, `${item.queue_id} subject`);
          assert.equal(
            detail.item.lastMessageAt,
            newest.timeline[newest.timeline.length - 1].at,
            `${item.queue_id} lastMessageAt`
          );
          assert.equal(
            detail.item.otherOpenTickets,
            tickets.slice(1).filter((ticket) => ticket.status !== "closed").length,
            `${item.queue_id} otherOpenTickets`
          );
        }
      }
    }
  });

  it("serves the audit feed across its page boundary with pinned entry grammar", async () => {
    // The whole feed walks the cursor chain to exhaustion: every page a
    // signed envelope verified live, every entry checked against the
    // contract grammar — au_* id bound to the same digest recipe as the
    // queue ids, an operator actor drawing from the role dictionary, the
    // action's declared target-kind and id shape, an instant inside the
    // as-of horizon — and every cited target must resolve to a surface the
    // arm already served.
    const token = mintOperator(customerApiSubject("dev:compliance-lead"));
    const subjectIds = new Set(subjectDetailById.keys());
    const queueItemIds = new Set([
      ...queueItemIdByKind.kyc,
      ...queueItemIdByKind.aml,
      ...queueItemIdByKind.tickets
    ]);
    const seen = new Set();
    let cursor;
    let pages = 0;
    let previousAt = Number.POSITIVE_INFINITY;
    let previousId = "";
    while (true) {
      const path = cursor === undefined
        ? "/bff/api/operator/audit"
        : `/bff/api/operator/audit?cursor=${cursor}`;
      const resource = cursor === undefined
        ? "operator-audit:first"
        : `operator-audit:${cursor}`;
      const page = await signedGet(path, lead, resource);
      const upstreamPage = await subjectsDirectory.auditFor(cursor);
      assert.deepEqual(page, { mode: "test", audit: auditFeedOf(upstreamPage) });
      const pageView = await upstreamView(
        path.replace("/bff/api/operator/audit", "/api/v1/operator/audit"),
        token,
        validOperatorAuditView
      );
      assert.deepEqual(pageView, upstreamPage);
      if (cursor === undefined) {
        assert.equal(page.audit.asOf, auditAsOf, "feed horizon drifts across reads");
      }
      const asOfMs = Date.parse(page.audit.asOf);
      pages += 1;
      assert.ok(page.audit.entries.length >= 1, `page ${pages} empty`);
      assert.ok(page.audit.entries.length <= OPERATOR_AUDIT_PAGE_SIZE, `page ${pages} oversized`);
      for (const entry of page.audit.entries) {
        assert.match(entry.auditId, /^au_[0-9a-f]{24}$/, `page ${pages}`);
        assert.equal(seen.has(entry.auditId), false, entry.auditId);
        seen.add(entry.auditId);
        assert.match(entry.actorSubjectId, /^syn_oper_[a-z0-9]{8,32}$/, entry.auditId);
        assert.ok(OPERATOR_ROLES.includes(entry.actorRole), `${entry.auditId} ${entry.actorRole}`);
        const target = AUDIT_ACTION_TARGET[entry.action];
        assert.notEqual(target, undefined, `${entry.auditId} ${entry.action}`);
        assert.equal(entry.targetKind, target[0], `${entry.auditId} ${entry.action}`);
        assert.match(entry.targetId, target[1], `${entry.auditId} ${entry.action}`);
        assert.match(entry.detailHash, /^adh_[0-9a-f]{32}$/, entry.auditId);
        const atMs = Date.parse(entry.at);
        assert.ok(atMs <= asOfMs, `${entry.auditId} horizon`);
        // The feed is newest-first, audit id descending on the tie — the
        // chain's own ordering, not whatever the page happened to serve.
        assert.ok(
          atMs < previousAt || (atMs === previousAt && entry.auditId < previousId),
          `${entry.auditId} ordering`
        );
        previousAt = atMs;
        previousId = entry.auditId;
        // Every cited target resolves to a surface the arm already served:
        // subjects to the roster, queue items to the matching collection,
        // flags to a served flag list.
        if (entry.targetKind === "subject") {
          assert.ok(subjectIds.has(entry.targetId), `${entry.auditId} ${entry.targetId}`);
        } else if (entry.targetKind === "queue_item") {
          assert.ok(queueItemIds.has(entry.targetId), `${entry.auditId} ${entry.targetId}`);
        } else if (entry.targetKind === "flag") {
          assert.ok(flagIdSet.has(entry.targetId), `${entry.auditId} ${entry.targetId}`);
        }
      }
      cursor = page.audit.nextCursor;
      if (cursor === null) {
        break;
      }
      assert.match(cursor, /^auc_[0-9a-f]{16}$/, `page ${pages} cursor`);
      assert.ok(pages < 8, "the feed must terminate");
    }
    // The declared universe: three full pages plus the tail, one audit
    // event per subject per action class — deterministic, not sampled.
    assert.equal(pages, 3);
    assert.equal(seen.size, 72);
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
    // The shared tier reaches down to the member reads and the admin
    // surface: the same capability-less session serves them all, and a
    // minted next-page cursor denies exactly like the first page — the
    // gate runs before the cursor check, never after.
    const memberSubject = subjects.subjects[0].subjectId;
    const subjectDetail = await signedGet(
      `/bff/api/operator/subjects/${memberSubject}`,
      support,
      `operator-subject:${memberSubject}`
    );
    assert.equal(subjectDetail.subject.subjectId, memberSubject);
    const amlItem = queue.queue.items[0];
    const itemDetail = await signedGet(
      `/bff/api/operator/queue/aml/${amlItem.queueId}`,
      support,
      `operator-queue-item:aml:${amlItem.queueId}`
    );
    assert.equal(itemDetail.item.queueId, amlItem.queueId);
    const admin = await signedGet("/bff/api/operator/admin", support, "operator-admin");
    // The upstream role is a draw of the mapped subject — the BFF login
    // role only binds the capability gate, never the served role.
    assert.equal(admin.role, operatorRoleFor(customerApiSubject("dev:support-l1")));
    const mintedCursor = (await subjectsDirectory.auditFor()).audit.next_cursor;
    await deniedGet(
      `/bff/api/operator/audit?cursor=${mintedCursor}`, support, 403, "capability_denied");

    // Upstream the role is a deterministic draw of the token subject, so a
    // staff ref that draws a non-oversight role gets the uniform 403 on the
    // role-scoped feed — first page and cursored alike — and still reads
    // the unconditional tiers, member reads included.
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
    const auditCursored = await upstreamGet(`/api/v1/operator/audit?cursor=${mintedCursor}`, token);
    assert.equal(auditCursored.status, 403);
    assert.equal((await readJson(auditCursored)).code, "CAPABILITY_DENIED");
    const subjectsUpstream = await upstreamGet("/api/v1/operator/subjects", token);
    assert.equal(subjectsUpstream.status, 200);
    const memberUpstream = await upstreamGet(`/api/v1/operator/subjects/${memberSubject}`, token);
    assert.equal(memberUpstream.status, 200);
    const itemUpstream = await upstreamGet(`/api/v1/operator/queue/aml/${amlItem.queueId}`, token);
    assert.equal(itemUpstream.status, 200);
    const adminUpstream = await upstreamGet("/api/v1/operator/admin", token);
    assert.equal(adminUpstream.status, 200);
  });

  it("rejects malformed member ids and foreign token audiences at both layers", async () => {
    // Member-id shapes that can never resolve: an operator-family id on
    // the subject route, a well-formed id of the wrong queue kind family,
    // and an id-shaped-but-absent value — each answers the uniform 404 at
    // the BFF edge and the upstream not-found, never a leak of which ids
    // exist.
    const amlItemId = (await subjectsDirectory.queueFor("aml")).queue.items[0].queue_id;
    const absentKyc = `qky_${"0".repeat(24)}`;
    const foreignSubject = `syn_oper_${"1".repeat(16)}`;
    for (const [path, error] of [
      [`/bff/api/operator/subjects/${foreignSubject}`, "operator_subject_not_found"],
      [`/bff/api/operator/subjects/syn_cust_${"z".repeat(24)}`, "operator_subject_not_found"],
      [`/bff/api/operator/queue/kyc/${amlItemId}`, "operator_queue_item_not_found"],
      [`/bff/api/operator/queue/tickets/${kycItemId}`, "operator_queue_item_not_found"],
      [`/bff/api/operator/queue/kyc/${absentKyc}`, "operator_queue_item_not_found"],
      [`/bff/api/operator/queue/kyc/not-an-id`, "operator_queue_item_not_found"]
    ]) {
      await deniedGet(path, lead, 404, error);
    }
    const token = mintOperator(customerApiSubject("dev:compliance-lead"));
    for (const path of [
      `/api/v1/operator/subjects/${foreignSubject}`,
      `/api/v1/operator/subjects/syn_cust_${"z".repeat(24)}`,
      `/api/v1/operator/queue/kyc/${amlItemId}`,
      `/api/v1/operator/queue/tickets/${kycItemId}`,
      `/api/v1/operator/queue/kyc/${absentKyc}`,
      `/api/v1/operator/queue/kyc/not-an-id`
    ]) {
      const response = await upstreamGet(path, token);
      assert.equal(response.status, 404, path);
      assert.equal((await readJson(response)).code, "CAPABILITY_DENIED", path);
    }

    // Multi-value query input fails closed as invalid input at both
    // layers — the allowlist is single-valued, never first-wins.
    await deniedGet(
      "/bff/api/operator/queue?kind=kyc&kind=aml", lead, 400, "operator_queue_query_invalid");
    const dupKind = await upstreamGet("/api/v1/operator/queue?kind=kyc&kind=aml", token);
    assert.equal(dupKind.status, 400);
    assert.equal((await readJson(dupKind)).code, "VALIDATION_FAILED");
    await deniedGet(
      "/bff/api/operator/audit?cursor=auc_0000000000000000&cursor=auc_0000000000000001",
      lead,
      400,
      "operator_audit_query_invalid"
    );
    const dupCursor = await upstreamGet(
      "/api/v1/operator/audit?cursor=auc_0000000000000000&cursor=auc_0000000000000001", token);
    assert.equal(dupCursor.status, 400);
    assert.equal((await readJson(dupCursor)).code, "VALIDATION_FAILED");

    // Audience binding both ways: the customer-family token never
    // authenticates an operator member read, and the operator token never
    // authenticates the customer channel — the signature domain alone
    // makes forgery impossible, but the check is what e2e can see.
    const customerToken = mintCustomer("syn_cust_e2e000000000000000001");
    for (const path of [
      `/api/v1/operator/subjects/${(await subjectsDirectory.subjectsFor()).subjects[0].subject_id}`,
      `/api/v1/operator/queue/kyc/${kycItemId}`,
      "/api/v1/operator/audit",
      "/api/v1/operator/admin"
    ]) {
      const response = await upstreamGet(path, customerToken);
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get("www-authenticate"), "Bearer", path);
      assert.equal((await readJson(response)).code, "AUTHENTICATION_REQUIRED", path);
    }
    const operatorOnCustomer = await customerGet("/api/v1/customer/session", token);
    assert.equal(operatorOnCustomer.status, 401);
    assert.equal((await readJson(operatorOnCustomer)).code, "AUTHENTICATION_REQUIRED");

    // The absent-device fail-closed reaches the member reads too: the
    // device requirement is per-operation, not per-collection.
    for (const path of [
      `/api/v1/operator/subjects/${(await subjectsDirectory.subjectsFor()).subjects[0].subject_id}`,
      `/api/v1/operator/queue/kyc/${kycItemId}`,
      "/api/v1/operator/audit"
    ]) {
      const response = await upstreamGet(path, token, { device: null });
      assert.equal(response.status, 400, path);
      assert.equal((await readJson(response)).code, "VALIDATION_FAILED", path);
    }
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

    // Baseline every surface this arm serves — collection and member
    // reads alike — so recovery is proven against live values, never a
    // remembered degrade.
    const picked = (await subjectsDirectory.subjectsFor()).subjects[0];
    const itemIds = {};
    for (const kind of OPERATOR_QUEUE_KINDS) {
      itemIds[kind] = (await subjectsDirectory.queueFor(kind)).queue.items[0].queue_id;
    }
    const reads = [
      ["/bff/api/operator/admin", "operator-admin"],
      ["/bff/api/operator/subjects", "operator-subjects"],
      [`/bff/api/operator/subjects/${picked.subject_id}`, `operator-subject:${picked.subject_id}`],
      ...OPERATOR_QUEUE_KINDS.map((kind) => [
        `/bff/api/operator/queue?kind=${kind}`,
        `operator-queue:${kind}`
      ]),
      ...OPERATOR_QUEUE_KINDS.map((kind) => [
        `/bff/api/operator/queue/${kind}/${itemIds[kind]}`,
        `operator-queue-item:${kind}:${itemIds[kind]}`
      ]),
      ["/bff/api/operator/audit", "operator-audit:first"]
    ];
    const baselines = [];
    for (const [path, resource] of reads) {
      baselines.push({ path, resource, payload: await signedGet(path, lead, resource) });
    }
    const auditCursor = baselines.at(-1).payload.audit.nextCursor;
    baselines.push({
      path: `/bff/api/operator/audit?cursor=${auditCursor}`,
      resource: `operator-audit:${auditCursor}`,
      payload: await signedGet(
        `/bff/api/operator/audit?cursor=${auditCursor}`, lead, `operator-audit:${auditCursor}`)
    });

    await stopService(customerApi);
    customerApi = undefined;

    // The local session surface stays live — it never touches the
    // upstream — while every upstream-backed route of this arm answers
    // its exact *_unavailable contract, member reads included.
    const session = await signedGet("/bff/api/session", lead, "session");
    assert.equal(session.operator.role, "compliance-lead");
    for (const [path, error] of [
      ["/bff/api/operator/admin", "operator_admin_unavailable"],
      ["/bff/api/operator/subjects", "operator_subjects_unavailable"],
      [`/bff/api/operator/subjects/${picked.subject_id}`, "operator_subject_unavailable"],
      ["/bff/api/operator/queue?kind=kyc", "operator_queue_unavailable"],
      ["/bff/api/operator/queue?kind=aml", "operator_queue_unavailable"],
      ["/bff/api/operator/queue?kind=tickets", "operator_queue_unavailable"],
      [`/bff/api/operator/queue/kyc/${itemIds.kyc}`, "operator_queue_item_unavailable"],
      [`/bff/api/operator/queue/aml/${itemIds.aml}`, "operator_queue_item_unavailable"],
      [`/bff/api/operator/queue/tickets/${itemIds.tickets}`, "operator_queue_item_unavailable"],
      ["/bff/api/operator/audit", "operator_audit_unavailable"],
      [`/bff/api/operator/audit?cursor=${auditCursor}`, "operator_audit_unavailable"]
    ]) {
      await deniedGet(path, lead, 503, error);
    }

    // Recovery: the same session and device bind pick the restarted
    // upstream up without a fresh login — and every surface serves its
    // baseline payload verbatim again. Deep equality to the pre-outage
    // reads is the live-serving proof: a cached degrade would return the
    // stub values the outage produced, not these.
    customerApiEnv.CUSTOMER_API_PORT = customerApiPort;
    customerApi = await startCustomerApi();
    for (const { path, resource, payload } of baselines) {
      assert.deepEqual(await signedGet(path, lead, resource), payload, path);
    }
  });
});
