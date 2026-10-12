import { createHash } from "node:crypto";
import { ACTIVITY_ASSETS, ACTIVITY_KINDS, ACTIVITY_STATUSES, syntheticActivityItems } from "./activity.mjs";
import { KYC_STATUSES, OPERATOR_CAPABILITY_POLICY } from "./capabilities.mjs";
import { syntheticSupportTickets, TICKET_CATEGORIES } from "./support.mjs";

// Deterministic synthetic operator admin source. A future operator-directory
// adapter replaces it behind `viewFor(subject, grantedCapabilities) ->
// Promise<OperatorAdminView>`; payloads are frozen and derived from the
// subject plus the granted capabilities the caller already evaluated, so
// reads stay reproducible. The view is the operator's own admin overview —
// an opaque opr_* handle, the owning operator subject, a staff role from a
// fixed enum, the granted capability echo and ISO created/updated timestamps
// — never credentials, secrets or PII, so nothing here can authenticate or
// authorize anything. No I/O.

// The role set mirrors the staff role vocabulary of the operator backoffice.
// No role implying a money or command effect exists: capabilities, not roles,
// decide what an operator surface may do.
export const OPERATOR_ROLES = Object.freeze([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "fraud-investigator",
  "auditor"
]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-operator-admin-v1";
const VIEW_KEYS = Object.freeze([
  "mode",
  "operator_id",
  "subject",
  "role",
  "granted_capabilities",
  "created_at",
  "updated_at"
]);
const OPERATOR_ID_PATTERN = /^opr_[0-9a-f]{24}$/u;
const SUBJECT_PATTERN = /^syn_oper_[a-z0-9]{8,32}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const GRANTED_CAPABILITIES_MAX_ITEMS = 32;
const OPERATOR_CAPABILITY_VOCABULARY = new Set(
  OPERATOR_CAPABILITY_POLICY.map((policy) => policy.capability)
);
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const CREATED_WINDOW_MS = 90 * 86_400_000;
const UPDATED_WINDOW_MS = 30 * 86_400_000;

/**
 * @typedef {object} OperatorAdminView
 * @property {string} mode
 * @property {string} operator_id
 * @property {string} subject
 * @property {string} role
 * @property {readonly string[]} granted_capabilities
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {object} OperatorDirectory
 * @property {(subject: string, grantedCapabilities: readonly string[]) => Promise<OperatorAdminView>} viewFor
 */

/**
 * @param {string} subject
 * @param {string} salt
 */
function digest(subject, salt) {
  return createHash("sha256").update(`${SIGNATURE_DOMAIN}\n${subject}\n${salt}`).digest();
}

/**
 * @param {string} subject
 * @param {string} salt
 * @param {bigint} bound
 */
function units(subject, salt, bound) {
  return digest(subject, salt).readBigUInt64BE(0) % bound;
}

/**
 * @param {string} subject
 * @param {readonly string[]} grantedCapabilities
 * @returns {OperatorAdminView}
 */
function buildOperatorAdminView(subject, grantedCapabilities) {
  const createdMs = BASE_MS + Number(units(subject, "created", BigInt(CREATED_WINDOW_MS)));
  const updatedMs = createdMs + Number(units(subject, "updated", BigInt(UPDATED_WINDOW_MS)));
  return Object.freeze({
    mode: "test",
    operator_id: `opr_${digest(subject, "id").toString("hex").slice(0, 24)}`,
    subject,
    role: OPERATOR_ROLES[Number(units(subject, "role", BigInt(OPERATOR_ROLES.length)))],
    granted_capabilities: Object.freeze([...grantedCapabilities]),
    created_at: new Date(createdMs).toISOString(),
    updated_at: new Date(updatedMs).toISOString()
  });
}

/**
 * The operator's staff role is the same deterministic draw the admin view
 * echoes, so a route's role gate can never disagree with the role the
 * operator's own overview reports.
 * @param {string} subject
 * @returns {string}
 */
export function operatorRoleFor(subject) {
  return OPERATOR_ROLES[Number(units(subject, "role", BigInt(OPERATOR_ROLES.length)))];
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/** @param {unknown} granted */
function validGrantedCapabilities(granted) {
  return (
    Array.isArray(granted) &&
    granted.length <= GRANTED_CAPABILITIES_MAX_ITEMS &&
    new Set(granted).size === granted.length &&
    // The echo only ever reports real operator capability ids — a view
    // claiming a capability outside the declared policy vocabulary fails.
    granted.every((item) => typeof item === "string" && OPERATOR_CAPABILITY_VOCABULARY.has(item))
  );
}

/** @param {unknown} view */
export function validOperatorAdminView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorAdminView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (
    candidate.mode !== "test" ||
    !OPERATOR_ID_PATTERN.test(candidate.operator_id) ||
    !SUBJECT_PATTERN.test(candidate.subject) ||
    !OPERATOR_ROLES.includes(candidate.role) ||
    !validGrantedCapabilities(candidate.granted_capabilities)
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.created_at) || !isIsoTimestamp(candidate.updated_at)) {
    return false;
  }
  // Record coherence mirrors the synthetic build: an operator record cannot
  // be updated before it was created.
  return Date.parse(candidate.updated_at) >= Date.parse(candidate.created_at);
}

// The operator meta pair. The session view is the token principal's own
// metadata — the operator subject, its audience, the granted scopes, the
// token expiry and the device binding every operator operation requires —
// never credentials or secrets. The capabilities view projects the operator
// policy evaluation onto the shared wire shape (granted names only, like the
// customer capabilities read: denial reasons are not a client surface).
const SESSION_VIEW_KEYS = Object.freeze([
  "subject",
  "actor_type",
  "scopes",
  "expires_at",
  "device_bound"
]);
const CAPABILITIES_VIEW_KEYS = Object.freeze(["capabilities", "commands_enabled"]);

/**
 * @typedef {object} OperatorSessionView
 * @property {string} subject
 * @property {string} actor_type
 * @property {readonly string[]} scopes
 * @property {string} expires_at
 * @property {boolean} device_bound
 */

/**
 * @typedef {object} OperatorCapabilitiesView
 * @property {readonly string[]} capabilities
 * @property {boolean} commands_enabled
 */

/**
 * @param {import("./auth.mjs").Principal} principal
 * @returns {OperatorSessionView}
 */
export function operatorSessionViewFor(principal) {
  return Object.freeze({
    subject: principal.subject,
    actor_type: "operator",
    scopes: Object.freeze([...principal.scopes]),
    expires_at: principal.expiresAt,
    // X-Device-Id is mandatory on every operator operation, so a served
    // operator session is always bound to a workstation device identifier.
    device_bound: true
  });
}

/**
 * @param {Readonly<{ granted: readonly string[], commandsEnabled: boolean }>} evaluation
 * @returns {OperatorCapabilitiesView}
 */
export function operatorCapabilitiesViewFor(evaluation) {
  return Object.freeze({
    capabilities: Object.freeze([...evaluation.granted]),
    commands_enabled: evaluation.commandsEnabled
  });
}

/** @param {unknown} scopes */
function validScopes(scopes) {
  return (
    Array.isArray(scopes) &&
    new Set(scopes).size === scopes.length &&
    scopes.every((scope) => typeof scope === "string" && scope.length >= 1 && scope.length <= 128)
  );
}

/** @param {unknown} view */
export function validOperatorSessionView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorSessionView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...SESSION_VIEW_KEYS].sort())) {
    return false;
  }
  return (
    SUBJECT_PATTERN.test(candidate.subject) &&
    candidate.actor_type === "operator" &&
    validScopes(candidate.scopes) &&
    isIsoTimestamp(candidate.expires_at) &&
    candidate.device_bound === true
  );
}

/** @param {unknown} view */
export function validOperatorCapabilitiesView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorCapabilitiesView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...CAPABILITIES_VIEW_KEYS].sort())) {
    return false;
  }
  return (
    validScopes(candidate.capabilities) &&
    candidate.capabilities.every((capability) =>
      OPERATOR_CAPABILITY_VOCABULARY.has(capability)
    ) &&
    candidate.commands_enabled === false
  );
}

/** @returns {OperatorDirectory} */
export function createSyntheticOperatorDirectory() {
  // No per-subject memo: views are pure functions of the subject and the
  // granted capabilities, and a retained cache would grow without bound.
  return Object.freeze({
    async viewFor(subject, grantedCapabilities) {
      return buildOperatorAdminView(subject, grantedCapabilities);
    }
  });
}

// The operator subjects directory is the staff-facing customer list. Every
// operator administers the SAME deterministic synthetic customer set, so the
// read is caller-independent: the seam takes no subject argument (a future
// role-scoped adapter may add one, but the synthetic universe is global by
// contract). Rows expose the synthetic customer subject ref (`syn_cust_*`),
// the same ref grammar the customer audience authenticates with — operators
// administer exactly these subjects, and backoffice surfaces cross-reference
// them without a namespace mapping that would need a stored lookup. Each row
// carries a transliterated display name, the customer KYC lifecycle enum, a
// bounded count of open queue flags, coherent ISO timestamps and a posting
// marker that stays "none" — an opaque identity projection only, never a
// money field, credential or PII. No I/O.
const SUBJECTS_SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-operator-subjects-v1";
const SUBJECTS_VIEW_KEYS = Object.freeze(["mode", "subjects"]);
const SUBJECT_ROW_KEYS = Object.freeze([
  "display_name",
  "flags",
  "kyc_status",
  "last_active_at",
  "posting",
  "registered_at",
  "subject_id"
]);
const CUSTOMER_SUBJECT_PATTERN = /^syn_cust_[a-z0-9]{8,32}$/u;
const DISPLAY_NAME_PATTERN = /^[A-Z][a-z]{1,31} [A-Z][a-z]{1,31}$/u;
const SUBJECTS_COUNT = 24;
const SUBJECT_ACCOUNT_STATUSES = Object.freeze(["active", "dormant", "restricted", "closed"]);
const SUBJECT_DETAIL_VIEW_KEYS = Object.freeze(["mode", "subject"]);
const SUBJECT_DETAIL_KEYS = Object.freeze([
  "account_status",
  "contact_hash",
  "devices",
  "display_name",
  "flags",
  "kyc",
  "kyc_status",
  "last_active_at",
  "limits",
  "posting",
  "recent_activity",
  "registered_at",
  "sessions",
  "subject_id"
]);

// The recent_activity page merges the subject's own customer feed items
// (the #276 recipe, re-mapped onto the operator summary shape) with
// operator-side events — kyc transitions following the roster kyc_status
// lifecycle and one flag_added row per open flag — re-sorted newest
// first and bounded to the operator page size. `occurred_at` never
// exceeds the roster's pinned as-of instant (QUEUE_SNAPSHOT_MS).
const RECENT_ACTIVITY_BOUND = 8;
const OPERATOR_ACTIVITY_ITEM_KEYS = Object.freeze(["activity_id", "kind", "occurred_at", "summary", "money"]);
const OPERATOR_ACTIVITY_MONEY_KEYS = Object.freeze(["amount", "asset"]);
const OPERATOR_ACTIVITY_ID_PATTERN = /^(act|opact)_[0-9a-f]{24}$/u;
const OPERATOR_ONLY_KINDS = Object.freeze(["kyc_transition", "flag_added"]);
const KYC_TRANSITION_SUMMARIES = Object.freeze(["submitted", "approved"]);
const KYC_APPROVED_BASE_MS = 86_400_000;
const KYC_APPROVED_JITTER_MS = 14 * 86_400_000;
const AML_ALERT_TYPES = Object.freeze(["structuring", "velocity", "geo_mismatch"]);
const ACTIVITY_ASSET_SCALES = new Map(Object.entries(ACTIVITY_ASSETS));
// The money-carrying kinds mirror the activity recipe's money set — every
// customer kind but kyc and security; operator kinds never carry money.
const ACTIVITY_MONEY_KINDS = new Set(ACTIVITY_KINDS.filter((kind) => kind !== "kyc" && kind !== "security"));
const OPERATOR_ACTIVITY_SUMMARIES = new Set([
  ...Object.values(ACTIVITY_STATUSES).flat(),
  ...KYC_TRANSITION_SUMMARIES,
  ...AML_ALERT_TYPES
]);

