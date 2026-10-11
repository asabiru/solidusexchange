import { createHash } from "node:crypto";
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

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
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
  "kyc_status",
  "last_active_at",
  "limits",
  "posting",
  "registered_at",
  "sessions",
  "subject_id"
]);
const SUBJECT_LIMIT_KEYS = Object.freeze(["max_devices", "max_sessions"]);
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
 * @typedef {object} OperatorSubjectsDirectory
 * @property {() => Promise<OperatorSubjectsView>} subjectsFor
 * @property {(subjectId: string) => Promise<OperatorSubjectDetailView | null>} subjectFor
 * @property {(kind?: string) => Promise<OperatorQueueView>} queueFor
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
  const registeredMs = BASE_MS + Number(subjectsUnits(seed, "registered", BigInt(REGISTERED_WINDOW_MS)));
  const lastActiveMs = registeredMs + Number(subjectsUnits(seed, "active", BigInt(ACTIVE_WINDOW_MS)));
  return Object.freeze({
    subject_id: `syn_cust_${subjectsDigest(seed, "id").toString("hex").slice(0, 24)}`,
    display_name: [
      SUBJECT_FIRST_NAMES[Number(subjectsUnits(seed, "first", BigInt(SUBJECT_FIRST_NAMES.length)))],
      SUBJECT_LAST_NAMES[Number(subjectsUnits(seed, "last", BigInt(SUBJECT_LAST_NAMES.length)))]
    ].join(" "),
    kyc_status: KYC_STATUSES[Number(subjectsUnits(seed, "kyc", BigInt(KYC_STATUSES.length)))],
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
  const maxSessions = Number(subjectsUnits(subjectId, "max-sessions", BigInt(SUBJECT_MAX_SESSIONS_BOUND))) + 1;
  const sessions = Number(subjectsUnits(subjectId, "sessions", BigInt(maxSessions + 1)));
  const maxDevices = Number(subjectsUnits(subjectId, "max-devices", BigInt(SUBJECT_MAX_DEVICES_BOUND))) + 1;
  const deviceCount = Number(subjectsUnits(subjectId, "devices", BigInt(maxDevices + 1)));
  const devices = [];
  for (let index = 0; index < deviceCount; index += 1) {
    devices.push(`${SUBJECT_DEVICE_DIGEST_PREFIX}${subjectsDigest(subjectId, `device-${index}`).toString("hex").slice(0, 16)}`);
  }
  return {
    account_status: SUBJECT_ACCOUNT_STATUSES[
      Number(subjectsUnits(subjectId, "account", BigInt(SUBJECT_ACCOUNT_STATUSES.length)))
    ],
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
    limits: derived.limits
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
    JSON.stringify(subject.limits) === JSON.stringify(derived.limits)
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
const AML_ALERT_TYPES = Object.freeze(["structuring", "velocity", "geo_mismatch"]);
const QUEUE_MAX_ITEMS = 64;
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
