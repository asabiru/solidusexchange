import { createHash } from "node:crypto";
import { OPERATOR_CAPABILITY_POLICY } from "./capabilities.mjs";

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
  return validScopes(candidate.capabilities) && candidate.commands_enabled === false;
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