// The subject's KYC dossier rides the same detail view: a nullable block
// carrying the current application state, the tier the newest session
// targeted and its kys_* handle, plus a newest-first attempt history
// bounded to the operator summary size. It is minted from the shared
// roster row through the same sha256 recipe — no new entropy — and its
// timestamps reuse the queue's submitted/approved instant derivations,
// so the dossier agrees with the neighboring blocks. The block is null
// whenever the universe draw lands the subject on a no-application state
// (not_started|unavailable); the field itself is always present, and it
// stays detail-only — list rows never carry it.
const KYC_HISTORY_BOUND = 4;
const KYC_DECISION_WINDOW_MS = 5 * 86_400_000;
const SUBJECT_KYC_KEYS = Object.freeze(["history", "level", "session_id", "status"]);
const SUBJECT_KYC_ATTEMPT_KEYS = Object.freeze([
  "decided_at",
  "rejection_reason",
  "session_id",
  "state",
  "submitted_at"
]);
const SUBJECT_KYC_LEVELS = Object.freeze(["basic", "enhanced"]);
const SUBJECT_KYC_STATUSES = Object.freeze([
  "approved",
  "in_review",
  "needs_more_data",
  "rejected",
  "submitted",
  "timed_out"
]);
const SUBJECT_KYC_PENDING_STATUSES = Object.freeze(["submitted", "in_review"]);
// States a resubmission can follow: rejected, needs_more_data and
// timed_out attempts may be retried; approved never is.
const SUBJECT_KYC_ENDINGS = Object.freeze(["rejected", "needs_more_data", "timed_out"]);
const SUBJECT_KYC_NO_APPLICATION = Object.freeze(["not_started", "unavailable"]);
const SUBJECT_KYC_UNVERIFIED_STATES = Object.freeze([
  ...SUBJECT_KYC_NO_APPLICATION,
  ...SUBJECT_KYC_ENDINGS
]);
const SUBJECT_KYC_REASON_CODES = Object.freeze(["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"]);
const SUBJECT_KYC_SESSION_PATTERN = /^kys_[0-9a-f]{24}$/u;
/** The customer feed's kind set plus the two operator-side event kinds. */
export const OPERATOR_ACTIVITY_KINDS = Object.freeze([...ACTIVITY_KINDS, ...OPERATOR_ONLY_KINDS]);
const SUBJECT_LIMIT_KEYS = Object.freeze(["max_devices", "max_sessions"]);

/**
 * The current dossier state the roster kyc_status bounds the draw to —
 * shared by the row (last_active coverage) and the dossier itself so both
 * derivations agree on whether an application exists at all.
 * @param {string} subjectId
 * @param {string} kycStatus
 * @returns {string}
 */
function subjectDossierStatus(subjectId, kycStatus) {
  if (kycStatus === "verified") {
    return "approved";
  }
  if (kycStatus === "pending") {
    return SUBJECT_KYC_PENDING_STATUSES[
      Number(subjectsUnits(subjectId, "kyc-pending", BigInt(SUBJECT_KYC_PENDING_STATUSES.length)))
    ];
  }
  return SUBJECT_KYC_UNVERIFIED_STATES[
    Number(subjectsUnits(subjectId, "kyc-unverified", BigInt(SUBJECT_KYC_UNVERIFIED_STATES.length)))
  ];
}

/**
 * The newest submission instant the dossier, the kyc queue item and the
 * recent_activity transition all project: one derivation, one instant.
 * @param {string} subjectId
 * @param {number} registeredMs
 * @returns {number}
 */
function subjectKycSubmittedMs(subjectId, registeredMs) {
  return Math.max(
    registeredMs,
    QUEUE_SNAPSHOT_MS - Number(subjectsUnits(subjectId, "age", BigInt(QUEUE_AGE_WINDOW_MS)))
  );
}
const CONTACT_HASH_PATTERN = /^cth_[0-9a-f]{32}$/u;
const DEVICE_REF_PATTERN = /^dev_[0-9a-f]{16}$/u;
const SUBJECT_MAX_SESSIONS_BOUND = 8;
const SUBJECT_MAX_DEVICES_BOUND = 6;
const SUBJECT_DEVICE_DIGEST_PREFIX = "dev_";
const SUBJECTS_MAX_ITEMS = 64;
const FLAGS_BOUND = 8;
const REGISTERED_WINDOW_MS = 120 * 86_400_000;
const ACTIVE_WINDOW_MS = 30 * 86_400_000;
const SUBJECT_FIRST_NAMES = Object.freeze([
  "Alina",
  "Maria",
  "Ilya",
  "Roman",
  "Elena",
  "Anton",
  "Dmitry",
  "Sofia",
  "Nursultan",
  "Aigerim",
  "Timur",
  "Vera",
  "Oleg",
  "Dana",
  "Pavel",
  "Zhanna"
]);
const SUBJECT_LAST_NAMES = Object.freeze([
  "Mironova",
  "Koval",
  "Nurov",
  "Yudin",
  "Sokolova",
  "Bely",
  "Orlov",
  "Petrova",
  "Bekov",
  "Isakova",
  "Kravets",
  "Smirnova",
  "Volkov",
  "Kim",
  "Sorokina",
  "Aliyev"
]);

/**
 * @typedef {object} OperatorSubjectRow
 * @property {string} subject_id
 * @property {string} display_name
 * @property {string} kyc_status
 * @property {number} flags
 * @property {string} registered_at
 * @property {string} last_active_at
 * @property {string} posting
 */

/**
 * @typedef {object} OperatorSubjectsView
 * @property {string} mode
 * @property {readonly OperatorSubjectRow[]} subjects
 */

/**
 * @typedef {object} OperatorSubjectActivityItem
 * @property {string} activity_id
 * @property {string} kind
 * @property {string} occurred_at
 * @property {string} summary
 * @property {{ amount: string, asset: string } | null} money
 */

/**
 * @typedef {object} OperatorSubjectLimits
 * @property {number} max_sessions
 * @property {number} max_devices
 */

/**
 * @typedef {object} OperatorSubjectDetail
 * @property {string} subject_id
 * @property {string} display_name
 * @property {string} kyc_status
 * @property {number} flags
 * @property {string} registered_at
 * @property {string} last_active_at
 * @property {string} posting
 * @property {string} account_status
 * @property {string} contact_hash
 * @property {number} sessions
 * @property {readonly string[]} devices
 * @property {OperatorSubjectLimits} limits
 * @property {readonly OperatorSubjectActivityItem[]} recent_activity
 * @property {OperatorSubjectKyc | null} kyc
 */

/**
 * One KYC attempt within the dossier history. `decided_at` stays null
 * while the attempt sits inside the review window; `rejection_reason`
 * is only ever set when the attempt ended `rejected`.
 * @typedef {object} OperatorSubjectKycAttempt
 * @property {string} session_id
 * @property {string} state
 * @property {string} submitted_at
 * @property {string | null} decided_at
 * @property {string | null} rejection_reason
 */

/**
 * The subject's KYC dossier: the current application state, the tier the
 * newest attempt targeted and its `kys_*` session handle, plus the
 * newest-first attempt history. `status` and `session_id` echo
 * `history[0]` — the newest attempt is always the current session.
 * @typedef {object} OperatorSubjectKyc
 * @property {string} status
 * @property {string} level
 * @property {string} session_id
 * @property {readonly OperatorSubjectKycAttempt[]} history
 */

/**
 * @typedef {object} OperatorSubjectDetailView
 * @property {string} mode
 * @property {OperatorSubjectDetail} subject
 */

/**
 * @typedef {object} OperatorQueueItem
 * @property {string} queue_id
 * @property {string} subject_id
 * @property {string} display_name
 * @property {string} submitted_at
 * @property {string} sla_due_at
 * @property {string} state
 * @property {string} priority
 * @property {{ subject: string } | null} assignee
 * @property {number} age_ms
 */

/**
 * @typedef {object} OperatorAmlQueueItem
 * @property {string} queue_id
 * @property {string} subject_id
 * @property {string} alert_type
 * @property {readonly string[]} evidence_refs
 * @property {string} sla_due_at
 * @property {string} state
 * @property {string} priority
 * @property {{ subject: string } | null} assignee
 * @property {number} age_ms
 */

/**
 * @typedef {object} OperatorTicketQueueItem
 * @property {string} queue_id
 * @property {string} subject_id
 * @property {string} category
 * @property {string} opened_at
 * @property {string} state
 * @property {string} priority
 * @property {{ subject: string } | null} assignee
 * @property {number} age_ms
 */

/**
 * @typedef {object} OperatorQueueSummary
 * @property {number} count
 * @property {{ [state: string]: number }} by_state
 */

/**
 * @typedef {object} OperatorQueueSection
 * @property {string} kind
 * @property {readonly (OperatorQueueItem | OperatorAmlQueueItem | OperatorTicketQueueItem)[]} items
 * @property {OperatorQueueSummary} summary
 * @property {string} posting
 */

/**
 * @typedef {object} OperatorQueueView
 * @property {string} mode
 * @property {OperatorQueueSection} queue
 */

/**
 * One open flag on an AML queue item's subject. The flag record is what the
 * subject's flag_added activity rows announce: the same raised instant and
 * alert type, with its own `flg_*` handle minted from the same digest — so
 * the flag list, the activity feed and the roster flag count always agree.
 * @typedef {object} OperatorQueueItemFlag
 * @property {string} flag_id
 * @property {string} alert_type
 * @property {string} raised_at
 */

/**
 * @typedef {object} OperatorKycQueueItemDetail
 * @property {string} queue_id
 * @property {string} subject_id
 * @property {string} display_name
 * @property {string} submitted_at
 * @property {string} sla_due_at
 * @property {string} state
 * @property {string} priority
 * @property {{ subject: string } | null} assignee
 * @property {number} age_ms
 * @property {OperatorSubjectKyc | null} kyc
 */

/**
 * @typedef {object} OperatorAmlQueueItemDetail
 * @property {string} queue_id
 * @property {string} subject_id
 * @property {string} alert_type
 * @property {readonly string[]} evidence_refs
 * @property {string} sla_due_at
 * @property {string} state
 * @property {string} priority
 * @property {{ subject: string } | null} assignee
 * @property {number} age_ms
 * @property {readonly OperatorQueueItemFlag[]} flags
 */

/**
 * @typedef {object} OperatorTicketQueueItemDetail
 * @property {string} queue_id
 * @property {string} subject_id
 * @property {string} category
 * @property {string} opened_at
 * @property {string} state
 * @property {string} priority
 * @property {{ subject: string } | null} assignee
 * @property {number} age_ms
 * @property {string} subject
 * @property {string} last_message_at
 * @property {number} other_open_tickets
 */

/**
 * The member read of one queue item. `kind` echoes the path selector so the
 * item shape stays discriminated; `item` is the queue row the collection
 * would serve for that queue_id verbatim plus the per-kind detail keys —
 * the kyc dossier block for `kyc`, the subject's open flag list for `aml`,
 * and the projected ticket's subject/last message/open-ticket tally for
 * `tickets`.
 * @typedef {object} OperatorQueueItemDetailView
 * @property {string} mode
 * @property {string} kind
 * @property {OperatorKycQueueItemDetail | OperatorAmlQueueItemDetail | OperatorTicketQueueItemDetail} item
 */

/**
 * @typedef {object} OperatorSubjectsDirectory
 * @property {() => Promise<OperatorSubjectsView>} subjectsFor
 * @property {(subjectId: string) => Promise<OperatorSubjectDetailView | null>} subjectFor
 * @property {(kind?: string) => Promise<OperatorQueueView>} queueFor
 * @property {(kind: string, itemId: string) => Promise<OperatorQueueItemDetailView | null>} queueItemFor
 * @property {(cursor?: string) => Promise<OperatorAuditView | null>} auditFor
 */

/**
 * @param {string} subject
 * @param {string} salt
 */
function subjectsDigest(subject, salt) {
  return createHash("sha256")
    .update(`${SUBJECTS_SIGNATURE_DOMAIN}\n${subject}\n${salt}`)
    .digest();
}

/**
 * @param {string} subject
 * @param {string} salt
 * @param {bigint} bound
 */
function subjectsUnits(subject, salt, bound) {
  return subjectsDigest(subject, salt).readBigUInt64BE(0) % bound;
}

/**
 * @param {number} index
 * @returns {OperatorSubjectRow}
 */
