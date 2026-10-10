import { createHash } from "node:crypto";

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
const GRANTED_CAPABILITY_MAX_LENGTH = 128;
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
    granted.every(
      (item) => typeof item === "string" && item.length >= 1 && item.length <= GRANTED_CAPABILITY_MAX_LENGTH
    )
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

/** @returns {OperatorDirectory} */
export function createSyntheticOperatorDirectory() {
  const cache = new Map();
  return Object.freeze({
    async viewFor(subject, grantedCapabilities) {
      const key = `${subject}${grantedCapabilities.map((item) => `\n${item}`).join("")}`;
      let view = cache.get(key);
      if (view === undefined) {
        view = buildOperatorAdminView(subject, grantedCapabilities);
        cache.set(key, view);
      }
      return view;
    }
  });
}
