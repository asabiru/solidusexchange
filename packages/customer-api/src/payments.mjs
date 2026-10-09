import { createHash } from "node:crypto";

// Deterministic synthetic payment source. A future payments adapter replaces
// it behind `listFor(subject) -> Promise<PaymentsView>`; payloads are frozen
// and derived from the subject only, so reads stay reproducible. Every record
// is a test-mode outbound fiat payment the subject initiated through the RUB/
// SBP bank rail (the payments.create command's domain — the miniapp's "Pay by
// QR" surface pays from the RUB balance). Method and currency mirror the bank
// simulator's createPaymentIntent vocabulary
// (packages/provider-simulators/src/bank.mjs): method is always "sbp" and the
// only settlement asset is RUB at scale 2. provider_reference mirrors the
// simulator's bank_transaction_id convention — it exists exactly when the
// rail observed the payment and is null while the instruction never left the
// platform. An observation never grants transfer or settlement authority —
// posting stays "none" and nothing here is a ledger entry or moves money.
// No I/O.

// The status set is the outbound counterpart of the bank simulator's inbound
// observation states: the instruction is created, handed to the rail
// (processing), confirmed delivered (completed), rejected by the rail
// (failed), delivered then returned (reversed), or it terminates before ever
// reaching the rail as cancelled or expired. A settled/ledger-posting status
// would imply a money effect that posting "none" forbids.
export const PAYMENT_STATUSES = Object.freeze([
  "created",
  "processing",
  "completed",
  "failed",
  "reversed",
  "cancelled",
  "expired"
]);
// The rail observed — and therefore referenced — the payment in exactly these
// states. Created/cancelled/expired instructions never reached the bank, so
// their provider_reference stays null like the simulator's null
// bank_transaction_id on expired intents.
const RAIL_OBSERVED_STATUSES = Object.freeze(["processing", "completed", "failed", "reversed"]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-payments-v1";
const VIEW_KEYS = Object.freeze(["mode", "payments"]);
const PAYMENT_KEYS = Object.freeze([
  "payment_id",
  "asset",
  "method",
  "status",
  "amount",
  "fee_amount",
  "total_amount",
  "recipient_reference",
  "provider_reference",
  "created_at",
  "updated_at",
  "posting"
]);
const PAYMENT_ID_PATTERN = /^pay_[0-9a-f]{24}$/u;
const ASSET_PATTERN = /^[A-Z0-9]{2,16}$/u;
const RECIPIENT_REFERENCE_PATTERN = /^recipient_ref_[a-z0-9_]{2,32}$/u;
const PROVIDER_REFERENCE_PATTERN = /^SIMBANK[0-9A-F]{16}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const RUB_SCALE = 2;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;
// Mirrors the bank simulator's default intentTtlSeconds of 900 seconds.
const INTENT_TTL_MS = 900_000;

/**
 * @typedef {object} PaymentView
 * @property {string} payment_id
 * @property {string} asset
 * @property {string} method
 * @property {string} status
 * @property {string} amount
 * @property {string} fee_amount
 * @property {string} total_amount
 * @property {string} recipient_reference
 * @property {string | null} provider_reference
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} posting
 */

/**
 * @typedef {object} PaymentsView
 * @property {string} mode
 * @property {readonly PaymentView[]} payments
 */

/**
 * @typedef {object} PaymentDirectory
 * @property {(subject: string) => Promise<PaymentsView>} listFor
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
 * Non-negative integer division with an explicit rounding mode, mirroring
 * the simulator's divideRounded so the fee recompute stays customer-unfriendly.
 *
 * @param {bigint} numerator
 * @param {bigint} denominator
 * @param {"down" | "up" | "half_even"} mode
 */
function divideRounded(numerator, denominator, mode) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "down") {
    return quotient;
  }
  if (mode === "up") {
    return quotient + 1n;
  }
  const twice = remainder * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) {
    return quotient + 1n;
  }
  return quotient;
}

/** @param {string} text */
function parseUnits(text) {
  return BigInt(text.replace(".", ""));
}

/**
 * @param {string} subject
 * @param {number} index
 * @returns {PaymentView}
 */
