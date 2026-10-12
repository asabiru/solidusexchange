import { createHash } from "node:crypto";

// Deterministic synthetic address-screening source. A future KYT adapter
// replaces it behind `listFor(subject)` / `viewFor(subject, id)`; payloads are
// frozen and derived from the subject only, so reads stay reproducible.
// Every record is a test-mode advisory outbound screening against the
// custody-dev-v1 asset/network allowlist — verdict vocabulary mirrors the
// local miniapp surface (status carries the risk badge, risk_level stays
// advisory) and posting stays "none": nothing here is a ledger entry, a
// compliance decision, or money movement. No I/O.

// The badge vocabulary mirrors miniapp AddressScreeningStatus exactly:
// terminal risk outcomes double as the risk level, the operational states
// carry no risk outcome.
export const ADDRESS_SCREENING_STATUSES = Object.freeze([
  "high",
  "low",
  "medium",
  "pending",
  "severe",
  "timed_out",
  "unavailable"
]);
export const ADDRESS_SCREENING_RISK_LEVELS = Object.freeze(["high", "low", "medium", "severe"]);
export const ADDRESS_SCREENING_VERDICTS = Object.freeze(["clear", "flagged", "none", "review"]);

// The same custody-dev-v1 allowlist the miniapp screening targets offer.
export const ADDRESS_SCREENING_TARGETS = Object.freeze([
  Object.freeze({ asset: "TON", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TRON_TESTNET" })
]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-address-screenings-v1";
const VIEW_KEYS = Object.freeze(["mode", "screenings"]);
const SCREENING_KEYS = Object.freeze([
  "advisory",
  "asset",
  "deadline",
  "direction",
  "executable",
  "network",
  "posting",
  "risk_level",
  "screening_id",
  "status",
  "submitted_at",
  "verdict"
]);
const SCREENING_ID_PATTERN = /^scr_[0-9a-f]{32}$/u;
const ASSET_PATTERN = /^[A-Z0-9]{2,16}$/u;
const TESTNET_PATTERN = /^[A-Z0-9]+_TESTNET$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-15T00:00:00.000Z");
const STEP_MS = 86_400_000;
const DEADLINE_MS = 1_800_000;
/** @type {Record<string, string>} */
const VERDICT_BY_RISK_LEVEL = Object.freeze({
  low: "clear",
  medium: "review",
  high: "flagged",
  severe: "flagged"
});

/**
 * @typedef {object} AddressScreeningView
 * @property {string} screening_id
 * @property {string} asset
 * @property {string} network
 * @property {string} direction
 * @property {string} status
 * @property {string} verdict
 * @property {string | null} risk_level
 * @property {boolean} advisory
 * @property {boolean} executable
 * @property {string} submitted_at
 * @property {string} deadline
 * @property {string} posting
 */

/**
 * @typedef {object} AddressScreeningsView
 * @property {string} mode
 * @property {readonly AddressScreeningView[]} screenings
 */

/**
 * @typedef {object} AddressScreeningDirectory
 * @property {(subject: string) => Promise<AddressScreeningsView>} listFor
 * @property {(subject: string, screeningId: string) => Promise<AddressScreeningView | undefined>} viewFor
 */

/**
 * @param {string} subject
 * @param {string} salt
 */
function digest(subject, salt) {
  return createHash("sha256").update(`${SIGNATURE_DOMAIN}\n${subject}\n${salt}`).digest("hex");
}

/**
 * Weighted deterministic status: ~60% terminal risk outcomes, the rest spread
 * across the operational states the local surface renders.
 * @param {string} subject
 * @param {number} index
 */
function statusFor(subject, index) {
  const roll = Number.parseInt(digest(subject, `status:${index}`).slice(0, 2), 16) % 20;
  if (roll < 12) {
    return ADDRESS_SCREENING_RISK_LEVELS[roll % 4];
  }
  if (roll < 16) {
    return "pending";
  }
  if (roll < 18) {
    return "unavailable";
  }
  return "timed_out";
}

/**
 * @param {string} subject
 * @param {number} index
 * @returns {AddressScreeningView}
 */
function buildAddressScreening(subject, index) {
  const target = ADDRESS_SCREENING_TARGETS[index];
  const status = statusFor(subject, index);
  const riskLevel = ADDRESS_SCREENING_RISK_LEVELS.includes(status) ? status : null;
  const verdict = riskLevel === null ? "none" : VERDICT_BY_RISK_LEVEL[riskLevel];
  const submittedMs = BASE_MS + index * STEP_MS;
  return Object.freeze({
    screening_id: `scr_${digest(subject, `id:${index}`).slice(0, 32)}`,
    asset: target.asset,
    network: target.network,
    direction: "outbound",
    status,
    verdict,
    risk_level: riskLevel,
    advisory: true,
    executable: false,
    submitted_at: new Date(submittedMs).toISOString(),
    deadline: new Date(submittedMs + DEADLINE_MS).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {AddressScreeningsView}
 */
function buildAddressScreeningsView(subject) {
  const screenings = Object.freeze(
    ADDRESS_SCREENING_TARGETS.map((_target, index) => buildAddressScreening(subject, index))
  );
  return Object.freeze({ mode: "test", screenings });
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/** @param {unknown} entry */
function validAddressScreening(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const record = /** @type {AddressScreeningView} */ (entry);
  if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...SCREENING_KEYS].sort())) {
    return false;
  }
  if (
    typeof record.screening_id !== "string" ||
    !SCREENING_ID_PATTERN.test(record.screening_id) ||
    typeof record.asset !== "string" ||
    !ASSET_PATTERN.test(record.asset) ||
    typeof record.network !== "string" ||
    !TESTNET_PATTERN.test(record.network) ||
    !ADDRESS_SCREENING_TARGETS.some(
      (target) => target.asset === record.asset && target.network === record.network
    ) ||
    record.direction !== "outbound" ||
    typeof record.status !== "string" ||
    !ADDRESS_SCREENING_STATUSES.includes(record.status) ||
    record.advisory !== true ||
    record.executable !== false ||
    !isIsoTimestamp(record.submitted_at) ||
    !isIsoTimestamp(record.deadline) ||
    !(Date.parse(record.deadline) > Date.parse(record.submitted_at)) ||
    record.posting !== "none"
  ) {
    return false;
  }
  const terminal = ADDRESS_SCREENING_RISK_LEVELS.includes(record.status);
  const hasRiskLevel = record.risk_level !== null && ADDRESS_SCREENING_RISK_LEVELS.includes(record.risk_level);
  if (terminal !== hasRiskLevel) {
    return false;
  }
  if (terminal && record.risk_level !== record.status) {
    return false;
  }
  const expectedVerdict =
    record.risk_level === null ? "none" : VERDICT_BY_RISK_LEVEL[record.risk_level];
  return ADDRESS_SCREENING_VERDICTS.includes(record.verdict) && record.verdict === expectedVerdict;
}

/** @param {unknown} view */
export function validAddressScreeningsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {AddressScreeningsView} */ (view);
  if (
    JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort()) ||
    candidate.mode !== "test" ||
    !Array.isArray(candidate.screenings) ||
    // The set is exactly the allowlisted screening targets: one record per
    // (asset, network) pair — a duplicate or a missing pair fails closed.
    candidate.screenings.length !== ADDRESS_SCREENING_TARGETS.length
  ) {
    return false;
  }
  const seen = new Set();
  for (const record of candidate.screenings) {
    const key =
      record !== null && typeof record === "object" && !Array.isArray(record)
        ? `${record.asset}/${record.network}`
        : undefined;
    if (!validAddressScreening(record) || key === undefined || seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

/** @param {unknown} view */
export function validAddressScreeningView(view) {
  return validAddressScreening(view);
}

/** @returns {AddressScreeningDirectory} */
export function createSyntheticAddressScreeningDirectory() {
  // No per-subject memo: views are pure functions of the subject, and a
  // retained cache would grow without bound across distinct subjects.
  /**
   * @param {string} subject
   */
  async function viewForSubject(subject) {
    return buildAddressScreeningsView(subject);
  }
  return Object.freeze({
    async listFor(subject) {
      return viewForSubject(subject);
    },
    async viewFor(subject, screeningId) {
      const view = await viewForSubject(subject);
      return view.screenings.find((entry) => entry.screening_id === screeningId);
    }
  });
}