function buildSubjectRow(index) {
  const seed = `subject-${index}`;
  const subjectId = `syn_cust_${subjectsDigest(seed, "id").toString("hex").slice(0, 24)}`;
  const registeredMs = BASE_MS + Number(subjectsUnits(seed, "registered", BigInt(REGISTERED_WINDOW_MS)));
  const kycStatus = KYC_STATUSES[Number(subjectsUnits(seed, "kyc", BigInt(KYC_STATUSES.length)))];
  // The account window bounds every subject-side instant. `last_active_at`
  // covers the newest one — the re-anchored feed items and the submission
  // instant the dossier, queue and transition all project — so no block can
  // show the subject acting after it (a flag raise or a kyc decision is
  // operator-side work and can legitimately postdate it).
  const dossierStatus = subjectDossierStatus(subjectId, kycStatus);
  const feedItems = syntheticActivityItems(subjectId);
  const lastSubjectSideMs = Math.max(
    registeredMs,
    ...feedItems.map((item) => registeredMs + (Date.parse(item.created_at) - BASE_MS)),
    SUBJECT_KYC_NO_APPLICATION.includes(dossierStatus) ? 0 : subjectKycSubmittedMs(subjectId, registeredMs)
  );
  const lastActiveMs = Math.max(
    lastSubjectSideMs,
    registeredMs + Number(subjectsUnits(seed, "active", BigInt(ACTIVE_WINDOW_MS)))
  );
  return Object.freeze({
    subject_id: subjectId,
    display_name: [
      SUBJECT_FIRST_NAMES[Number(subjectsUnits(seed, "first", BigInt(SUBJECT_FIRST_NAMES.length)))],
      SUBJECT_LAST_NAMES[Number(subjectsUnits(seed, "last", BigInt(SUBJECT_LAST_NAMES.length)))]
    ].join(" "),
    kyc_status: kycStatus,
    flags: Number(subjectsUnits(seed, "flags", BigInt(FLAGS_BOUND))),
    registered_at: new Date(registeredMs).toISOString(),
    last_active_at: new Date(lastActiveMs).toISOString(),
    posting: "none"
  });
}

// The customer-360 detail extends the list row with fields derived solely
// from the subject id through the same sha256 recipe — no new entropy
// source. `contact_hash` stays a redacted digest (the contract boundary
// rejects field names carrying raw-PII tokens), devices stay opaque `dev_*`
// handles, and the limits echo is bounded so sessions/devices always fit
// inside it. Because every field is a pure function of the id, the
// validator can recompute the entire detail and compare it verbatim.
/** @param {string} subjectId */
function subjectRowIndex(subjectId) {
  for (let index = 0; index < SUBJECTS_COUNT; index += 1) {
    if (buildSubjectRow(index).subject_id === subjectId) {
      return index;
    }
  }
  return -1;
}

/**
 * @param {string} subjectId
 * @returns {{account_status: string, contact_hash: string, sessions: number, devices: readonly string[], limits: OperatorSubjectLimits}}
 */
function deriveSubjectDetailFields(subjectId) {
  const accountStatus =
    SUBJECT_ACCOUNT_STATUSES[Number(subjectsUnits(subjectId, "account", BigInt(SUBJECT_ACCOUNT_STATUSES.length)))];
  const maxSessions = Number(subjectsUnits(subjectId, "max-sessions", BigInt(SUBJECT_MAX_SESSIONS_BOUND))) + 1;
  const maxDevices = Number(subjectsUnits(subjectId, "max-devices", BigInt(SUBJECT_MAX_DEVICES_BOUND))) + 1;
  const deviceCount = Number(subjectsUnits(subjectId, "devices", BigInt(maxDevices + 1)));
  // A live session needs a device to live on and a live account to sit in:
  // a zero-device draw or a closed account means no sessions.
  const sessions = deviceCount === 0 || accountStatus === "closed"
    ? 0
    : Number(subjectsUnits(subjectId, "sessions", BigInt(maxSessions + 1)));
  const devices = [];
  for (let index = 0; index < deviceCount; index += 1) {
    devices.push(`${SUBJECT_DEVICE_DIGEST_PREFIX}${subjectsDigest(subjectId, `device-${index}`).toString("hex").slice(0, 16)}`);
  }
  return {
    account_status: accountStatus,
    contact_hash: `cth_${subjectsDigest(subjectId, "contact").toString("hex").slice(0, 32)}`,
    sessions,
    devices: Object.freeze(devices),
    limits: Object.freeze({
      max_sessions: maxSessions,
      max_devices: maxDevices
    })
  };
}

/**
 * One deterministic operator-side kyc_transition item. Its summary is the
 * kyc application status the transition reached.
 * @param {string} subjectId
 * @param {string} summary
 * @param {number} atMs
 * @returns {OperatorSubjectActivityItem}
 */
function kycTransitionItem(subjectId, summary, atMs) {
  return Object.freeze({
    activity_id: `opact_${subjectsDigest(subjectId, `kyc-${summary}`).toString("hex").slice(0, 24)}`,
    kind: "kyc_transition",
    occurred_at: new Date(atMs).toISOString(),
    summary,
    money: null
  });
}

/**
 * The subject's recent_activity page: its own customer feed items
 * re-mapped onto the operator summary shape (kind kept, status becomes
 * the i18n-safe summary), merged with operator-side kyc transitions and
 * flag_added rows, re-sorted newest first and bounded to the operator
 * page size. The feed instants are re-anchored onto the subject's own
 * registration — the feed recipe pins its `created_at` to the shared
 * epoch, which can precede a late-registered account entirely; keeping
 * the relative spacing inside the account window is the composed view's
 * job. Pure function of the roster row — no cache, no stored lookup.
 * @param {OperatorSubjectRow} row
 * @returns {readonly OperatorSubjectActivityItem[]}
 */
function deriveSubjectRecentActivity(row) {
  const subjectId = row.subject_id;
  const registeredMs = Date.parse(row.registered_at);
  /** @type {OperatorSubjectActivityItem[]} */
  const items = syntheticActivityItems(subjectId).map((item) =>
    Object.freeze({
      activity_id: item.activity_id,
      kind: item.kind,
      occurred_at: new Date(registeredMs + (Date.parse(item.created_at) - BASE_MS)).toISOString(),
      summary: item.status,
      money: item.money
    }));
  // kyc transitions reuse the same submitted_at the kyc queue projects.
  if (row.kyc_status !== "unverified") {
    const submittedMs = subjectKycSubmittedMs(subjectId, registeredMs);
    items.push(kycTransitionItem(subjectId, "submitted", submittedMs));
    if (row.kyc_status === "verified") {
      const approvedMs = Math.min(
        submittedMs + KYC_APPROVED_BASE_MS + Number(subjectsUnits(subjectId, "kyc-approved", BigInt(KYC_APPROVED_JITTER_MS))),
        QUEUE_SNAPSHOT_MS
      );
      items.push(kycTransitionItem(subjectId, "approved", approvedMs));
    }
  }
  // One flag_added row per open roster flag; its summary names the AML
  // alert type the flag was raised for.
  for (let index = 0; index < row.flags; index += 1) {
    const flagMs = registeredMs + Number(
      subjectsUnits(subjectId, `flag-at-${index}`, BigInt(QUEUE_SNAPSHOT_MS - registeredMs))
    );
    items.push(Object.freeze({
      activity_id: `opact_${subjectsDigest(subjectId, `flag-${index}`).toString("hex").slice(0, 24)}`,
      kind: "flag_added",
      occurred_at: new Date(flagMs).toISOString(),
      summary: AML_ALERT_TYPES[Number(subjectsUnits(subjectId, `flag-type-${index}`, BigInt(AML_ALERT_TYPES.length)))],
      money: null
    }));
  }
  items.sort((a, b) => (a.occurred_at === b.occurred_at
    ? a.activity_id.localeCompare(b.activity_id)
    : b.occurred_at.localeCompare(a.occurred_at)));
  return Object.freeze(items.slice(0, RECENT_ACTIVITY_BOUND));
}

/**
 * The subject's KYC dossier, minted from the roster row through the same
 * sha256 recipe. The roster kyc_status bounds the current application
 * state: verified subjects are approved, pending ones sit inside the
 * review window, and unverified ones draw across the terminal endings
 * and the no-application states — a no-application draw yields a null
 * block. The newest attempt reuses the submitted instant the kyc queue
 * item and the recent_activity kyc_transition project (and, for verified
 * subjects, the same approved instant), so the dossier agrees with the
 * neighboring blocks; earlier attempts always end in a resubmittable
 * state decided no later than the next attempt's submission. Pure
 * function of the row — no cache, no stored lookup.
 * @param {OperatorSubjectRow} row
 * @returns {OperatorSubjectKyc | null}
 */
function deriveSubjectKyc(row) {
  const subjectId = row.subject_id;
  const status = subjectDossierStatus(subjectId, row.kyc_status);
  if (SUBJECT_KYC_NO_APPLICATION.includes(status)) {
    return null;
  }
  const registeredMs = Date.parse(row.registered_at);
  const submittedMs = subjectKycSubmittedMs(subjectId, registeredMs);
  /** @type {number | null} */
  let decidedMs = null;
  if (status === "approved") {
    decidedMs = Math.min(
      submittedMs + KYC_APPROVED_BASE_MS + Number(subjectsUnits(subjectId, "kyc-approved", BigInt(KYC_APPROVED_JITTER_MS))),
      QUEUE_SNAPSHOT_MS
    );
  } else if (SUBJECT_KYC_ENDINGS.includes(status)) {
    decidedMs = Math.min(
      submittedMs + Number(subjectsUnits(subjectId, "kyc-decision", BigInt(KYC_DECISION_WINDOW_MS))),
      QUEUE_SNAPSHOT_MS
    );
  }
  const attemptCount = 1 + Number(subjectsUnits(subjectId, "kyc-attempts", BigInt(KYC_HISTORY_BOUND)));
  /** @type {OperatorSubjectKycAttempt[]} */
  const history = [];
  history.push(Object.freeze({
    session_id: `kys_${subjectsDigest(subjectId, "kyc-session-0").toString("hex").slice(0, 24)}`,
    state: status,
    submitted_at: new Date(submittedMs).toISOString(),
    decided_at: decidedMs === null ? null : new Date(decidedMs).toISOString(),
    rejection_reason: status === "rejected"
      ? SUBJECT_KYC_REASON_CODES[Number(subjectsUnits(subjectId, "kyc-reason-0", BigInt(SUBJECT_KYC_REASON_CODES.length)))]
      : null
  }));
  let ceilingMs = submittedMs;
  for (let index = 1; index < attemptCount; index += 1) {
    const olderDecidedMs = registeredMs + Number(
      subjectsUnits(subjectId, `kyc-decided-${index}`, BigInt(Math.max(1, ceilingMs - registeredMs)))
    );
    const olderSubmittedMs = registeredMs + Number(
      subjectsUnits(subjectId, `kyc-submitted-${index}`, BigInt(Math.max(1, olderDecidedMs - registeredMs + 1)))
    );
    const state = SUBJECT_KYC_ENDINGS[
      Number(subjectsUnits(subjectId, `kyc-state-${index}`, BigInt(SUBJECT_KYC_ENDINGS.length)))
    ];
    history.push(Object.freeze({
      session_id: `kys_${subjectsDigest(subjectId, `kyc-session-${index}`).toString("hex").slice(0, 24)}`,
      state,
      submitted_at: new Date(olderSubmittedMs).toISOString(),
      decided_at: new Date(olderDecidedMs).toISOString(),
      rejection_reason: state === "rejected"
        ? SUBJECT_KYC_REASON_CODES[Number(subjectsUnits(subjectId, `kyc-reason-${index}`, BigInt(SUBJECT_KYC_REASON_CODES.length)))]
        : null
    }));
    ceilingMs = olderSubmittedMs;
  }
  // Newest-first by submitted_at; the stable sort keeps the current
  // attempt first when instants tie, so history[0] is always the live
  // session the header echoes.
  history.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  return Object.freeze({
    status,
    level: SUBJECT_KYC_LEVELS[
      Number(subjectsUnits(subjectId, "kyc-level", BigInt(SUBJECT_KYC_LEVELS.length)))
    ],
    session_id: history[0].session_id,
    history: Object.freeze(history)
  });
}

/**
 * @param {OperatorSubjectRow} row
 * @returns {OperatorSubjectDetail}
 */
function buildSubjectDetail(row) {
  const derived = deriveSubjectDetailFields(row.subject_id);
  return Object.freeze({
    ...row,
    account_status: derived.account_status,
    contact_hash: derived.contact_hash,
    sessions: derived.sessions,
    devices: derived.devices,
    limits: derived.limits,
    recent_activity: deriveSubjectRecentActivity(row),
    kyc: deriveSubjectKyc(row)
  });
}

/** @returns {OperatorSubjectsView} */
function buildOperatorSubjectsView() {
  /** @type {OperatorSubjectRow[]} */
  const subjects = [];
  for (let index = 0; index < SUBJECTS_COUNT; index += 1) {
    subjects.push(buildSubjectRow(index));
  }
  return Object.freeze({
    mode: "test",
    subjects: Object.freeze(subjects)
  });
}

