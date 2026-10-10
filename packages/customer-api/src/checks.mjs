import { createHash } from "node:crypto";

// Deterministic synthetic check source. A future checks adapter replaces it
// behind `viewFor(subject) -> Promise<ChecksView>`; payloads are frozen and
// derived from the subject only, so reads stay reproducible. Every record is
// a test-mode Telegram in-chat check the subject issued (sent) or received
// (recipient side) — the planned D-019 surface, dev-only while that decision
// stays Open. The view can never carry a claim secret: claim codes, claim
// URLs and bearer tokens never leave the issuing flow, so the only check
// identifier here is the opaque chk_* reference. outstanding_amount mirrors
// the simulator's pinned rule (the check amount while the check is open,
// zero otherwise) and posting stays "none" — nothing here reserves, posts or
// moves funds. No I/O.

// The status set is the check lifecycle from the posting draft and the
// simulator: a sender's draft awaits confirmation (awaiting_confirmation),
// the issued check waits for the recipient (created) or for the recipient's
// KYC (awaiting_recipient_kyc), then resolves as claimed, cancelled or
// expired. A received check can never sit in awaiting_confirmation — the
// pre-issuance draft is sender-visible only.
export const CHECK_STATUSES = Object.freeze([
  "awaiting_confirmation",
  "created",
  "awaiting_recipient_kyc",
  "claimed",
  "cancelled",
  "expired"
]);
// The open set mirrors the simulator's pinned rule: outstanding_amount
// equals the check amount only while the check is open.
const OPEN_CHECK_STATUSES = Object.freeze(["created", "awaiting_recipient_kyc"]);
const SENT_CHECK_STATUSES = CHECK_STATUSES;
const RECEIVED_CHECK_STATUSES = Object.freeze([
  "created",
  "awaiting_recipient_kyc",
  "claimed",
  "cancelled",
  "expired"
]);
// Check assets and scales mirror the check domain (USDT scale 6, TON scale
// 9) like the provider-simulators check book and the miniapp asset table.
export const CHECK_ASSETS = Object.freeze({ USDT: 6, TON: 9 });
const CHECK_ASSET_CODES = Object.freeze(Object.keys(CHECK_ASSETS));
const CHECK_FEE_BPS = 30n;
const BPS_UNIT = 10_000n;

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-checks-v1";
const VIEW_KEYS = Object.freeze(["mode", "checks"]);
const CHECK_KEYS = Object.freeze([
  "check_id",
  "check_type",
  "status",
  "sender_ref",
  "recipient_ref",
  "amount",
  "asset",
  "fee_amount",
  "outstanding_amount",
  "created_at",
  "expires_at",
  "resolved_at",
  "posting"
]);
const CHECK_ID_PATTERN = /^chk_[0-9a-f]{24}$/u;
const CHECK_REF_PATTERN = /^syn_cust_[a-z0-9]{4,64}$/u;
const CHECK_PEER_PATTERN = /^syn_peer_[0-9a-f]{12}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");
const STEP_MS = 3_600_000;
const CHECK_TTL_MS = 72 * 3_600_000;

/**
 * @typedef {object} CheckView
 * @property {string} check_id
 * @property {string} check_type
 * @property {string} status
 * @property {string} sender_ref
 * @property {string} recipient_ref
 * @property {string} amount
 * @property {string} asset
 * @property {string} fee_amount
 * @property {string} outstanding_amount
 * @property {string} created_at
 * @property {string} expires_at
 * @property {string | null} resolved_at
 * @property {string} posting
 */

/**
 * @typedef {object} ChecksView
 * @property {string} mode
 * @property {readonly CheckView[]} checks
 */

/**
 * @typedef {object} CheckDirectory
 * @property {(subject: string) => Promise<ChecksView>} viewFor
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
 * @param {bigint} value
 * @param {number} scale
 */
