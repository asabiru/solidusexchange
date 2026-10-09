import { createHash } from "node:crypto";

// Deterministic synthetic profile source. A future profile adapter replaces
// it behind `viewFor(subject) -> Promise<ProfileView>`; payloads are frozen
// and derived from the subject only, so reads stay reproducible. The view is
// synthetic identity data only — a display name, locale and registration
// timestamp, never real PII. No I/O.

export const PROFILE_LOCALES = Object.freeze(["en", "ky", "ru"]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-profile-v1";
const VIEW_KEYS = Object.freeze([
  "customer_ref",
  "display_name",
  "locale",
  "mode",
  "registered_at"
]);
const VIEW_TYPES = /** @type {Readonly<Record<string, string>>} */ (
  Object.freeze({
    customer_ref: "string",
    display_name: "string",
    locale: "string",
    mode: "string",
    registered_at: "string"
  })
);
// The ProfileView field formats from packages/api-contracts/openapi.yaml: the
// runtime guard rejects a directory view that would violate the declared body.
const CUSTOMER_REF_PATTERN = /^SC-DEV-[0-9A-Z]{5}$/u;
const DISPLAY_NAME_PATTERN = /^Customer [0-9a-f]{8}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const REGISTERED_WINDOW_MS = 90 * 86_400_000;

/**
 * @typedef {object} ProfileView
 * @property {string} mode
 * @property {string} customer_ref
 * @property {string} display_name
 * @property {string} locale
 * @property {string} registered_at
 */

/**
 * @typedef {object} ProfileDirectory
 * @property {(subject: string) => Promise<ProfileView>} viewFor
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
 * @param {string} salt
 * @param {readonly string[]} values
 */
function pick(subject, salt, values) {
  return values[Number(units(subject, salt, BigInt(values.length)))];
}

/**
 * @param {string} subject
 * @returns {ProfileView}
 */
function buildProfileView(subject) {
  const registeredMs = BASE_MS - Number(units(subject, "registered", BigInt(REGISTERED_WINDOW_MS)));
  return Object.freeze({
    mode: "test",
    customer_ref: `SC-DEV-${digest(subject, "ref").toString("hex").slice(0, 5).toUpperCase()}`,
    display_name: `Customer ${digest(subject, "name").toString("hex").slice(0, 8)}`,
    locale: pick(subject, "locale", PROFILE_LOCALES),
    registered_at: new Date(registeredMs).toISOString()
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

/** @param {unknown} view */
export function validProfileView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {ProfileView} */ (view);
  const keys = Object.keys(view);
  if (
    keys.length !== VIEW_KEYS.length ||
    keys.some((key) => !VIEW_KEYS.includes(key)) ||
    !Object.entries(view).every(([key, value]) => typeof value === VIEW_TYPES[key])
  ) {
    return false;
  }
  return (
    candidate.mode === "test" &&
    CUSTOMER_REF_PATTERN.test(candidate.customer_ref) &&
    DISPLAY_NAME_PATTERN.test(candidate.display_name) &&
    PROFILE_LOCALES.includes(candidate.locale) &&
    isIsoTimestamp(candidate.registered_at)
  );
}

/** @returns {ProfileDirectory} */
export function createSyntheticProfileDirectory() {
  const cache = new Map();
  return Object.freeze({
    async viewFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildProfileView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