/** @param {unknown} row */
export function validOperatorSubjectRow(row) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return false;
  }
  const candidate = /** @type {OperatorSubjectRow} */ (row);
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...SUBJECT_ROW_KEYS].sort())) {
    return false;
  }
  if (
    !CUSTOMER_SUBJECT_PATTERN.test(candidate.subject_id) ||
    !DISPLAY_NAME_PATTERN.test(candidate.display_name) ||
    !KYC_STATUSES.includes(candidate.kyc_status) ||
    !Number.isInteger(candidate.flags) ||
    candidate.flags < 0 ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.registered_at) || !isIsoTimestamp(candidate.last_active_at)) {
    return false;
  }
  // A subject cannot have been active before it registered.
  return Date.parse(candidate.last_active_at) >= Date.parse(candidate.registered_at);
}

/** @param {unknown} view */
export function validOperatorSubjectsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorSubjectsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...SUBJECTS_VIEW_KEYS].sort())) {
    return false;
  }
  return (
    candidate.mode === "test" &&
    Array.isArray(candidate.subjects) &&
    candidate.subjects.length >= 1 &&
    candidate.subjects.length <= SUBJECTS_MAX_ITEMS &&
    candidate.subjects.every(validOperatorSubjectRow) &&
    new Set(candidate.subjects.map((row) => row.subject_id)).size === candidate.subjects.length
  );
}

/**
 * Canonical non-negative decimal string with exactly `scale` fraction digits.
 *
 * @param {unknown} value
 * @param {number} scale
 */
