import { createHash } from "node:crypto";

// Deterministic synthetic user account source. A future accounts adapter
// replaces it behind `viewFor(subject) -> Promise<UserView>`; payloads are
// frozen and derived from the subject only, so reads stay reproducible. The
// view is the subject's own user account record — the identity surface the
// miniapp's /bff/session view already exposes to every authenticated session
// (kyc-gated included). It carries account state only: an opaque usr_*
// handle, the owning auth subject, the account lifecycle state, account
// flags and ISO created/updated timestamps — never credentials, secrets or
// PII, so nothing here can authenticate or authorize anything. No I/O.

// The status set is the account lifecycle: registered but not yet active
// (pending), in good standing (active), temporarily restricted (suspended)
// or ended (closed). No status implying a money or command effect exists.
export const USER_STATUSES = Object.freeze(["pending", "active", "suspended", "closed"]);
// Account flags are the boolean preference/attestation bits a customer can
// hold on their own record: terms attestation, second-factor enrollment and
// marketing communication opt-in. None carry a money or command effect.
export const USER_FLAG_KEYS = Object.freeze(["terms_accepted", "two_factor_enabled", "marketing_opt_in"]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-users-v1";
const VIEW_KEYS = Object.freeze([
  "mode",
  "user_id",
  "subject",
  "status",
  "flags",
  "created_at",
  "updated_at"
]);
const USER_ID_PATTERN = /^usr_[0-9a-f]{24}$/u;
const SUBJECT_PATTERN = /^syn_cust_[a-z0-9]{8,32}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const CREATED_WINDOW_MS = 90 * 86_400_000;
const UPDATED_WINDOW_MS = 30 * 86_400_000;

/**
 * @typedef {object} UserFlags
 * @property {boolean} terms_accepted
 * @property {boolean} two_factor_enabled
 * @property {boolean} marketing_opt_in
 */

/**
 * @typedef {object} UserView
 * @property {string} mode
 * @property {string} user_id
 * @property {string} subject
 * @property {string} status
 * @property {UserFlags} flags
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {object} UserDirectory
 * @property {(subject: string) => Promise<UserView>} viewFor
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
 * @returns {UserView}
 */
function buildUserView(subject) {
  const status = USER_STATUSES[Number(units(subject, "status", BigInt(USER_STATUSES.length)))];
  const createdMs = BASE_MS + Number(units(subject, "created", BigInt(CREATED_WINDOW_MS)));
  // Lifecycle coherence mirrors a real account record: a pending account was
  // registered but never modified, while reaching any other lifecycle state
  // is itself a later update.
  const updatedMs =
    status === "pending" ? createdMs : createdMs + 1 + Number(units(subject, "updated", BigInt(UPDATED_WINDOW_MS)));
  return Object.freeze({
    mode: "test",
    user_id: `usr_${digest(subject, "id").toString("hex").slice(0, 24)}`,
    subject,
    status,
    flags: Object.freeze({
      terms_accepted: units(subject, "flag:terms_accepted", 2n) === 1n,
      two_factor_enabled: units(subject, "flag:two_factor_enabled", 2n) === 1n,
      marketing_opt_in: units(subject, "flag:marketing_opt_in", 2n) === 1n
    }),
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

/** @param {unknown} flags */
function validUserFlags(flags) {
  if (flags === null || typeof flags !== "object" || Array.isArray(flags)) {
    return false;
  }
  const candidate = /** @type {Record<string, unknown>} */ (flags);
  return (
    JSON.stringify(Object.keys(flags).sort()) === JSON.stringify([...USER_FLAG_KEYS].sort()) &&
    USER_FLAG_KEYS.every((key) => typeof candidate[key] === "boolean")
  );
}

/** @param {unknown} view */
export function validUserView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {UserView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (
    candidate.mode !== "test" ||
    !USER_ID_PATTERN.test(candidate.user_id) ||
    !SUBJECT_PATTERN.test(candidate.subject) ||
    !USER_STATUSES.includes(candidate.status) ||
    !validUserFlags(candidate.flags)
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.created_at) || !isIsoTimestamp(candidate.updated_at)) {
    return false;
  }
  const created = Date.parse(candidate.created_at);
  const updated = Date.parse(candidate.updated_at);
  // Lifecycle coherence mirrors the synthetic build: an account cannot be
  // updated before it was created, a pending account was registered but
  // never modified, and reaching any other lifecycle state is itself a
  // later update.
  if (candidate.status === "pending") {
    return updated === created;
  }
  return updated > created;
}

/** @returns {UserDirectory} */
export function createSyntheticUserDirectory() {
  const cache = new Map();
  return Object.freeze({
    async viewFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildUserView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
