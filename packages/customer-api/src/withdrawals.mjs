import { createHash } from "node:crypto";

// Deterministic synthetic withdrawal source. A future withdrawals adapter
// replaces it behind `listFor(subject) -> Promise<WithdrawalsView>`; payloads
// are frozen and derived from the subject only, so reads stay reproducible.
// Every record is a test-mode withdrawal-intent observation mirroring the
// custody lifecycle — posting stays "none" and nothing here is a ledger entry
// or moves money. No I/O.

// The status set mirrors the custody withdrawal-intent lifecycle: the intent
// is drafted, screened, then moves through the maker-checker approval steps
// before the custody orchestrator seals the unsigned intent (the verbatim
// custody-core status), after which it can be broadcast and confirmed on the
// testnet, or terminate early as rejected, cancelled or expired.
export const WITHDRAWAL_STATUSES = Object.freeze([
  "draft",
  "screened",
  "pending_maker_approval",
  "pending_checker_approval",
  "unsigned_intent_ready",
  "broadcast",
  "confirmed",
  "rejected",
  "cancelled",
  "expired"
]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-withdrawals-v1";
const VIEW_KEYS = Object.freeze(["withdrawals", "mode"]);
const WITHDRAWAL_KEYS = Object.freeze([
  "withdrawal_id",
  "asset",
  "network",
  "status",
  "amount",
  "fee_amount",
  "destination_reference",
  "legs",
  "created_at",
  "updated_at",
  "expires_at",
  "posting"
]);
const LEG_KEYS = Object.freeze(["leg_id", "asset", "amount", "direction"]);
const WITHDRAWAL_ID_PATTERN = /^wdr_[0-9a-f]{24}$/u;
const LEG_ID_PATTERN = /^wdl_[0-9a-f]{24}$/u;
const ASSET_PATTERN = /^[A-Z0-9]{2,16}$/u;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const DESTINATION_REFERENCE_PATTERN = /^destination_ref_[a-z0-9_]{2,32}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
// Asset/network pairs and decimal scales mirror the custody-dev-v1 testnet
// allowlist in packages/custody-core/custody-policy.json exactly.
const ALLOWED_PAIRS = Object.freeze([
  Object.freeze({ asset: "TON", network: "TON_TESTNET", scale: 9 }),
  Object.freeze({ asset: "USDT", network: "TON_TESTNET", scale: 6 }),
  Object.freeze({ asset: "USDT", network: "TRON_TESTNET", scale: 6 })
]);
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;
// maximum_intent_ttl_seconds from the same custody policy.
const INTENT_TTL_MS = 300_000;

/**
 * @typedef {object} WithdrawalLegView
 * @property {string} leg_id
 * @property {string} asset
 * @property {string} amount
 * @property {string} direction
 */

/**
 * @typedef {object} WithdrawalView
 * @property {string} withdrawal_id
 * @property {string} asset
 * @property {string} network
 * @property {string} status
 * @property {string} amount
 * @property {string} fee_amount
 * @property {string} destination_reference
 * @property {readonly WithdrawalLegView[]} legs
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string} expires_at
 * @property {string} posting
 */

/**
 * @typedef {object} WithdrawalsView
 * @property {string} mode
 * @property {readonly WithdrawalView[]} withdrawals
 */

/**
 * @typedef {object} WithdrawalDirectory
 * @property {(subject: string) => Promise<WithdrawalsView>} listFor
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
 * @returns {WithdrawalView}
 */
function buildWithdrawal(subject, index) {
  const status = WITHDRAWAL_STATUSES[Number(units(subject, `status:${index}`, BigInt(WITHDRAWAL_STATUSES.length)))];
  const pair = ALLOWED_PAIRS[Number(units(subject, `pair:${index}`, BigInt(ALLOWED_PAIRS.length)))];
  const amountMinor = 1_000_000n + units(subject, `amount:${index}`, 49_000_000n);
  const feeMinor = (amountMinor * (25n + units(subject, `fee:${index}`, 476n))) / 10_000n;
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  const expiresMs = createdMs + INTENT_TTL_MS;
  const updatedMs =
    status === "draft"
      ? createdMs
      : status === "expired"
        ? expiresMs
        : status === "confirmed"
          ? expiresMs + (10 + Number(units(subject, `updated:${index}`, 111n))) * 1_000
          : createdMs + (10 + Number(units(subject, `updated:${index}`, 281n))) * 1_000;
  const legs = Object.freeze([
    Object.freeze({
      leg_id: `wdl_${digest(subject, `leg:${index}:0`).toString("hex").slice(0, 24)}`,
      asset: pair.asset,
      amount: decimal(amountMinor, pair.scale),
      direction: "out"
    }),
    Object.freeze({
      leg_id: `wdl_${digest(subject, `leg:${index}:1`).toString("hex").slice(0, 24)}`,
      asset: pair.asset,
      amount: decimal(feeMinor, pair.scale),
      direction: "out"
    })
  ]);
  return Object.freeze({
    withdrawal_id: `wdr_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    asset: pair.asset,
    network: pair.network,
    status,
    amount: decimal(amountMinor, pair.scale),
    fee_amount: decimal(feeMinor, pair.scale),
    destination_reference: `destination_ref_${digest(subject, `dest:${index}`).toString("hex").slice(0, 16)}`,
    legs,
    created_at: new Date(createdMs).toISOString(),
    updated_at: new Date(updatedMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {WithdrawalsView}
 */
function buildWithdrawalsView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const withdrawals = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildWithdrawal(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", withdrawals });
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
 * @param {string} asset
 * @param {string} network
 */
function allowedPair(asset, network) {
  return ALLOWED_PAIRS.some(
    (candidate) => candidate.asset === asset && candidate.network === network
  );
}

/** @param {unknown} leg */
function validLeg(leg) {
  if (leg === null || typeof leg !== "object" || Array.isArray(leg)) {
    return false;
  }
  const candidate = /** @type {WithdrawalLegView} */ (leg);
  return (
    JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify([...LEG_KEYS].sort()) &&
    Object.values(candidate).every((value) => typeof value === "string") &&
    LEG_ID_PATTERN.test(candidate.leg_id) &&
    ASSET_PATTERN.test(candidate.asset) &&
    DECIMAL_PATTERN.test(candidate.amount) &&
    candidate.direction === "out"
  );
}

/**
 * @param {unknown} legs
 * @param {string} asset
 * @param {string} amount
 * @param {string} feeAmount
 */
function validLegs(legs, asset, amount, feeAmount) {
  return (
    Array.isArray(legs) &&
    legs.length === 2 &&
    legs.every(
      (leg, index) =>
        validLeg(leg) &&
        leg.asset === asset &&
        leg.amount === (index === 0 ? amount : feeAmount)
    )
  );
}

/** @param {unknown} view */
export function validWithdrawalsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {WithdrawalsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.withdrawals)) {
    return false;
  }
  return candidate.withdrawals.every(
    (withdrawal) =>
      withdrawal !== null &&
      typeof withdrawal === "object" &&
      !Array.isArray(withdrawal) &&
      JSON.stringify(Object.keys(withdrawal).sort()) === JSON.stringify([...WITHDRAWAL_KEYS].sort()) &&
      WITHDRAWAL_ID_PATTERN.test(withdrawal.withdrawal_id) &&
      allowedPair(withdrawal.asset, withdrawal.network) &&
      WITHDRAWAL_STATUSES.includes(withdrawal.status) &&
      DECIMAL_PATTERN.test(withdrawal.amount) &&
      DECIMAL_PATTERN.test(withdrawal.fee_amount) &&
      DESTINATION_REFERENCE_PATTERN.test(withdrawal.destination_reference) &&
      validLegs(withdrawal.legs, withdrawal.asset, withdrawal.amount, withdrawal.fee_amount) &&
      isIsoTimestamp(withdrawal.created_at) &&
      isIsoTimestamp(withdrawal.updated_at) &&
      isIsoTimestamp(withdrawal.expires_at) &&
      withdrawal.posting === "none"
  );
}

/** @returns {WithdrawalDirectory} */
export function createSyntheticWithdrawalDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildWithdrawalsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
