import { createHash } from "node:crypto";

// Deterministic synthetic deposit source. A future deposits adapter replaces
// it behind `listFor(subject) -> Promise<DepositsView>`; payloads are frozen
// and derived from the subject only, so reads stay reproducible. Every record
// is a test-mode RUB/SBP observation mirroring the bank simulator's payment
// states — posting stays "none" and nothing here is a ledger entry or moves
// money. No I/O.

// The status set mirrors PaymentStatusName in
// packages/provider-simulators/src/bank.mjs exactly.
export const DEPOSIT_STATUSES = Object.freeze([
  "awaiting_payment",
  "payment_received",
  "partial_payment",
  "duplicate_payment",
  "payment_reversed",
  "expired_no_payment"
]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-deposits-v1";
const VIEW_KEYS = Object.freeze(["deposits", "mode"]);
const DEPOSIT_KEYS = Object.freeze([
  "deposit_id",
  "asset",
  "method",
  "status",
  "expected_amount",
  "received_total",
  "reversed_total",
  "payment_reference",
  "created_at",
  "updated_at",
  "posting"
]);
const DEPOSIT_ID_PATTERN = /^dep_[0-9a-f]{24}$/u;
const ASSET_PATTERN = /^[A-Z0-9]{2,16}$/u;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const PAYMENT_REFERENCE_PATTERN = /^SIMSBP[0-9A-F]{12}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const RUB_SCALE = 2;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;
const INTENT_TTL_MS = 900_000;

/**
 * @typedef {object} DepositView
 * @property {string} deposit_id
 * @property {string} asset
 * @property {string} method
 * @property {string} status
 * @property {string} expected_amount
 * @property {string} received_total
 * @property {string} reversed_total
 * @property {string} payment_reference
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} posting
 */

/**
 * @typedef {object} DepositsView
 * @property {string} mode
 * @property {readonly DepositView[]} deposits
 */

/**
 * @typedef {object} DepositDirectory
 * @property {(subject: string) => Promise<DepositsView>} listFor
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
 * @param {string} subject
 * @param {number} index
 * @returns {DepositView}
 */
function buildDeposit(subject, index) {
  const status = DEPOSIT_STATUSES[Number(units(subject, `status:${index}`, BigInt(DEPOSIT_STATUSES.length)))];
  const expectedMinor = 10_000n + units(subject, `expected:${index}`, 890_001n);
  let receivedMinor = 0n;
  let reversedMinor = 0n;
  if (status === "payment_received" || status === "payment_reversed") {
    receivedMinor = expectedMinor;
  } else if (status === "duplicate_payment") {
    receivedMinor = expectedMinor * 2n;
  } else if (status === "partial_payment") {
    receivedMinor = (expectedMinor * (10n + units(subject, `partial:${index}`, 81n))) / 100n || 1n;
  }
  if (status === "payment_reversed") {
    reversedMinor = (expectedMinor * (10n + units(subject, `reversed:${index}`, 91n))) / 100n || 1n;
  }
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  const updatedMs =
    status === "awaiting_payment"
      ? createdMs
      : status === "expired_no_payment"
        ? createdMs + INTENT_TTL_MS + 1_000
        : createdMs + (20 + Number(units(subject, `updated:${index}`, 221n))) * 1_000;
  return Object.freeze({
    deposit_id: `dep_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    asset: "RUB",
    method: "sbp",
    status,
    expected_amount: decimal(expectedMinor, RUB_SCALE),
    received_total: decimal(receivedMinor, RUB_SCALE),
    reversed_total: decimal(reversedMinor, RUB_SCALE),
    payment_reference: `SIMSBP${digest(subject, `ref:${index}`).toString("hex").slice(0, 12).toUpperCase()}`,
    created_at: new Date(createdMs).toISOString(),
    updated_at: new Date(updatedMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {DepositsView}
 */
function buildDepositsView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const deposits = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildDeposit(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", deposits });
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
export function validDepositsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {DepositsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.deposits)) {
    return false;
  }
  return candidate.deposits.every(
    (deposit) =>
      deposit !== null &&
      typeof deposit === "object" &&
      !Array.isArray(deposit) &&
      JSON.stringify(Object.keys(deposit).sort()) === JSON.stringify([...DEPOSIT_KEYS].sort()) &&
      Object.values(deposit).every((value) => typeof value === "string") &&
      DEPOSIT_ID_PATTERN.test(deposit.deposit_id) &&
      ASSET_PATTERN.test(deposit.asset) &&
      deposit.method === "sbp" &&
      DEPOSIT_STATUSES.includes(deposit.status) &&
      DECIMAL_PATTERN.test(deposit.expected_amount) &&
      DECIMAL_PATTERN.test(deposit.received_total) &&
      DECIMAL_PATTERN.test(deposit.reversed_total) &&
      PAYMENT_REFERENCE_PATTERN.test(deposit.payment_reference) &&
      isIsoTimestamp(deposit.created_at) &&
      isIsoTimestamp(deposit.updated_at) &&
      deposit.posting === "none"
  );
}

/** @returns {DepositDirectory} */
export function createSyntheticDepositDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildDepositsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
