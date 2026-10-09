import { createHash } from "node:crypto";

import { KYC_STATUSES } from "./capabilities.mjs";

// Deterministic synthetic KYC application source. A future KYC onboarding
// adapter replaces it behind `viewFor(subject, sessionKyc) ->
// Promise<KycStatusView>`; payloads are frozen and derived from
// (subject, sessionKyc) only, so reads stay reproducible and the served
// application state can never contradict the session-level KYC status the
// capability gate already evaluated. Everything is test-mode simulator output:
// it is evidence for the dev onboarding surface only, never a real
// verification decision. No I/O.

// Mirrors the miniapp's KycVerificationState (miniapp/src/shared/api.ts) and
// the provider-simulator KYC statuses in packages/provider-simulators.
export const KYC_APPLICATION_STATUSES = Object.freeze([
  "not_started",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "needs_more_data",
  "timed_out",
  "unavailable"
]);
const KYC_REASON_CODES = Object.freeze(["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"]);
const KYC_REQUESTED_ITEMS = Object.freeze(["proof_of_address", "selfie_retake"]);

// States with no live application record: the subject never submitted one or
// the provider was unavailable before submission.
const NO_APPLICATION_STATUSES = Object.freeze(["not_started", "unavailable"]);
// States from which a (re)submission is possible.
const RESUBMITTABLE_STATUSES = Object.freeze([
  "not_started",
  "rejected",
  "needs_more_data",
  "timed_out",
  "unavailable"
]);
// States still inside the review window.
const IN_REVIEW_STATUSES = Object.freeze(["submitted", "in_review"]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-kyc-v1";
const VIEW_KEYS = Object.freeze([
  "application_id",
  "can_submit",
  "mode",
  "provider",
  "reason_codes",
  "requested_items",
  "review_deadline",
  "session_kyc",
  "status",
  "submitted_at",
  "updated_at"
]);
const REQUIRED_KEYS = Object.freeze([
  "can_submit",
  "mode",
  "provider",
  "session_kyc",
  "status",
  "updated_at"
]);
const VIEW_TYPES = /** @type {Readonly<Record<string, string>>} */ (
  Object.freeze({
    application_id: "string",
    can_submit: "boolean",
    mode: "string",
    provider: "string",
    reason_codes: "object",
    requested_items: "object",
    review_deadline: "string",
    session_kyc: "string",
    status: "string",
    submitted_at: "string",
    updated_at: "string"
  })
);
const APPLICATION_ID_PATTERN = /^kyc_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const SUBMIT_WINDOW_MS = 14 * 86_400_000;
const UPDATE_WINDOW_MS = 86_400_000;
const REVIEW_WINDOW_MS = 3_600_000;

/**
 * @typedef {object} KycStatusView
 * @property {string} mode
 * @property {string} provider
 * @property {string} session_kyc
 * @property {string} status
 * @property {string} [application_id]
 * @property {string} [submitted_at]
 * @property {string} updated_at
 * @property {string} [review_deadline]
 * @property {readonly string[]} [reason_codes]
 * @property {readonly string[]} [requested_items]
 * @property {boolean} can_submit
 */

/**
 * @typedef {object} KycApplicationDirectory
 * @property {(subject: string, sessionKyc: string) => Promise<KycStatusView>} viewFor
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
 * The session-level KYC status bounds which application states are coherent:
 * a verified session implies an approved application, a pending session an
 * in-flight one, and an unverified session either no application or a
 * terminal/provider-failed one.
 *
 * @param {string} subject
 * @param {string} sessionKyc
 * @returns {string}
 */
function deriveApplicationStatus(subject, sessionKyc) {
  if (sessionKyc === "verified") {
    return "approved";
  }
  if (sessionKyc === "pending") {
    return pick(subject, "pending", ["submitted", "in_review"]);
  }
  return pick(subject, "unverified", [
    "not_started",
    "rejected",
    "needs_more_data",
    "timed_out",
    "unavailable"
  ]);
}

/**
 * @param {string} subject
 * @param {string} sessionKyc
 * @returns {KycStatusView}
 */
function buildKycStatusView(subject, sessionKyc) {
  const status = deriveApplicationStatus(subject, sessionKyc);
  const hasApplication = !NO_APPLICATION_STATUSES.includes(status);
  const submittedMs = BASE_MS + Number(units(subject, "submitted", BigInt(SUBMIT_WINDOW_MS)));
  const updatedMs = hasApplication
    ? submittedMs + Number(units(subject, "updated", BigInt(UPDATE_WINDOW_MS)))
    : BASE_MS + Number(units(subject, "recorded", BigInt(SUBMIT_WINDOW_MS)));
  /** @type {Record<string, unknown>} */
  const view = {
    mode: "test",
    provider: "simulator",
    session_kyc: sessionKyc,
    status,
    updated_at: new Date(updatedMs).toISOString(),
    can_submit: RESUBMITTABLE_STATUSES.includes(status)
  };
  if (hasApplication) {
    view.application_id = `kyc_${digest(subject, "application").toString("hex").slice(0, 24)}`;
    view.submitted_at = new Date(submittedMs).toISOString();
  }
  if (IN_REVIEW_STATUSES.includes(status)) {
    view.review_deadline = new Date(submittedMs + REVIEW_WINDOW_MS).toISOString();
  }
  if (status === "rejected") {
    const count = 1 + Number(units(subject, "reasons", 2n));
    view.reason_codes = Object.freeze(KYC_REASON_CODES.slice(0, count));
  }
  if (status === "needs_more_data") {
    const count = 1 + Number(units(subject, "items", 2n));
    view.requested_items = Object.freeze(KYC_REQUESTED_ITEMS.slice(0, count));
  }
  for (const key of Object.keys(view)) {
    const value = view[key];
    if (Array.isArray(value)) {
      view[key] = Object.freeze(value);
    }
  }
  return /** @type {KycStatusView} */ (Object.freeze(view));
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/**
 * @param {unknown} value
 * @param {readonly string[]} allowed
 */
function isCodeList(value, allowed) {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= allowed.length &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && allowed.includes(item))
  );
}

