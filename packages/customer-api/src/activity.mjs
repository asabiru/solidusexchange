import { createHash } from "node:crypto";

import { CARD_STATUSES } from "./cards.mjs";
import { CHECK_STATUSES } from "./checks.mjs";
import { DEPOSIT_STATUSES } from "./deposits.mjs";
import { ORDER_STATUSES } from "./exchange-orders.mjs";
import { KYC_APPLICATION_STATUSES } from "./kyc.mjs";
import { PAYMENT_STATUSES } from "./payments.mjs";
import { WITHDRAWAL_STATUSES } from "./withdrawals.mjs";

// Deterministic synthetic customer activity feed. A future activity adapter
// replaces it behind `viewFor(subject) -> Promise<ActivityView>`; payloads
// are frozen and derived from the subject only, so reads stay reproducible.
// The feed is a cross-domain projection of the subject's own synthetic
// records — deposits, withdrawals, quote previews, exchange orders,
// payments, cards, checks, identity verification and session security
// events — the same surface the miniapp's local ActivityLog renders for
// gated sessions. Every entry is a derived-only record: detail strings cite
// the domain id a sibling collection would use (dep_*/wdr_*/qte_*/ord_*/
// pay_*/crd_*/chk_*) so the feed reads like the served collections, but no
// entry ever creates posting state — posting stays "none" and nothing here
// reserves, posts or moves funds. No I/O.

// The kind set mirrors the miniapp activity vocabulary's domains: every
// money and account collection plus the kyc and session-security events.
export const ACTIVITY_KINDS = Object.freeze([
  "deposit",
  "withdrawal",
  "quote",
  "order",
  "payment",
  "card",
  "check",
  "kyc",
  "security"
]);
// Per-kind status vocabulary mirrors the sibling directories exactly: the
// feed item's status is the lifecycle state the referenced domain record is
// in, so the union is derived — never re-declared — from the domain status
// sets. KYC events mirror the miniapp's activity states (every application
// status but not_started); security events mirror the miniapp's
// session_login / session_revoked pair.
/** @type {Readonly<Record<string, readonly string[]>>} */
export const ACTIVITY_STATUSES = Object.freeze({
  deposit: DEPOSIT_STATUSES,
  withdrawal: WITHDRAWAL_STATUSES,
  quote: Object.freeze(["indicative"]),
  order: ORDER_STATUSES,
  payment: PAYMENT_STATUSES,
  card: CARD_STATUSES,
  check: CHECK_STATUSES,
  kyc: Object.freeze(KYC_APPLICATION_STATUSES.filter((status) => status !== "not_started")),
  security: Object.freeze(["login", "revoked"])
});
// Kinds that carry an amount/asset pair; kyc and security events never do.
const MONEY_KINDS = new Set(["deposit", "withdrawal", "quote", "order", "payment", "card", "check"]);
// Activity assets and scales mirror the check domain table (USDT scale 6,
// TON scale 9) plus the fiat rail (RUB scale 2) the deposit, payment and
// card domains use.
export const ACTIVITY_ASSETS = Object.freeze({ RUB: 2, USDT: 6, TON: 9 });
const ACTIVITY_ASSET_ENTRIES = Object.freeze(Object.entries(ACTIVITY_ASSETS));
const ACTIVITY_ASSET_SCALES = new Map(Object.entries(ACTIVITY_ASSETS));
// The domain id prefix a detail line cites for each money/domain kind —
// the same prefixes the sibling collections mint (qte_* for quotes); kyc
// and security entries carry no domain reference.
/** @type {Readonly<Record<string, string | undefined>>} */
const KIND_REF_PREFIX = Object.freeze({
  deposit: "dep_",
  withdrawal: "wdr_",
  quote: "qte_",
  order: "ord_",
  payment: "pay_",
  card: "crd_",
  check: "chk_"
});
/** @type {Readonly<Record<string, string>>} */
const KIND_TITLE = Object.freeze({
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  quote: "Quote preview",
  order: "Exchange order",
  payment: "Payment",
  card: "Card",
  check: "Check",
  kyc: "Identity verification",
  security: "Session security"
});
/** @type {Readonly<Record<string, string>>} */
const SECURITY_TITLES = Object.freeze({ login: "Session login", revoked: "Session revoked" });
const DOMAIN_ID_PATTERN = /(?:dep|wdr|qte|ord|pay|crd|chk)_[0-9a-f]{24}/u;

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-activity-v1";
const VIEW_KEYS = Object.freeze(["activity", "mode"]);
const ITEM_KEYS = Object.freeze([
  "activity_id",
  "kind",
  "status",
  "title",
  "detail",
  "money",
  "created_at",
  "posting"
]);
const ACTIVITY_ID_PATTERN = /^act_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 6 * 3_600_000;

/**
 * @typedef {object} ActivityItemView
 * @property {string} activity_id
 * @property {string} kind
 * @property {string} status
 * @property {string} title
 * @property {string} detail
 * @property {{ amount: string, asset: string } | null} money
 * @property {string} created_at
 * @property {string} posting
 */