function isScaledDecimal(value, scale) {
  return (
    typeof value === "string" &&
    new RegExp(`^(0|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u").test(value)
  );
}

/**
 * @param {string} text
 * @returns {bigint}
 */
function parseUnits(text) {
  return BigInt(text.replace(".", ""));
}

/** @param {unknown} item */
function validOperatorSubjectActivityItem(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const candidate = /** @type {OperatorSubjectActivityItem} */ (item);
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify([...OPERATOR_ACTIVITY_ITEM_KEYS].sort())) {
    return false;
  }
  if (
    !OPERATOR_ACTIVITY_ID_PATTERN.test(candidate.activity_id) ||
    !OPERATOR_ACTIVITY_KINDS.includes(candidate.kind) ||
    !OPERATOR_ACTIVITY_SUMMARIES.has(candidate.summary) ||
    !isIsoTimestamp(candidate.occurred_at)
  ) {
    return false;
  }
  const operatorKind = OPERATOR_ONLY_KINDS.includes(candidate.kind);
  // `act_*` ids name the subject's own customer feed items; `opact_*` ids
  // are minted for the operator-side event kinds only.
  if (operatorKind !== candidate.activity_id.startsWith("opact_")) {
    return false;
  }
  if (operatorKind) {
    if (candidate.kind === "kyc_transition" && !KYC_TRANSITION_SUMMARIES.includes(candidate.summary)) {
      return false;
    }
    if (candidate.kind === "flag_added" && !AML_ALERT_TYPES.includes(candidate.summary)) {
      return false;
    }
  } else if (!ACTIVITY_STATUSES[candidate.kind].includes(candidate.summary)) {
    // A customer-kind item's summary is the referenced record's status.
    return false;
  }
  const money = /** @type {unknown} */ (candidate.money);
  if (money === null) {
    // Money-free kinds never carry an amount; money kinds always do.
    return !ACTIVITY_MONEY_KINDS.has(candidate.kind);
  }
  if (!ACTIVITY_MONEY_KINDS.has(candidate.kind) || typeof money !== "object" || Array.isArray(money)) {
    return false;
  }
  if (JSON.stringify(Object.keys(money).sort()) !== JSON.stringify([...OPERATOR_ACTIVITY_MONEY_KEYS].sort())) {
    return false;
  }
  const entry = /** @type {{ amount: string, asset: string }} */ (money);
  const scale = ACTIVITY_ASSET_SCALES.get(entry.asset);
  return scale !== undefined && isScaledDecimal(entry.amount, scale) && parseUnits(entry.amount) > 0n;
}

/**
 * Shape and coherence checks for one KYC dossier block: exact keys,
 * enum/pattern membership, the review-window and resubmittable-ending
 * rules, newest-first ordering and the header echoing history[0]. The
 * roster cross-checks and the verbatim recompute live in the detail
 * validator — subset discipline like recent_activity, never strict
 * counts.
 * @param {unknown} kyc
 */
export function validOperatorSubjectKyc(kyc) {
  if (kyc === null || typeof kyc !== "object" || Array.isArray(kyc)) {
    return false;
  }
  const candidate = /** @type {OperatorSubjectKyc} */ (kyc);
  if (JSON.stringify(Object.keys(kyc).sort()) !== JSON.stringify([...SUBJECT_KYC_KEYS].sort())) {
    return false;
  }
  if (
    !SUBJECT_KYC_STATUSES.includes(candidate.status) ||
    !SUBJECT_KYC_LEVELS.includes(candidate.level) ||
    !SUBJECT_KYC_SESSION_PATTERN.test(candidate.session_id) ||
    !Array.isArray(candidate.history) ||
    candidate.history.length < 1 ||
    candidate.history.length > KYC_HISTORY_BOUND
  ) {
    return false;
  }
  const sessionIds = new Set();
  let previousSubmittedAt = "";
  for (const [index, attempt] of candidate.history.entries()) {
    if (attempt === null || typeof attempt !== "object" || Array.isArray(attempt)) {
      return false;
    }
    if (JSON.stringify(Object.keys(attempt).sort()) !== JSON.stringify([...SUBJECT_KYC_ATTEMPT_KEYS].sort())) {
      return false;
    }
    const item = /** @type {OperatorSubjectKycAttempt} */ (attempt);
    if (
      !SUBJECT_KYC_SESSION_PATTERN.test(item.session_id) ||
      !SUBJECT_KYC_STATUSES.includes(item.state) ||
      !isIsoTimestamp(item.submitted_at) ||
      sessionIds.has(item.session_id)
    ) {
      return false;
    }
    sessionIds.add(item.session_id);
    const submittedMs = Date.parse(item.submitted_at);
    // Timestamps never exceed the roster's pinned as-of instant.
    if (submittedMs > QUEUE_SNAPSHOT_MS) {
      return false;
    }
    const inReview = SUBJECT_KYC_PENDING_STATUSES.includes(item.state);
    if (item.decided_at === null) {
      // Only attempts still inside the review window lack a decision.
      if (!inReview) {
        return false;
      }
    } else if (
      typeof item.decided_at !== "string" ||
      !isIsoTimestamp(item.decided_at) ||
      inReview ||
      Date.parse(item.decided_at) < submittedMs ||
      Date.parse(item.decided_at) > QUEUE_SNAPSHOT_MS
    ) {
      return false;
    }
    // A rejection_reason is only ever carried by a rejected attempt.
    if (
      item.rejection_reason !== null &&
      (item.state !== "rejected" || !SUBJECT_KYC_REASON_CODES.includes(item.rejection_reason))
    ) {
      return false;
    }
    // A resubmission only follows a resubmittable ending: non-first
    // attempts always carry one, decided no later than the next
    // attempt's submission.
    if (
      index > 0 &&
      (!SUBJECT_KYC_ENDINGS.includes(item.state) ||
        item.decided_at === null ||
        item.decided_at > candidate.history[index - 1].submitted_at)
    ) {
      return false;
    }
    // The history is newest first; equal instants keep mint order.
    if (index > 0 && item.submitted_at > previousSubmittedAt) {
      return false;
    }
    previousSubmittedAt = item.submitted_at;
  }
  // The header echoes the newest attempt.
  return (
    candidate.session_id === candidate.history[0].session_id &&
    candidate.status === candidate.history[0].state
  );
}

/** @param {unknown} view */
export function validOperatorSubjectDetailView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorSubjectDetailView} */ (view);
  if (
    JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...SUBJECT_DETAIL_VIEW_KEYS].sort()) ||
    candidate.mode !== "test"
  ) {
    return false;
  }
  const detail = /** @type {unknown} */ (candidate.subject);
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return false;
  }
  const subject = /** @type {OperatorSubjectDetail} */ (detail);
  if (JSON.stringify(Object.keys(detail).sort()) !== JSON.stringify([...SUBJECT_DETAIL_KEYS].sort())) {
    return false;
  }
  if (
    !CUSTOMER_SUBJECT_PATTERN.test(subject.subject_id) ||
    !DISPLAY_NAME_PATTERN.test(subject.display_name) ||
    !KYC_STATUSES.includes(subject.kyc_status) ||
    !Number.isInteger(subject.flags) ||
    subject.flags < 0 ||
    subject.posting !== "none" ||
    !SUBJECT_ACCOUNT_STATUSES.includes(subject.account_status) ||
    !CONTACT_HASH_PATTERN.test(subject.contact_hash) ||
    !Number.isInteger(subject.sessions) ||
    subject.sessions < 0 ||
    subject.sessions > 16 ||
    !Array.isArray(subject.devices) ||
    subject.devices.length > 8 ||
    new Set(subject.devices).size !== subject.devices.length ||
    !subject.devices.every((device) => DEVICE_REF_PATTERN.test(device))
  ) {
    return false;
  }
  const limits = /** @type {unknown} */ (subject.limits);
  if (limits === null || typeof limits !== "object" || Array.isArray(limits)) {
    return false;
  }
  if (JSON.stringify(Object.keys(limits).sort()) !== JSON.stringify([...SUBJECT_LIMIT_KEYS].sort())) {
    return false;
  }
  if (
    !Number.isInteger(subject.limits.max_sessions) ||
    subject.limits.max_sessions < 1 ||
    subject.limits.max_sessions > 16 ||
    !Number.isInteger(subject.limits.max_devices) ||
    subject.limits.max_devices < 1 ||
    subject.limits.max_devices > 8 ||
    subject.sessions > subject.limits.max_sessions ||
    subject.devices.length > subject.limits.max_devices
  ) {
    return false;
  }
  if (!isIsoTimestamp(subject.registered_at) || !isIsoTimestamp(subject.last_active_at)) {
    return false;
  }
  if (Date.parse(subject.last_active_at) < Date.parse(subject.registered_at)) {
    return false;
  }
  const activity = /** @type {unknown} */ (subject.recent_activity);
  if (!Array.isArray(activity) || activity.length < 1 || activity.length > RECENT_ACTIVITY_BOUND) {
    return false;
  }
  const registeredActivityMs = Date.parse(subject.registered_at);
  const lastActiveActivityMs = Date.parse(subject.last_active_at);
  const activityIds = new Set();
  let previousActivityMs = Number.POSITIVE_INFINITY;
  let previousActivityId = "";
  for (const item of activity) {
    if (!validOperatorSubjectActivityItem(item) || activityIds.has(item.activity_id)) {
      return false;
    }
    activityIds.add(item.activity_id);
    const occurredMs = Date.parse(item.occurred_at);
    // occurred_at never exceeds the roster's pinned as-of instant and
    // never precedes the account: nothing happens on a subject that does
    // not exist yet.
    if (occurredMs > QUEUE_SNAPSHOT_MS || occurredMs < registeredActivityMs) {
      return false;
    }
    // Subject-side instants — the subject's own feed items and the kyc
    // submission — can never postdate last_active_at; operator-side events
    // (flag raises, decisions) legitimately can.
    const operatorSide = item.activity_id.startsWith("opact_") &&
      !(item.kind === "kyc_transition" && item.summary === "submitted");
    if (!operatorSide && occurredMs > lastActiveActivityMs) {
      return false;
    }
    // The page is sorted newest first; same-instant items order by id.
    if (
      occurredMs > previousActivityMs ||
      (occurredMs === previousActivityMs && item.activity_id.localeCompare(previousActivityId) <= 0)
    ) {
      return false;
    }
    previousActivityMs = occurredMs;
    previousActivityId = item.activity_id;
  }
  // The operator-side events cross-check against the roster recipe within
  // the page bound: unverified subjects mint no kyc_transition, pending
  // ones only submitted, and flag_added rows never exceed the roster's open
  // flag count — the newest-first page drops the oldest events once full,
  // so presence is a subset of the recipe, never an invention.
  const transitions = activity.filter((item) => item.kind === "kyc_transition");
  if (subject.kyc_status === "unverified" && transitions.length !== 0) {
    return false;
  }
  if (subject.kyc_status === "pending" && transitions.some((item) => item.summary !== "submitted")) {
    return false;
  }
  if (new Set(transitions.map((item) => item.summary)).size !== transitions.length) {
    return false;
  }
  if (activity.filter((item) => item.kind === "flag_added").length > subject.flags) {
    return false;
  }
  // A live session sits on a device in a live account: zero registered
  // devices or a closed account means the session count must be zero.
  if (subject.sessions > 0 && (subject.devices.length === 0 || subject.account_status === "closed")) {
    return false;
  }
  // The nullable kyc dossier is detail-only and derives from the same
  // roster row; the roster kyc_status bounds its current state without
  // pinning the attempt count — the same subset discipline the
  // recent_activity cross-checks apply.
  if (subject.kyc !== null && !validOperatorSubjectKyc(subject.kyc)) {
    return false;
  }
  if (subject.kyc !== null) {
    if (subject.kyc_status === "verified" && subject.kyc.status !== "approved") {
      return false;
    }
    if (subject.kyc_status === "pending" && !SUBJECT_KYC_PENDING_STATUSES.includes(subject.kyc.status)) {
      return false;
    }
    if (
      subject.kyc_status === "unverified" &&
      (subject.kyc.status === "approved" || SUBJECT_KYC_PENDING_STATUSES.includes(subject.kyc.status))
    ) {
      return false;
    }
    // Every attempt submission is subject-side work inside the account
    // window, and the instant the transition projects — whenever the
    // newest submission survives the page bound — must equal it.
    for (const attempt of subject.kyc.history) {
      const submittedMs = Date.parse(attempt.submitted_at);
      if (submittedMs < registeredActivityMs || submittedMs > lastActiveActivityMs) {
        return false;
      }
    }
    const submittedTransition = activity.find(
      (item) => item.kind === "kyc_transition" && item.summary === "submitted"
    );
    if (
      submittedTransition !== undefined &&
      submittedTransition.occurred_at !== subject.kyc.history[0].submitted_at
    ) {
      return false;
    }
    const approvedTransition = activity.find(
      (item) => item.kind === "kyc_transition" && item.summary === "approved"
    );
    if (
      approvedTransition !== undefined &&
      approvedTransition.occurred_at !== subject.kyc.history[0].decided_at
    ) {
      return false;
    }
  }
  // The detail is a pure function of the shared roster: the list fields
  // must equal the row minted for the id's index, and every derived field
  // must equal the deterministic derivation for that id. Anything else is
  // a fabricated read and fails closed.
  const index = subjectRowIndex(subject.subject_id);
  if (index === -1) {
    return false;
  }
  const row = buildSubjectRow(index);
  const derived = deriveSubjectDetailFields(subject.subject_id);
  return (
    subject.display_name === row.display_name &&
    subject.kyc_status === row.kyc_status &&
    subject.flags === row.flags &&
    subject.registered_at === row.registered_at &&
    subject.last_active_at === row.last_active_at &&
    subject.account_status === derived.account_status &&
    subject.contact_hash === derived.contact_hash &&
    subject.sessions === derived.sessions &&
    JSON.stringify(subject.devices) === JSON.stringify(derived.devices) &&
    JSON.stringify(subject.limits) === JSON.stringify(derived.limits) &&
    JSON.stringify(subject.recent_activity) === JSON.stringify(deriveSubjectRecentActivity(row)) &&
    JSON.stringify(subject.kyc) === JSON.stringify(deriveSubjectKyc(row))
  );
}

/** @returns {OperatorSubjectsDirectory} */
export function createSyntheticOperatorSubjectsDirectory() {
  // The directory views are pure functions of the pinned roster — no
  // subject-scoped cache exists, so nothing can grow without bound.
  return Object.freeze({
    async subjectsFor() {
      return buildOperatorSubjectsView();
    },
    // The member read reuses the shared universe: the requested id resolves
    // to its roster index (the bounded 24-row scan — no stored lookup) and
    // the detail re-derives the row plus its id-bound extension, so the
    // detail can never disagree with the list row for the same id.
    /** @param {string} subjectId */
    async subjectFor(subjectId) {
      const index = subjectRowIndex(subjectId);
      if (index === -1) {
        return null;
      }
      return Object.freeze({
        mode: "test",
        subject: buildSubjectDetail(buildSubjectRow(index))
      });
    },
    // The queue is a read-only projection of the same roster this directory
    // already owns, so it shares the directory seam instead of minting a
    // third one.
    /** @param {string} [kind] */
    async queueFor(kind) {
      return buildOperatorQueueView(kind);
    },
    // The member read resolves inside the requested kind's item set only:
    // an out-of-enum kind, an unknown id or a well-formed id minted for a
    // different kind all answer the same null — the kind-mismatch case can
    // never leak which ids the other kinds hold. A hit re-derives the row
    // plus its per-kind extension, so the detail can never disagree with
    // the list row for the same queue_id.
    /** @param {string} kind @param {string} itemId */
    async queueItemFor(kind, itemId) {
      if (!OPERATOR_QUEUE_KINDS.includes(kind)) {
        return null;
      }
      const item = expectedQueueItems(kind).find((candidate) => candidate.queue_id === itemId);
      if (item === undefined) {
        return null;
      }
      const index = subjectRowIndex(item.subject_id);
      if (index === -1) {
        return null;
      }
      return Object.freeze({
        mode: "test",
        kind,
        item: buildQueueItemDetail(kind, item, buildSubjectRow(index))
      });
    },
    // The audit feed is a read-only projection of the same roster: the
    // cursor is an opaque `auc_*` page token minted per page boundary, so
    // a well-formed token that was never served resolves the same null a
    // member miss does — uniform, never revealing which tokens are live.
    /** @param {string} [cursor] */
    async auditFor(cursor) {
      const entries = expectedAuditEntries();
      let offset = 0;
      if (cursor !== undefined) {
        offset = -1;
        for (
          let candidate = OPERATOR_AUDIT_PAGE_SIZE;
          candidate < entries.length;
          candidate += OPERATOR_AUDIT_PAGE_SIZE
        ) {
          if (auditCursorToken(candidate) === cursor) {
            offset = candidate;
            break;
          }
        }
        if (offset === -1) {
          return null;
        }
      }
      return buildOperatorAuditView(offset, entries);
    }
  });
}

// The operator work queue is a read-only projection of the shared customer
// universe served in three kinds behind the single `operator.queue.read`
// capability — a queue is the same read tier regardless of the kind it
// projects, so no kind mints a capability or a gate of its own.
//
// `kyc` (the default): every subject whose kyc_status is anything but
// "verified" occupies the queue — a "pending" application and a still
// "unverified" file both await operator attention here, and a verified
// subject leaves it.
//
// `aml`: every subject the roster still flags for review (an open flag
// count of at least one) is an open alert — `qml_*` ids, an opaque
// `alert_type` from the fixed enum, `evd_*` evidence handles only (never
// raw transaction details), and the same pending/in_review/escalated
// lifecycle the flag count drives everywhere else.
//
// `tickets`: every subject with non-trivial support activity — more than
// one ticket in the shared support universe — occupies the queue through
// its newest ticket: `qtick_*` ids, the ticket's own category from the
// support vocabulary, `opened_at` echoing its creation, and the
// open/waiting/escalated lifecycle — "open" while the newest ticket sits
// untouched at "received", "waiting" once the desk engaged it, "escalated"
// on roster flags.
//
// Every item carries only deterministic queue metadata: the opaque queue
// id, the timestamp draws clamped to never precede the subject's own
// registration, the SLA deadline at a deterministic offset, the state, the
// priority that follows it, the assignee that stays null while the item is
// unclaimed and the age against the pinned snapshot instant. Nothing here
// mints or implies an approval state change — a queue read is a
// projection, never a decision surface.
export const OPERATOR_QUEUE_KINDS = Object.freeze(["kyc", "aml", "tickets"]);
const QUEUE_KIND = "kyc";
const QUEUE_VIEW_KEYS = Object.freeze(["mode", "queue"]);
const QUEUE_KEYS = Object.freeze(["items", "kind", "posting", "summary"]);
const QUEUE_ITEM_KEYS = Object.freeze([
  "age_ms",
  "assignee",
  "display_name",
  "priority",
  "queue_id",
  "sla_due_at",
  "state",
  "subject_id",
  "submitted_at"
]);
const AML_QUEUE_ITEM_KEYS = Object.freeze([
  "age_ms",
  "alert_type",
  "assignee",
  "evidence_refs",
  "priority",
  "queue_id",
  "sla_due_at",
  "state",
  "subject_id"
]);
const TICKET_QUEUE_ITEM_KEYS = Object.freeze([
  "age_ms",
  "assignee",
  "category",
  "opened_at",
  "priority",
  "queue_id",
  "state",
  "subject_id"
]);
const QUEUE_SUMMARY_KEYS = Object.freeze(["by_state", "count"]);
export const OPERATOR_QUEUE_STATES = Object.freeze(["pending", "in_review", "escalated"]);
export const OPERATOR_TICKET_QUEUE_STATES = Object.freeze(["open", "waiting", "escalated"]);
const QUEUE_KIND_STATES = Object.freeze({
  kyc: OPERATOR_QUEUE_STATES,
  aml: OPERATOR_QUEUE_STATES,
  tickets: OPERATOR_TICKET_QUEUE_STATES
});
const QUEUE_STATE_KEYS = Object.freeze(
  Object.fromEntries(
    Object.entries(QUEUE_KIND_STATES).map(([kind, states]) => [kind, Object.freeze([...states].sort())])
  )
);
export const OPERATOR_QUEUE_PRIORITIES = Object.freeze(["normal", "high", "urgent"]);
const QUEUE_ASSIGNEE_KEYS = Object.freeze(["subject"]);
const QUEUE_ID_PATTERN = /^qky_[0-9a-f]{24}$/u;
const AML_QUEUE_ID_PATTERN = /^qml_[0-9a-f]{24}$/u;
const TICKET_QUEUE_ID_PATTERN = /^qtick_[0-9a-f]{24}$/u;
const EVIDENCE_REF_PATTERN = /^evd_[0-9a-f]{24}$/u;
const EVIDENCE_REFS_MAX_ITEMS = 8;
const QUEUE_MAX_ITEMS = 64;
const QUEUE_ITEM_DETAIL_VIEW_KEYS = Object.freeze(["item", "kind", "mode"]);
const KYC_QUEUE_ITEM_DETAIL_KEYS = Object.freeze([...QUEUE_ITEM_KEYS, "kyc"]);
const AML_QUEUE_ITEM_DETAIL_KEYS = Object.freeze([...AML_QUEUE_ITEM_KEYS, "flags"]);
const TICKET_QUEUE_ITEM_DETAIL_KEYS = Object.freeze([
  ...TICKET_QUEUE_ITEM_KEYS,
  "last_message_at",
  "other_open_tickets",
  "subject"
]);
const QUEUE_ITEM_FLAG_KEYS = Object.freeze(["alert_type", "flag_id", "raised_at"]);
const FLAG_ID_PATTERN = /^flg_[0-9a-f]{24}$/u;
// Support ticket subjects are short single-line topics; the wire never
// carries free-form text longer than this.
const TICKET_SUBJECT_MAX_LENGTH = 160;
// The pinned snapshot instant the queue ages against. The read is a pure
// function, so its "now" is part of the derivation — it lands after every
// roster registration (the registered window is 120 days from BASE_MS),
// which keeps every item's age non-negative.
const QUEUE_SNAPSHOT_MS = BASE_MS + 150 * 86_400_000;
const QUEUE_AGE_WINDOW_MS = 21 * 86_400_000;
const QUEUE_SLA_BASE_MS = 2 * 86_400_000;
const QUEUE_SLA_JITTER_MS = 3 * 86_400_000;
const AML_AGE_WINDOW_MS = 28 * 86_400_000;
const AML_SLA_BASE_MS = 86_400_000;
const AML_SLA_JITTER_MS = 2 * 86_400_000;
const AML_FLAGS_MIN = 1;
const TICKET_QUEUE_MIN_TICKETS = 2;
const QUEUE_ESCALATION_FLAGS_MIN = 4;
const QUEUE_HIGH_FLAGS_MIN = 2;

/**
 * @param {OperatorSubjectRow} row
 * @returns {string}
 */
function queueItemState(row) {
  // An escalated item is a flagged one: the roster's open flag count is the
  // escalation driver, so a queue item can never disagree with the flags a
  // subject row already exposes.
  if (row.flags >= QUEUE_ESCALATION_FLAGS_MIN) {
    return "escalated";
  }
  // A submitted application sits in review; everything else is an awaiting
  // item no operator has picked up yet.
  return row.kyc_status === "pending" ? "in_review" : "pending";
}

/**
 * @param {OperatorSubjectRow} row
 * @param {string} state
 * @returns {string}
 */
function queueItemPriority(row, state) {
  if (state === "escalated") {
    return "urgent";
  }
  return row.flags >= QUEUE_HIGH_FLAGS_MIN ? "high" : "normal";
}

/**
 * @param {OperatorSubjectRow} row
 * @returns {OperatorQueueItem}
 */
function buildQueueItem(row) {
  const subjectId = row.subject_id;
  const registeredMs = Date.parse(row.registered_at);
  // An application can never be submitted before the account exists: the
  // deterministic age draw is clamped to the subject's own registration.
  const submittedMs = Math.max(
    registeredMs,
    QUEUE_SNAPSHOT_MS - Number(subjectsUnits(subjectId, "age", BigInt(QUEUE_AGE_WINDOW_MS)))
  );
  const slaDueMs =
    submittedMs + QUEUE_SLA_BASE_MS + Number(subjectsUnits(subjectId, "sla", BigInt(QUEUE_SLA_JITTER_MS)));
  const state = queueItemState(row);
  return Object.freeze({
    queue_id: `qky_${subjectsDigest(subjectId, "queue").toString("hex").slice(0, 24)}`,
    subject_id: subjectId,
    display_name: row.display_name,
    submitted_at: new Date(submittedMs).toISOString(),
    sla_due_at: new Date(slaDueMs).toISOString(),
    state,
    priority: queueItemPriority(row, state),
    // An awaiting item is unclaimed; once an operator picks it up the
    // assignee is a deterministic syn_oper_* staff ref inside the nested
    // slot (nullable only inside a nested object, per the money precedent).
    assignee: state === "pending"
      ? null
      : Object.freeze({
          subject: `syn_oper_${subjectsDigest(subjectId, "assignee").toString("hex").slice(0, 16)}`
        }),
    age_ms: QUEUE_SNAPSHOT_MS - submittedMs
  });
}

/**
 * The AML lifecycle rides the roster's flag count alone: at least one open
 * flag means the alert exists, escalation follows the same escalation
 * threshold the KYC item uses, anything below it is an in-review item a
 * staff member picked up, and a single-flag subject is still an awaiting
 * alert nobody claimed.
 * @param {OperatorSubjectRow} row
 * @returns {string}
 */
function amlQueueItemState(row) {
  if (row.flags >= QUEUE_ESCALATION_FLAGS_MIN) {
    return "escalated";
  }
  return row.flags >= QUEUE_HIGH_FLAGS_MIN ? "in_review" : "pending";
}

/**
 * @param {OperatorSubjectRow} row
 * @returns {OperatorAmlQueueItem}
 */
function buildAmlQueueItem(row) {
  const subjectId = row.subject_id;
  const registeredMs = Date.parse(row.registered_at);
  // An alert can never be raised before the account exists: the
  // deterministic age draw is clamped to the subject's own registration.
  const raisedMs = Math.max(
    registeredMs,
    QUEUE_SNAPSHOT_MS - Number(subjectsUnits(subjectId, "aml-age", BigInt(AML_AGE_WINDOW_MS)))
  );
  const slaDueMs =
    raisedMs + AML_SLA_BASE_MS + Number(subjectsUnits(subjectId, "aml-sla", BigInt(AML_SLA_JITTER_MS)));
  const state = amlQueueItemState(row);
  // Evidence stays opaque evd_* handles minted from the same digest recipe —
  // the queue never leaks raw transaction or screening details.
  const evidenceCount = 1 + Number(subjectsUnits(subjectId, "aml-evidence-count", BigInt(EVIDENCE_REFS_MAX_ITEMS - 1)));
  const evidenceRefs = [];
  for (let index = 0; index < evidenceCount; index += 1) {
    evidenceRefs.push(
      `evd_${subjectsDigest(subjectId, `aml-evidence-${index}`).toString("hex").slice(0, 24)}`
    );
  }
  return Object.freeze({
    queue_id: `qml_${subjectsDigest(subjectId, "aml-queue").toString("hex").slice(0, 24)}`,
    subject_id: subjectId,
    alert_type:
      AML_ALERT_TYPES[Number(subjectsUnits(subjectId, "aml-alert-type", BigInt(AML_ALERT_TYPES.length)))],
    evidence_refs: Object.freeze(evidenceRefs),
    sla_due_at: new Date(slaDueMs).toISOString(),
    state,
    priority: queueItemPriority(row, state),
    // An awaiting alert is unclaimed; once an operator picks it up the
    // assignee is a deterministic syn_oper_* staff ref inside the nested
    // slot (nullable only inside a nested object, per the money precedent).
    assignee: state === "pending"
      ? null
      : Object.freeze({
          subject: `syn_oper_${subjectsDigest(subjectId, "aml-assignee").toString("hex").slice(0, 16)}`
        }),
    age_ms: QUEUE_SNAPSHOT_MS - raisedMs
  });
}

/**
 * @param {OperatorSubjectRow} row
 * @param {import("./support.mjs").TicketView} ticket
 * @returns {OperatorTicketQueueItem}
 */
function buildTicketQueueItem(row, ticket) {
  const subjectId = row.subject_id;
  // The roster's flag count escalates the item outright; a ticket still
  // untouched at "received" is open work, anything further along is the
  // desk's in-flight item — an operator already engaged it.
  const state =
    row.flags >= QUEUE_ESCALATION_FLAGS_MIN ? "escalated" : ticket.status === "received" ? "open" : "waiting";
  // A complaint or a flagged subject pulls the item up a tier; escalation
  // already sets the ceiling.
  const priority =
    state === "escalated"
      ? "urgent"
      : ticket.category === "complaint" || row.flags >= QUEUE_HIGH_FLAGS_MIN
        ? "high"
        : "normal";
  return Object.freeze({
    queue_id: `qtick_${subjectsDigest(subjectId, "ticket-queue").toString("hex").slice(0, 24)}`,
    subject_id: subjectId,
    category: ticket.category,
    opened_at: ticket.created_at,
    state,
    priority,
    // An open ticket is unclaimed; once the desk engages it the assignee is
    // a deterministic syn_oper_* staff ref inside the nested slot.
    assignee: state === "open"
      ? null
      : Object.freeze({
          subject: `syn_oper_${subjectsDigest(subjectId, "ticket-assignee").toString("hex").slice(0, 16)}`
        }),
    age_ms: QUEUE_SNAPSHOT_MS - Date.parse(ticket.created_at)
  });
}

/** @returns {readonly OperatorQueueItem[]} */
function expectedKycQueueItems() {
  const items = [];
  for (let index = 0; index < SUBJECTS_COUNT; index += 1) {
    const row = buildSubjectRow(index);
    if (row.kyc_status === "verified") {
      continue;
    }
    items.push(buildQueueItem(row));
  }
  // Most overdue work first; the id breaks ties so the order is total.
  items.sort((left, right) =>
    left.sla_due_at === right.sla_due_at
      ? left.queue_id.localeCompare(right.queue_id)
      : left.sla_due_at.localeCompare(right.sla_due_at)
  );
  return items;
}

/** @returns {readonly OperatorAmlQueueItem[]} */
function expectedAmlQueueItems() {
  const items = [];
  for (let index = 0; index < SUBJECTS_COUNT; index += 1) {
    const row = buildSubjectRow(index);
    if (row.flags < AML_FLAGS_MIN) {
      continue;
    }
    items.push(buildAmlQueueItem(row));
  }
  items.sort((left, right) =>
    left.sla_due_at === right.sla_due_at
      ? left.queue_id.localeCompare(right.queue_id)
      : left.sla_due_at.localeCompare(right.sla_due_at)
  );
  return items;
}

/** @returns {readonly OperatorTicketQueueItem[]} */
function expectedTicketQueueItems() {
  const items = [];
  for (let index = 0; index < SUBJECTS_COUNT; index += 1) {
    const row = buildSubjectRow(index);
    // Non-trivial support activity is repeat contact: a single ticket is
    // routine, two or more land the subject's newest ticket in the queue.
    const tickets = syntheticSupportTickets(row.subject_id);
    if (tickets.length < TICKET_QUEUE_MIN_TICKETS) {
      continue;
    }
    items.push(buildTicketQueueItem(row, tickets[0]));
  }
  // Oldest untouched work first; the id breaks ties so the order is total.
  items.sort((left, right) =>
    left.opened_at === right.opened_at
      ? left.queue_id.localeCompare(right.queue_id)
      : left.opened_at.localeCompare(right.opened_at)
  );
  return items;
}

/**
 * @param {string} kind
 * @returns {readonly (OperatorQueueItem | OperatorAmlQueueItem | OperatorTicketQueueItem)[]}
 */
function expectedQueueItems(kind) {
  if (kind === "aml") {
    return expectedAmlQueueItems();
  }
  if (kind === "tickets") {
    return expectedTicketQueueItems();
  }
  return expectedKycQueueItems();
}

/**
 * The subject's open flag list — one flag record per roster flag, raised
 * inside the registration→snapshot window and typed by the same draws the
 * flag_added activity rows use, so the queue detail, the recent-activity
 * feed and the roster flag count can never disagree. The flag id shares
 * the flag_added event's digest under its own `flg_*` grammar.
 * @param {OperatorSubjectRow} row
 * @returns {readonly OperatorQueueItemFlag[]}
 */
function queueItemFlags(row) {
  const subjectId = row.subject_id;
  const registeredMs = Date.parse(row.registered_at);
  /** @type {OperatorQueueItemFlag[]} */
  const flags = [];
  for (let index = 0; index < row.flags; index += 1) {
    const flagMs = registeredMs + Number(
      subjectsUnits(subjectId, `flag-at-${index}`, BigInt(QUEUE_SNAPSHOT_MS - registeredMs))
    );
    flags.push(Object.freeze({
      flag_id: `flg_${subjectsDigest(subjectId, `flag-${index}`).toString("hex").slice(0, 24)}`,
      alert_type:
        AML_ALERT_TYPES[Number(subjectsUnits(subjectId, `flag-type-${index}`, BigInt(AML_ALERT_TYPES.length)))],
      raised_at: new Date(flagMs).toISOString()
    }));
  }
  // Oldest flag first; the id breaks ties so the order is total.
  flags.sort((left, right) =>
    left.raised_at === right.raised_at
      ? left.flag_id.localeCompare(right.flag_id)
      : left.raised_at.localeCompare(right.raised_at)
  );
  return Object.freeze(flags);
}

/**
 * The queue-item member read: the item row exactly as the kind's collection
 * derives it, plus that kind's detail keys — the kyc dossier reusing the
 * subject-detail recipe verbatim for `kyc`, the subject's open flag list
 * for `aml`, and the projected ticket's subject line, newest message
 * instant and other-open-ticket tally for `tickets` (a ticket counts as
 * open until its support status reaches "closed").
 * @param {string} kind
 * @param {OperatorQueueItem | OperatorAmlQueueItem | OperatorTicketQueueItem} item
 * @param {OperatorSubjectRow} row
 * @returns {OperatorKycQueueItemDetail | OperatorAmlQueueItemDetail | OperatorTicketQueueItemDetail}
 */
function buildQueueItemDetail(kind, item, row) {
  if (kind === "aml") {
    const amlItem = /** @type {OperatorAmlQueueItem} */ (item);
    return Object.freeze({ ...amlItem, flags: queueItemFlags(row) });
  }
  if (kind === "tickets") {
    const ticketItem = /** @type {OperatorTicketQueueItem} */ (item);
    const tickets = syntheticSupportTickets(row.subject_id);
    const ticket = tickets[0];
    const otherOpenTickets = tickets.slice(1).filter((entry) => entry.status !== "closed").length;
    return Object.freeze({
      ...ticketItem,
      subject: ticket.topic,
      last_message_at: ticket.timeline[ticket.timeline.length - 1].at,
      other_open_tickets: otherOpenTickets
    });
  }
  const kycItem = /** @type {OperatorQueueItem} */ (item);
  return Object.freeze({ ...kycItem, kyc: deriveSubjectKyc(row) });
}

/**
 * @param {string} kind
 * @param {readonly (OperatorQueueItem | OperatorAmlQueueItem | OperatorTicketQueueItem)[]} items
 * @returns {OperatorQueueSummary}
 */
function queueSummary(kind, items) {
  /** @type {{ [state: string]: number }} */
  const byState = {};
  for (const state of QUEUE_KIND_STATES[/** @type {"kyc" | "aml" | "tickets"} */ (kind)]) {
    byState[state] = 0;
  }
  for (const item of items) {
    byState[item.state] += 1;
  }
  return Object.freeze({ count: items.length, by_state: Object.freeze(byState) });
}

/**
 * @param {string} [kind]
 * @returns {OperatorQueueView}
 */
function buildOperatorQueueView(kind = QUEUE_KIND) {
  if (!OPERATOR_QUEUE_KINDS.includes(kind)) {
    // A kind outside the enum never mints a view — the request layer
    // rejects it before the directory is reached, and any other caller
    // fails closed here.
    throw new Error("Unknown operator queue kind");
  }
  const items = expectedQueueItems(kind);
  return Object.freeze({
    mode: "test",
    queue: Object.freeze({
      kind,
      items: Object.freeze(items),
      summary: queueSummary(kind, items),
      posting: "none"
    })
  });
}

/**
 * The assignee slot is the same nested shape for every kind: null while the
 * item is unclaimed, else a single `subject` key holding a syn_oper_*
 * staff ref.
 * @param {unknown} assignee
 */
function validQueueAssignee(assignee) {
  if (assignee === null) {
    return true;
  }
  if (typeof assignee !== "object" || Array.isArray(assignee)) {
    return false;
  }
  const candidate = /** @type {{ subject: unknown }} */ (assignee);
  return (
    JSON.stringify(Object.keys(assignee).sort()) ===
      JSON.stringify([...QUEUE_ASSIGNEE_KEYS].sort()) &&
    typeof candidate.subject === "string" &&
    SUBJECT_PATTERN.test(candidate.subject)
  );
}

/** @param {unknown} item */
function validQueueItemShape(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const candidate = /** @type {OperatorQueueItem} */ (item);
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify([...QUEUE_ITEM_KEYS].sort())) {
    return false;
  }
  if (
    !QUEUE_ID_PATTERN.test(candidate.queue_id) ||
    !CUSTOMER_SUBJECT_PATTERN.test(candidate.subject_id) ||
    !DISPLAY_NAME_PATTERN.test(candidate.display_name) ||
    !OPERATOR_QUEUE_STATES.includes(candidate.state) ||
    !OPERATOR_QUEUE_PRIORITIES.includes(candidate.priority) ||
    !Number.isInteger(candidate.age_ms) ||
    candidate.age_ms < 0
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.submitted_at) || !isIsoTimestamp(candidate.sla_due_at)) {
    return false;
  }
  if (Date.parse(candidate.sla_due_at) <= Date.parse(candidate.submitted_at)) {
    return false;
  }
  return validQueueAssignee(candidate.assignee);
}

/** @param {unknown} item */
function validAmlQueueItemShape(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const candidate = /** @type {OperatorAmlQueueItem} */ (item);
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify([...AML_QUEUE_ITEM_KEYS].sort())) {
    return false;
  }
  if (
    !AML_QUEUE_ID_PATTERN.test(candidate.queue_id) ||
    !CUSTOMER_SUBJECT_PATTERN.test(candidate.subject_id) ||
    !AML_ALERT_TYPES.includes(candidate.alert_type) ||
    !Array.isArray(candidate.evidence_refs) ||
    candidate.evidence_refs.length < 1 ||
    candidate.evidence_refs.length > EVIDENCE_REFS_MAX_ITEMS ||
    new Set(candidate.evidence_refs).size !== candidate.evidence_refs.length ||
    !candidate.evidence_refs.every((ref) => EVIDENCE_REF_PATTERN.test(ref)) ||
    !OPERATOR_QUEUE_STATES.includes(candidate.state) ||
    !OPERATOR_QUEUE_PRIORITIES.includes(candidate.priority) ||
    !Number.isInteger(candidate.age_ms) ||
    candidate.age_ms < 0 ||
    !isIsoTimestamp(candidate.sla_due_at)
  ) {
    return false;
  }
  return validQueueAssignee(candidate.assignee);
}

/** @param {unknown} item */
function validTicketQueueItemShape(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const candidate = /** @type {OperatorTicketQueueItem} */ (item);
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify([...TICKET_QUEUE_ITEM_KEYS].sort())) {
    return false;
  }
  if (
    !TICKET_QUEUE_ID_PATTERN.test(candidate.queue_id) ||
    !CUSTOMER_SUBJECT_PATTERN.test(candidate.subject_id) ||
    !(/** @type {readonly string[]} */ (TICKET_CATEGORIES)).includes(candidate.category) ||
    !OPERATOR_TICKET_QUEUE_STATES.includes(candidate.state) ||
    !OPERATOR_QUEUE_PRIORITIES.includes(candidate.priority) ||
    !Number.isInteger(candidate.age_ms) ||
    candidate.age_ms < 0 ||
    !isIsoTimestamp(candidate.opened_at)
  ) {
    return false;
  }
  return validQueueAssignee(candidate.assignee);
}

/** @param {unknown} view */
export function validOperatorQueueView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorQueueView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...QUEUE_VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test") {
    return false;
  }
  const queue = /** @type {unknown} */ (candidate.queue);
  if (queue === null || typeof queue !== "object" || Array.isArray(queue)) {
    return false;
  }
  const section = /** @type {OperatorQueueSection} */ (queue);
  if (JSON.stringify(Object.keys(queue).sort()) !== JSON.stringify([...QUEUE_KEYS].sort())) {
    return false;
  }
  // The declared kind selects the item shape, the state vocabulary and the
  // derivation; a kind outside the enum is not a queue view at all.
  const kind = section.kind;
  if (!OPERATOR_QUEUE_KINDS.includes(kind) || section.posting !== "none") {
    return false;
  }
  const validItemShape =
    kind === "aml"
      ? validAmlQueueItemShape
      : kind === "tickets"
        ? validTicketQueueItemShape
        : validQueueItemShape;
  if (!Array.isArray(section.items) || section.items.length > QUEUE_MAX_ITEMS) {
    return false;
  }
  if (!section.items.every(validItemShape)) {
    return false;
  }
  const summary = /** @type {unknown} */ (section.summary);
  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
    return false;
  }
  if (JSON.stringify(Object.keys(summary).sort()) !== JSON.stringify([...QUEUE_SUMMARY_KEYS].sort())) {
    return false;
  }
  const byState = /** @type {unknown} */ (section.summary.by_state);
  if (byState === null || typeof byState !== "object" || Array.isArray(byState)) {
    return false;
  }
  const stateKeys = QUEUE_STATE_KEYS[/** @type {"kyc" | "aml" | "tickets"} */ (kind)];
  if (JSON.stringify(Object.keys(byState).sort()) !== JSON.stringify([...stateKeys].sort())) {
    return false;
  }
  if (
    !Number.isInteger(section.summary.count) ||
    section.summary.count < 0 ||
    !Object.values(section.summary.by_state).every(
      (value) => Number.isInteger(value) && value >= 0
    )
  ) {
    return false;
  }
  // The queue is a pure function of the shared roster: the item set must
  // equal the deterministic membership derivation verbatim — membership,
  // order and every derived field — and the summary must equal the counts
  // recomputed over it. The expected set is built from the roster rows
  // alone, so verbatim equality is also the subject cross-check: any item
  // referencing a subject outside `subjectsFor()` fails the comparison.
  // Anything else is a fabricated read and fails closed.
  const expected = expectedQueueItems(kind);
  if (section.items.length !== expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (JSON.stringify(section.items[index]) !== JSON.stringify(expected[index])) {
      return false;
    }
  }
  const recomputed = queueSummary(kind, expected);
  return (
    section.summary.count === recomputed.count &&
    stateKeys.every(
      (state) => section.summary.by_state[state] === recomputed.by_state[state]
    )
  );
}

/**
 * Shape check for one AML queue-item flag record: exact keys, the `flg_*`
 * grammar, the alert-type vocabulary and a raised instant inside the
 * roster's window.
 * @param {unknown} flag
 */
function validQueueItemFlag(flag) {
  if (flag === null || typeof flag !== "object" || Array.isArray(flag)) {
    return false;
  }
  const candidate = /** @type {OperatorQueueItemFlag} */ (flag);
  if (JSON.stringify(Object.keys(flag).sort()) !== JSON.stringify([...QUEUE_ITEM_FLAG_KEYS].sort())) {
    return false;
  }
  return (
    FLAG_ID_PATTERN.test(candidate.flag_id) &&
    AML_ALERT_TYPES.includes(candidate.alert_type) &&
    isIsoTimestamp(candidate.raised_at) &&
    Date.parse(candidate.raised_at) <= QUEUE_SNAPSHOT_MS
  );
}

/**
 * A kyc queue-item detail is the queue row verbatim plus the nullable kyc
 * dossier block — exact keys, the row's own shape and the dossier's own
 * validator.
 * @param {unknown} detail
 */
function validKycQueueItemDetail(detail) {
  const candidate = /** @type {OperatorKycQueueItemDetail} */ (detail);
  if (JSON.stringify(Object.keys(/** @type {object} */ (detail)).sort()) !== JSON.stringify([...KYC_QUEUE_ITEM_DETAIL_KEYS].sort())) {
    return false;
  }
  const { kyc, ...item } = candidate;
  return validQueueItemShape(item) && (kyc === null || validOperatorSubjectKyc(kyc));
}

/**
 * An aml queue-item detail is the queue row verbatim plus the subject's
 * open flag list — exact keys, the row's own shape and bounded flag records
 * with unique ids.
 * @param {unknown} detail
 */
function validAmlQueueItemDetail(detail) {
  const candidate = /** @type {OperatorAmlQueueItemDetail} */ (detail);
  if (JSON.stringify(Object.keys(/** @type {object} */ (detail)).sort()) !== JSON.stringify([...AML_QUEUE_ITEM_DETAIL_KEYS].sort())) {
    return false;
  }
  const { flags, ...item } = candidate;
  return (
    validAmlQueueItemShape(item) &&
    Array.isArray(flags) &&
    flags.length <= FLAGS_BOUND &&
    flags.every(validQueueItemFlag) &&
    new Set(flags.map((flag) => flag.flag_id)).size === flags.length
  );
}

/**
 * A tickets queue-item detail is the queue row verbatim plus the projected
 * ticket's subject line, its newest message instant and the subject's
 * other-open-ticket tally.
 * @param {unknown} detail
 */
function validTicketQueueItemDetail(detail) {
  const candidate = /** @type {OperatorTicketQueueItemDetail} */ (detail);
  if (JSON.stringify(Object.keys(/** @type {object} */ (detail)).sort()) !== JSON.stringify([...TICKET_QUEUE_ITEM_DETAIL_KEYS].sort())) {
    return false;
  }
  const { subject, last_message_at, other_open_tickets, ...item } = candidate;
  return (
    validTicketQueueItemShape(item) &&
    typeof subject === "string" &&
    subject.length > 0 &&
    subject.length <= TICKET_SUBJECT_MAX_LENGTH &&
    isIsoTimestamp(last_message_at) &&
    Date.parse(last_message_at) <= QUEUE_SNAPSHOT_MS &&
    Number.isInteger(other_open_tickets) &&
    other_open_tickets >= 0 &&
    other_open_tickets <= SUBJECTS_MAX_ITEMS
  );
}

/**
 * Member-read check for `GET /api/v1/operator/queue/{kind}/{itemId}`: the
 * top-level view keys, the kind enum, and the detail's own per-kind shape —
 * then the full verbatim recompute. The detail must equal the item row the
 * kind's collection derives for that queue_id plus the derived extension
 * (the #312 dossier recipe for kyc, the flag list for aml, the ticket
 * extension for tickets), so a detail can never disagree with the queue
 * row — or name a subject outside `subjectsFor()` — without failing.
 * @param {unknown} view
 */
export function validOperatorQueueItemDetail(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorQueueItemDetailView} */ (view);
  if (
    JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...QUEUE_ITEM_DETAIL_VIEW_KEYS].sort()) ||
    candidate.mode !== "test" ||
    !OPERATOR_QUEUE_KINDS.includes(candidate.kind)
  ) {
    return false;
  }
  const detail = /** @type {unknown} */ (candidate.item);
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    return false;
  }
  if (
    candidate.kind === "aml"
      ? !validAmlQueueItemDetail(detail)
      : candidate.kind === "tickets"
        ? !validTicketQueueItemDetail(detail)
        : !validKycQueueItemDetail(detail)
  ) {
    return false;
  }
  const index = subjectRowIndex(candidate.item.subject_id);
  if (index === -1) {
    return false;
  }
  const expected = expectedQueueItems(candidate.kind).find(
    (item) => item.queue_id === candidate.item.queue_id
  );
  if (expected === undefined) {
    return false;
  }
  return (
    JSON.stringify(detail) ===
    JSON.stringify(buildQueueItemDetail(candidate.kind, expected, buildSubjectRow(index)))
  );
}

// ---------------------------------------------------------------------
// Operator audit feed: the deterministic action log of operator work over
// the shared customer universe — session opens/rotations, queue item
// views, subject-360 views and flag review actions, newest-first behind
// the role-scoped `operator.audit.read` capability. Every entry is a pure
// function of the roster: opaque `au_*` ids, `syn_oper_*` actor refs with
// the same role draw the admin view uses, and opaque `adh_*` detail
// digests — never raw contact data or PII, so nothing here authenticates
// or authorizes anything.

export const OPERATOR_AUDIT_PAGE_SIZE = 32;
const OPERATOR_AUDIT_EVENTS_PER_SUBJECT = 3;
const OPERATOR_AUDIT_ACTIONS = Object.freeze([
  "session.opened",
  "session.rotated",
  "queue.viewed",
  "subject.viewed",
  "flag.reviewed"
]);
const OPERATOR_AUDIT_TARGET_KINDS = Object.freeze(["session", "queue_item", "subject", "flag"]);
const AUDIT_VIEW_KEYS = Object.freeze(["mode", "audit"]);
const AUDIT_KEYS = Object.freeze(["as_of", "entries", "next_cursor"]);
const AUDIT_ENTRY_KEYS = Object.freeze([
  "action",
  "actor_role",
  "actor_subject_id",
  "at",
  "audit_id",
  "detail_hash",
  "target_id",
  "target_kind"
]);
const AUDIT_ID_PATTERN = /^au_[0-9a-f]{24}$/u;
const AUDIT_CURSOR_PATTERN = /^auc_[0-9a-f]{16}$/u;
const AUDIT_SESSION_TARGET_PATTERN = /^osn_[0-9a-f]{24}$/u;
const AUDIT_QUEUE_TARGET_PATTERN = /^(qky|qml|qtick)_[0-9a-f]{24}$/u;
const AUDIT_DETAIL_HASH_PATTERN = /^adh_[0-9a-f]{32}$/u;
const AUDIT_AS_OF_ISO = new Date(QUEUE_SNAPSHOT_MS).toISOString();

/**
 * @typedef {object} OperatorAuditEntry
 * @property {string} audit_id
 * @property {string} actor_subject_id
 * @property {string} actor_role
 * @property {string} action
 * @property {string} target_kind
 * @property {string} target_id
 * @property {string} at
 * @property {string} detail_hash
 */

/**
 * @typedef {object} OperatorAuditView
 * @property {string} mode
 * @property {{ as_of: string, entries: readonly OperatorAuditEntry[], next_cursor: string | null }} audit
 */

/** @param {unknown} value */
export function isOperatorAuditCursor(value) {
  return typeof value === "string" && AUDIT_CURSOR_PATTERN.test(value);
}

/**
 * The opaque page token for one page boundary: minted from the offset so
 * the feed can be replayed without ever exposing a position index.
 * @param {number} offset
 */
function auditCursorToken(offset) {
  return `auc_${subjectsDigest("operator-audit", `cursor-${offset}`).toString("hex").slice(0, 16)}`;
}

/**
 * Resolve the drawn action's target on this subject. A queue view needs a
 * queued item and a flag review needs an open flag; when the drawn action
 * has no live target the entry degrades to the always-live subject-360
 * view rather than minting a phantom target.
 * @param {string} action
 * @param {OperatorSubjectRow} row
 * @param {number} slot
 * @returns {{ kind: string, id: string } | null}
 */
function auditTargetFor(action, row, slot) {
  const subjectId = row.subject_id;
  if (action === "session.opened" || action === "session.rotated") {
    return {
      kind: "session",
      id: `osn_${subjectsDigest(subjectId, `audit-session-${slot}`).toString("hex").slice(0, 24)}`
    };
  }
  if (action === "subject.viewed") {
    return { kind: "subject", id: subjectId };
  }
  if (action === "flag.reviewed") {
    if (row.flags < 1) {
      return null;
    }
    const flags = queueItemFlags(row);
    return { kind: "flag", id: flags[slot % flags.length].flag_id };
  }
  // queue.viewed: the queues the subject currently occupies, in the fixed
  // kind order; the pick between them is another deterministic draw.
  const occupied = [];
  if (row.kyc_status !== "verified") {
    occupied.push(`qky_${subjectsDigest(subjectId, "queue").toString("hex").slice(0, 24)}`);
  }
  if (row.flags >= 1) {
    occupied.push(`qml_${subjectsDigest(subjectId, "aml-queue").toString("hex").slice(0, 24)}`);
  }
  if (syntheticSupportTickets(subjectId).length >= TICKET_QUEUE_MIN_TICKETS) {
    occupied.push(`qtick_${subjectsDigest(subjectId, "ticket-queue").toString("hex").slice(0, 24)}`);
  }
  if (occupied.length === 0) {
    return null;
  }
  return {
    kind: "queue_item",
    id: occupied[Number(subjectsUnits(subjectId, "audit-queue-pick", BigInt(occupied.length)))]
  };
}

/**
 * The full deterministic feed, newest first: three drawn events per roster
 * row, every instant inside the subject's own registration→snapshot
 * window, ties broken on the id so the order is total.
 * @returns {readonly OperatorAuditEntry[]}
 */
function expectedAuditEntries() {
  /** @type {OperatorAuditEntry[]} */
  const entries = [];
  for (let index = 0; index < SUBJECTS_COUNT; index += 1) {
    const row = buildSubjectRow(index);
    const subjectId = row.subject_id;
    const registeredMs = Date.parse(row.registered_at);
    for (let slot = 0; slot < OPERATOR_AUDIT_EVENTS_PER_SUBJECT; slot += 1) {
      let action =
        OPERATOR_AUDIT_ACTIONS[
          Number(subjectsUnits(subjectId, `audit-action-${slot}`, BigInt(OPERATOR_AUDIT_ACTIONS.length)))
        ];
      const actor = `syn_oper_${subjectsDigest(subjectId, `audit-actor-${slot}`).toString("hex").slice(0, 16)}`;
      const occurredMs =
        registeredMs +
        Number(subjectsUnits(subjectId, `audit-at-${slot}`, BigInt(QUEUE_SNAPSHOT_MS - registeredMs)));
      const target = auditTargetFor(action, row, slot);
      let targetKind;
      let targetId;
      if (target === null) {
        action = "subject.viewed";
        targetKind = "subject";
        targetId = subjectId;
      } else {
        targetKind = target.kind;
        targetId = target.id;
      }
      entries.push(
        Object.freeze({
          audit_id: `au_${subjectsDigest(subjectId, `audit-id-${slot}`).toString("hex").slice(0, 24)}`,
          actor_subject_id: actor,
          // The actor is a staff subject, so the role an entry attributes
          // to it is the admin view's own draw — the same one the route's
          // role gate consults — never the customer-roster's domain.
          actor_role: operatorRoleFor(actor),
          action,
          target_kind: targetKind,
          target_id: targetId,
          at: new Date(occurredMs).toISOString(),
          detail_hash: `adh_${subjectsDigest(subjectId, `audit-detail-${slot}`).toString("hex").slice(0, 32)}`
        })
      );
    }
  }
  entries.sort((left, right) =>
    left.at === right.at
      ? right.audit_id.localeCompare(left.audit_id)
      : right.at.localeCompare(left.at)
  );
  return entries;
}

/**
 * One page of the feed: `as_of` is the roster's pinned snapshot instant
 * (the queue's own "now"), the page holds at most OPERATOR_AUDIT_PAGE_SIZE
 * entries and `next_cursor` mints the next boundary only while entries
 * remain.
 * @param {number} offset
 * @param {readonly OperatorAuditEntry[]} entries
 * @returns {OperatorAuditView}
 */
function buildOperatorAuditView(offset, entries) {
  const page = entries.slice(offset, offset + OPERATOR_AUDIT_PAGE_SIZE);
  const nextOffset = offset + OPERATOR_AUDIT_PAGE_SIZE;
  return Object.freeze({
    mode: "test",
    audit: Object.freeze({
      as_of: AUDIT_AS_OF_ISO,
      entries: Object.freeze(page),
      next_cursor: nextOffset < entries.length ? auditCursorToken(nextOffset) : null
    })
  });
}

/**
 * Shape check for one audit entry: exact keys, the id/hash grammars, the
 * action and target-kind vocabularies, the target grammar matching the
 * declared kind, and an instant inside the roster's window.
 * @param {unknown} entry
 */
function validOperatorAuditEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const candidate = /** @type {OperatorAuditEntry} */ (entry);
  if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...AUDIT_ENTRY_KEYS].sort())) {
    return false;
  }
  if (
    !AUDIT_ID_PATTERN.test(candidate.audit_id) ||
    !SUBJECT_PATTERN.test(candidate.actor_subject_id) ||
    !OPERATOR_ROLES.includes(candidate.actor_role) ||
    !OPERATOR_AUDIT_ACTIONS.includes(candidate.action) ||
    !OPERATOR_AUDIT_TARGET_KINDS.includes(candidate.target_kind) ||
    !AUDIT_DETAIL_HASH_PATTERN.test(candidate.detail_hash)
  ) {
    return false;
  }
  const targetOk =
    candidate.target_kind === "session"
      ? AUDIT_SESSION_TARGET_PATTERN.test(candidate.target_id)
      : candidate.target_kind === "queue_item"
        ? AUDIT_QUEUE_TARGET_PATTERN.test(candidate.target_id)
        : candidate.target_kind === "subject"
          ? CUSTOMER_SUBJECT_PATTERN.test(candidate.target_id)
          : FLAG_ID_PATTERN.test(candidate.target_id);
  if (!targetOk) {
    return false;
  }
  return isIsoTimestamp(candidate.at) && Date.parse(candidate.at) <= QUEUE_SNAPSHOT_MS;
}

/**
 * Collection check for `GET /api/v1/operator/audit`: the top-level view
 * keys, the pinned `as_of` instant, a bounded newest-first page whose
 * entries are the verbatim recompute of the deterministic feed — so the
 * page can never disagree with the roster or reference a subject outside
 * `subjectsFor()` — and a `next_cursor` that is exactly the minted token
 * for the following boundary.
 * @param {unknown} view
 */
export function validOperatorAuditView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperatorAuditView} */ (view);
  if (
    JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...AUDIT_VIEW_KEYS].sort()) ||
    candidate.mode !== "test"
  ) {
    return false;
  }
  const audit = /** @type {unknown} */ (candidate.audit);
  if (audit === null || typeof audit !== "object" || Array.isArray(audit)) {
    return false;
  }
  const feed = /** @type {OperatorAuditView["audit"]} */ (audit);
  if (JSON.stringify(Object.keys(audit).sort()) !== JSON.stringify([...AUDIT_KEYS].sort())) {
    return false;
  }
  if (
    feed.as_of !== AUDIT_AS_OF_ISO ||
    !Array.isArray(feed.entries) ||
    feed.entries.length < 1 ||
    feed.entries.length > OPERATOR_AUDIT_PAGE_SIZE ||
    !(feed.next_cursor === null || AUDIT_CURSOR_PATTERN.test(feed.next_cursor))
  ) {
    return false;
  }
  const ids = new Set();
  let previousMs = Number.POSITIVE_INFINITY;
  let previousId = "";
  for (const entry of feed.entries) {
    if (!validOperatorAuditEntry(entry) || ids.has(entry.audit_id)) {
      return false;
    }
    ids.add(entry.audit_id);
    const atMs = Date.parse(entry.at);
    if (atMs > previousMs || (atMs === previousMs && entry.audit_id.localeCompare(previousId) >= 0)) {
      return false;
    }
    previousMs = atMs;
    previousId = entry.audit_id;
  }
  // The page is a pure function of the shared roster: it must equal one
  // page-sized slice of the deterministic feed verbatim — membership,
  // order and every derived field — and next_cursor must equal the minted
  // token for the next boundary, or null when the feed is exhausted.
  // Anything else is a fabricated read and fails closed.
  const expected = expectedAuditEntries();
  for (let offset = 0; offset < expected.length; offset += OPERATOR_AUDIT_PAGE_SIZE) {
    const slice = expected.slice(offset, offset + OPERATOR_AUDIT_PAGE_SIZE);
    if (JSON.stringify(slice) !== JSON.stringify(feed.entries)) {
      continue;
    }
    const expectedCursor =
      offset + slice.length < expected.length ? auditCursorToken(offset + slice.length) : null;
    return feed.next_cursor === expectedCursor;
  }
  return false;
}