/** @param {unknown} view */
export function validKycStatusView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {KycStatusView} */ (view);
  const keys = Object.keys(view);
  if (
    keys.some((key) => !VIEW_KEYS.includes(key)) ||
    REQUIRED_KEYS.some((key) => !keys.includes(key)) ||
    !Object.entries(view).every(([key, value]) => typeof value === VIEW_TYPES[key])
  ) {
    return false;
  }
  if (
    candidate.mode !== "test" ||
    candidate.provider !== "simulator" ||
    !KYC_STATUSES.includes(candidate.session_kyc) ||
    !KYC_APPLICATION_STATUSES.includes(candidate.status) ||
    typeof candidate.can_submit !== "boolean" ||
    !isIsoTimestamp(candidate.updated_at)
  ) {
    return false;
  }
  const applicationFields = [
    "application_id",
    "submitted_at",
    "review_deadline",
    "reason_codes",
    "requested_items"
  ];
  const hasApplicationField = applicationFields.some((field) => Object.hasOwn(view, field));
  if (
    hasApplicationField &&
    !(
      APPLICATION_ID_PATTERN.test(candidate.application_id ?? "") &&
      isIsoTimestamp(candidate.submitted_at)
    )
  ) {
    return false;
  }
  if (Object.hasOwn(view, "review_deadline") && !isIsoTimestamp(candidate.review_deadline)) {
    return false;
  }
  if (Object.hasOwn(view, "reason_codes") && !isCodeList(candidate.reason_codes, KYC_REASON_CODES)) {
    return false;
  }
  if (Object.hasOwn(view, "requested_items") && !isCodeList(candidate.requested_items, KYC_REQUESTED_ITEMS)) {
    return false;
  }
  return true;
}

/** @returns {KycApplicationDirectory} */
export function createSyntheticKycApplicationDirectory() {
  const cache = new Map();
  return Object.freeze({
    async viewFor(subject, sessionKyc) {
      if (!KYC_STATUSES.includes(sessionKyc)) {
        throw new Error("Unknown session KYC status");
      }
      const key = `${subject}${sessionKyc}`;
      let view = cache.get(key);
      if (view === undefined) {
        view = buildKycStatusView(subject, sessionKyc);
        cache.set(key, view);
      }
      return view;
    }
  });
}