function buildPayment(subject, index) {
  const status = PAYMENT_STATUSES[Number(units(subject, `status:${index}`, BigInt(PAYMENT_STATUSES.length)))];
  const railObserved = RAIL_OBSERVED_STATUSES.includes(status);
  const amountMinor = 100n * 100n + units(subject, `amount:${index}`, 890_001n);
  // The fee is a 15-100 bps rail charge on the principal, always rounded in
  // the provider's favour like the quote/exchange fee model.
  const feeBps = 15n + units(subject, `fee:${index}`, 86n);
  const feeMinor = divideRounded(amountMinor * feeBps, 10_000n, "up");
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  // A resting created instruction has never changed; an expired one carries
  // the intent TTL deadline and every other observation is its transition
  // timestamp (within a day of creation like the other reads).
  const updatedMs =
    status === "created"
      ? createdMs
      : status === "expired"
        ? createdMs + INTENT_TTL_MS + 1_000
        : createdMs + (10 + Number(units(subject, `updated:${index}`, 281n))) * 1_000;
  return Object.freeze({
    payment_id: `pay_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    asset: "RUB",
    method: "sbp",
    status,
    amount: decimal(amountMinor, RUB_SCALE),
    fee_amount: decimal(feeMinor, RUB_SCALE),
    total_amount: decimal(amountMinor + feeMinor, RUB_SCALE),
    recipient_reference: `recipient_ref_${digest(subject, `recipient:${index}`).toString("hex").slice(0, 8)}`,
    provider_reference: railObserved
      ? `SIMBANK${digest(subject, `provider:${index}`).toString("hex").slice(0, 16).toUpperCase()}`
      : null,
    created_at: new Date(createdMs).toISOString(),
    updated_at: new Date(updatedMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {PaymentsView}
 */
function buildPaymentsView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const payments = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildPayment(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", payments });
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

/** @param {unknown} payment */
function validPayment(payment) {
  if (payment === null || typeof payment !== "object" || Array.isArray(payment)) {
    return false;
  }
  const candidate = /** @type {PaymentView} */ (payment);
  if (JSON.stringify(Object.keys(payment).sort()) !== JSON.stringify([...PAYMENT_KEYS].sort())) {
    return false;
  }
  if (
    !PAYMENT_ID_PATTERN.test(candidate.payment_id) ||
    !ASSET_PATTERN.test(candidate.asset) ||
    // The SBP rail settles in RUB only: any other asset with method "sbp" is
    // an impossible combination in this model.
    candidate.asset !== "RUB" ||
    candidate.method !== "sbp" ||
    !PAYMENT_STATUSES.includes(candidate.status) ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  if (
    !isScaledDecimal(candidate.amount, RUB_SCALE) ||
    !isScaledDecimal(candidate.fee_amount, RUB_SCALE) ||
    !isScaledDecimal(candidate.total_amount, RUB_SCALE)
  ) {
    return false;
  }
  const amount = parseUnits(candidate.amount);
  const fee = parseUnits(candidate.fee_amount);
  const total = parseUnits(candidate.total_amount);
  // The debited total must recompute exactly as principal plus rail fee, and
  // every payment carries a positive principal and a positive fee.
  if (amount <= 0n || fee <= 0n || total !== amount + fee) {
    return false;
  }
  if (!RECIPIENT_REFERENCE_PATTERN.test(candidate.recipient_reference)) {
    return false;
  }
  // The provider-side reference exists exactly when the rail observed the
  // payment — like the simulator's null bank_transaction_id for intents the
  // bank never saw.
  if (RAIL_OBSERVED_STATUSES.includes(candidate.status)) {
    if (
      typeof candidate.provider_reference !== "string" ||
      !PROVIDER_REFERENCE_PATTERN.test(candidate.provider_reference)
    ) {
      return false;
    }
  } else if (candidate.provider_reference !== null) {
    return false;
  }
  if (!isIsoTimestamp(candidate.created_at) || !isIsoTimestamp(candidate.updated_at)) {
    return false;
  }
  const created = Date.parse(candidate.created_at);
  const updated = Date.parse(candidate.updated_at);
  // Lifecycle coherence mirrors the synthetic build: a resting created
  // instruction has never changed and every later observation updates at or
  // after creation.
  return updated >= created && (candidate.status === "created" ? updated === created : true);
}

/** @param {unknown} view */
export function validPaymentsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {PaymentsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.payments)) {
    return false;
  }
  return candidate.payments.every(validPayment);
}

/** @returns {PaymentDirectory} */
export function createSyntheticPaymentDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildPaymentsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