/**
 * @typedef {object} ActivityView
 * @property {string} mode
 * @property {readonly ActivityItemView[]} activity
 */

/**
 * @typedef {object} ActivityDirectory
 * @property {(subject: string) => Promise<ActivityView>} viewFor
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
 * @returns {ActivityItemView}
 */
function buildActivityItem(subject, index) {
  const offset = Number(units(subject, "kind:offset", BigInt(ACTIVITY_KINDS.length)));
  const kind = ACTIVITY_KINDS[(offset + index) % ACTIVITY_KINDS.length];
  const statuses = ACTIVITY_STATUSES[kind];
  const status = statuses[Number(units(subject, `status:${index}`, BigInt(statuses.length)))];
  const refPrefix = KIND_REF_PREFIX[kind];
  const ref = refPrefix === undefined ? null : `${refPrefix}${digest(subject, `ref:${index}`).toString("hex").slice(0, 24)}`;
  const monetary = MONEY_KINDS.has(kind);
  const [asset, scale] = monetary
    ? ACTIVITY_ASSET_ENTRIES[Number(units(subject, `asset:${index}`, BigInt(ACTIVITY_ASSET_ENTRIES.length)))]
    : ["", 0];
  const money = monetary
    ? Object.freeze({ amount: decimal(1_000_000n + units(subject, `amount:${index}`, 9_999_000_001n), scale), asset })
    : null;
  const title = kind === "security"
    ? SECURITY_TITLES[status]
    : `${KIND_TITLE[kind]} · ${status.replaceAll("_", " ")}`;
  const detail = ref === null
    ? `Simulated ${KIND_TITLE[kind].toLowerCase()} event on the test rail`
    : `Simulated ${KIND_TITLE[kind].toLowerCase()} ${ref} on the test rail`;
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `at:${index}`, BigInt(STEP_MS)));
  return Object.freeze({
    activity_id: `act_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    kind,
    status,
    title,
    detail,
    money,
    created_at: new Date(createdMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {ActivityView}
 */
function buildActivityView(subject) {
  const count = 1 + Number(units(subject, "count", BigInt(ACTIVITY_KINDS.length)));
  const activity = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildActivityItem(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", activity });
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

/** @param {unknown} item */
function validActivityItem(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const candidate = /** @type {ActivityItemView} */ (item);
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify([...ITEM_KEYS].sort())) {
    return false;
  }
  if (
    !ACTIVITY_ID_PATTERN.test(candidate.activity_id) ||
    !ACTIVITY_KINDS.includes(candidate.kind) ||
    !ACTIVITY_STATUSES[candidate.kind].includes(candidate.status) ||
    typeof candidate.title !== "string" ||
    candidate.title.length < 1 ||
    candidate.title.length > 128 ||
    typeof candidate.detail !== "string" ||
    candidate.detail.length < 1 ||
    candidate.detail.length > 256 ||
    !isIsoTimestamp(candidate.created_at) ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  const refPrefix = KIND_REF_PREFIX[candidate.kind];
  if (refPrefix === undefined) {
    // Non-domain events never cite a collection reference.
    if (DOMAIN_ID_PATTERN.test(candidate.detail)) {
      return false;
    }
  } else if (!candidate.detail.includes(`${refPrefix}`) || !new RegExp(`${refPrefix}[0-9a-f]{24}`, "u").test(candidate.detail)) {
    return false;
  }
  if (!MONEY_KINDS.has(candidate.kind)) {
    return candidate.money === null;
  }
  const money = candidate.money;
  if (money === null || typeof money !== "object" || Array.isArray(money)) {
    return false;
  }
  if (JSON.stringify(Object.keys(money).sort()) !== JSON.stringify(["amount", "asset"])) {
    return false;
  }
  const scale = ACTIVITY_ASSET_SCALES.get(money.asset);
  if (scale === undefined) {
    return false;
  }
  return isScaledDecimal(money.amount, scale) && parseUnits(money.amount) > 0n;
}

/** @param {unknown} view */
export function validActivityView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {ActivityView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.activity)) {
    return false;
  }
  // The feed stays bounded like the miniapp cap: at most one synthetic
  // entry per kind, newest first with unique ids and strictly decreasing
  // timestamps.
  if (candidate.activity.length < 1 || candidate.activity.length > ACTIVITY_KINDS.length) {
    return false;
  }
  const seen = new Set();
  let previous = Number.POSITIVE_INFINITY;
  for (const item of candidate.activity) {
    if (!validActivityItem(item) || seen.has(item.activity_id)) {
      return false;
    }
    const at = Date.parse(item.created_at);
    if (at >= previous) {
      return false;
    }
    seen.add(item.activity_id);
    previous = at;
  }
  return true;
}

/** @returns {ActivityDirectory} */
export function createSyntheticActivityDirectory() {
  const cache = new Map();
  return Object.freeze({
    async viewFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildActivityView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