function decimal(value, scale) {
  const text = String(value).padStart(scale + 1, "0");
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

/**
 * @param {string} text
 */
function parseUnits(text) {
  return BigInt(text.replace(".", ""));
}

/**
 * @param {string} subject
 * @param {number} index
 * @returns {CheckView}
 */
function buildCheck(subject, index) {
  // sent means the subject issued the check, received means the subject is
  // the recipient: the subject sits in exactly one of sender_ref /
  // recipient_ref and the counterparty is an opaque synthetic peer ref.
  const sent = units(subject, `direction:${index}`, 2n) === 0n;
  const pool = sent ? SENT_CHECK_STATUSES : RECEIVED_CHECK_STATUSES;
  const status = pool[Number(units(subject, `status:${index}`, BigInt(pool.length)))];
  const asset = CHECK_ASSET_CODES[Number(units(subject, `asset:${index}`, BigInt(CHECK_ASSET_CODES.length)))];
  const scale = CHECK_ASSETS[asset];
  const amountUnits = 1_000_000n + units(subject, `amount:${index}`, 99_000_001n);
  const feeUnits = (amountUnits * CHECK_FEE_BPS + BPS_UNIT - 1n) / BPS_UNIT;
  const peer = `syn_peer_${digest(subject, `peer:${index}`).toString("hex").slice(0, 12)}`;
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  const expiresMs = createdMs + CHECK_TTL_MS;
  // The simulator's pinned lifecycle: unresolved statuses carry no
  // resolved_at, expired resolves exactly at expiry, and every other
  // terminal status resolves strictly inside the check's validity window.
  let resolvedMs = null;
  if (status === "expired") {
    resolvedMs = expiresMs;
  } else if (status === "claimed" || status === "cancelled") {
    resolvedMs = createdMs + (1 + Number(units(subject, `resolved:${index}`, 70n))) * 3_600_000;
  }
  const open = OPEN_CHECK_STATUSES.includes(status);
  return Object.freeze({
    check_id: `chk_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    check_type: "personal",
    status,
    sender_ref: sent ? subject : peer,
    recipient_ref: sent ? peer : subject,
    amount: decimal(amountUnits, scale),
    asset,
    fee_amount: decimal(feeUnits, scale),
    outstanding_amount: open ? decimal(amountUnits, scale) : decimal(0n, scale),
    created_at: new Date(createdMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
    resolved_at: resolvedMs === null ? null : new Date(resolvedMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {ChecksView}
 */
function buildChecksView(subject) {
  const count = 1 + Number(units(subject, "count", 5n));
  const checks = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildCheck(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", checks });
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

/** @param {unknown} check */
function validCheck(check) {
  if (check === null || typeof check !== "object" || Array.isArray(check)) {
    return false;
  }
  const candidate = /** @type {CheckView} */ (check);
  if (JSON.stringify(Object.keys(check).sort()) !== JSON.stringify([...CHECK_KEYS].sort())) {
    return false;
  }
  if (
    !CHECK_ID_PATTERN.test(candidate.check_id) ||
    candidate.check_type !== "personal" ||
    !CHECK_STATUSES.includes(candidate.status) ||
    (!CHECK_REF_PATTERN.test(candidate.sender_ref) && !CHECK_PEER_PATTERN.test(candidate.sender_ref)) ||
    (!CHECK_REF_PATTERN.test(candidate.recipient_ref) && !CHECK_PEER_PATTERN.test(candidate.recipient_ref)) ||
    candidate.sender_ref === candidate.recipient_ref ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  const scale = CHECK_ASSETS[candidate.asset];
  if (scale === undefined) {
    return false;
  }
  if (
    !isScaledDecimal(candidate.amount, scale) ||
    parseUnits(candidate.amount) <= 0n ||
    !isScaledDecimal(candidate.fee_amount, scale) ||
    !isScaledDecimal(candidate.outstanding_amount, scale)
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.created_at) || !isIsoTimestamp(candidate.expires_at)) {
    return false;
  }
  if (candidate.resolved_at !== null && !isIsoTimestamp(candidate.resolved_at)) {
    return false;
  }
  const created = Date.parse(candidate.created_at);
  const expires = Date.parse(candidate.expires_at);
  // Lifecycle coherence mirrors the synthetic build and the simulator's
  // pinned rule: a check cannot expire before issuance; while the check is
  // open (created / awaiting_recipient_kyc) outstanding_amount equals the
  // amount and it is unresolved; every other status is unresolved only in
  // the pre-issuance draft and otherwise carries a resolution inside the
  // validity window, with expired resolving exactly at expiry.
  if (expires <= created) {
    return false;
  }
  if (OPEN_CHECK_STATUSES.includes(candidate.status)) {
    return (
      candidate.outstanding_amount === candidate.amount &&
      candidate.resolved_at === null
    );
  }
  const zero = decimal(0n, scale);
  if (candidate.status === "awaiting_confirmation") {
    return candidate.outstanding_amount === zero && candidate.resolved_at === null;
  }
  if (candidate.resolved_at === null || candidate.outstanding_amount !== zero) {
    return false;
  }
  const resolved = Date.parse(candidate.resolved_at);
  if (candidate.status === "expired") {
    return resolved === expires;
  }
  return resolved > created && resolved < expires;
}

/** @param {unknown} view */
export function validChecksView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {ChecksView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.checks)) {
    return false;
  }
  return candidate.checks.every(validCheck);
}

/** @returns {CheckDirectory} */
export function createSyntheticCheckDirectory() {
  const cache = new Map();
  return Object.freeze({
    async viewFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildChecksView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
