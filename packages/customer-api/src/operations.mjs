import { createHash } from "node:crypto";

import { DEPOSIT_STATUSES } from "./deposits.mjs";
import { ORDER_STATUSES } from "./exchange-orders.mjs";
import { PAYMENT_STATUSES } from "./payments.mjs";
import { WITHDRAWAL_STATUSES } from "./withdrawals.mjs";

// Deterministic synthetic customer operations feed. A future operations
// adapter replaces it behind `viewFor(subject) -> Promise<OperationsView>`
// and `operationFor(subject, id) -> Promise<OperationView | null>`; payloads
// are frozen and derived from the subject only, so reads stay reproducible.
// The feed is a ledger-style cross-domain projection of the subject's own
// synthetic records — exchange conversions, deposits, withdrawals and QR
// payments — the same surface the miniapp's local Operations screens
// render for gated sessions. Every entry is a derived-only record:
// posting stays "none" and nothing here reserves, posts or moves funds.
// No I/O.

// The kind set mirrors the miniapp operations vocabulary exactly.
export const OPERATION_KINDS = Object.freeze([
  "exchange",
  "deposit",
  "withdrawal",
  "qr"
]);
// Per-kind status vocabulary mirrors the sibling directories exactly: an
// operation's status is the lifecycle state the referenced domain record
// is in, so the union is derived — never re-declared — from the domain
// status sets (exchange orders, deposits, withdrawals, QR payments).
/** @type {Readonly<Record<string, readonly string[]>>} */
export const OPERATION_STATUSES = Object.freeze({
  exchange: ORDER_STATUSES,
  deposit: DEPOSIT_STATUSES,
  withdrawal: WITHDRAWAL_STATUSES,
  qr: PAYMENT_STATUSES
});
// Operation assets and scales mirror the activity domain table (USDT
// scale 6, TON scale 9) plus the fiat rail (RUB scale 2) the deposit and
// QR payment domains use.
export const OPERATION_ASSETS = Object.freeze({ RUB: 2, USDT: 6, TON: 9 });
const OPERATION_ASSET_ENTRIES = Object.freeze(Object.entries(OPERATION_ASSETS));
// Exchange quote assets exclude USDT so base (USDT) never equals quote.
const QUOTE_ASSET_ENTRIES = Object.freeze(
  OPERATION_ASSET_ENTRIES.filter(([asset]) => asset !== "USDT")
);
const OPERATION_ASSET_SCALES = new Map(Object.entries(OPERATION_ASSETS));
const RATE_SCALE = 6;

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-operations-v1";
const VIEW_KEYS = Object.freeze(["mode", "operations"]);
const ITEM_KEYS = Object.freeze([
  "operation_id",
  "reference",
  "kind",
  "status",
  "title",
  "channel",
  "legs",
  "fee_amount",
  "fee_asset",
  "exchange",
  "note",
  "timeline",
  "created_at",
  "posting"
]);
const LEG_KEYS = Object.freeze(["asset", "amount", "direction"]);
const EXCHANGE_KEYS = Object.freeze(["base_asset", "quote_asset", "rate"]);
const TIMELINE_KEYS = Object.freeze(["title", "detail", "at", "state"]);
const TIMELINE_STATES = Object.freeze(["done", "current", "pending", "blocked"]);
const OPERATION_ID_PATTERN = /^ope_[0-9a-f]{24}$/u;
const REFERENCE_PATTERN = /^SCX-[0-9]{5,10}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-08-15T00:00:00.000Z");
const STEP_MS = 9 * 3_600_000;
const CHANNELS = Object.freeze(["web", "miniapp", "backoffice"]);
/** @type {Readonly<Record<string, string>>} */
const KIND_TITLE = Object.freeze({
  exchange: "Exchange order",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  qr: "QR payment"
});

/**
 * @typedef {object} OperationLegView
 * @property {string} asset
 * @property {string} amount
 * @property {string} direction
 */

/**
 * @typedef {object} OperationExchangeView
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {string} rate
 */

/**
 * @typedef {object} OperationTimelineStepView
 * @property {string} title
 * @property {string} detail
 * @property {string | null} at
 * @property {string} state
 */

/**
 * @typedef {object} OperationView
 * @property {string} operation_id
 * @property {string} reference
 * @property {string} kind
 * @property {string} status
 * @property {string} title
 * @property {string} channel
 * @property {readonly OperationLegView[]} legs
 * @property {string} fee_amount
 * @property {string} fee_asset
 * @property {OperationExchangeView | null} exchange
 * @property {string} note
 * @property {readonly OperationTimelineStepView[]} timeline
 * @property {string} created_at
 * @property {string} posting
 */

/**
 * @typedef {object} OperationsView
 * @property {string} mode
 * @property {readonly OperationView[]} operations
 */

/**
 * @typedef {object} OperationDirectory
 * @property {(subject: string) => Promise<OperationsView>} viewFor
 * @property {(subject: string, operationId: string) => Promise<OperationView | null>} operationFor
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
 * @returns {OperationView}
 */
function buildOperationItem(subject, index) {
  const offset = Number(units(subject, "kind:offset", BigInt(OPERATION_KINDS.length)));
  const kind = OPERATION_KINDS[(offset + index) % OPERATION_KINDS.length];
  const statuses = OPERATION_STATUSES[kind];
  const status = statuses[Number(units(subject, `status:${index}`, BigInt(statuses.length)))];
  const assetPool = kind === "exchange" ? QUOTE_ASSET_ENTRIES : OPERATION_ASSET_ENTRIES;
  const [asset, scale] =
    assetPool[Number(units(subject, `asset:${index}`, BigInt(assetPool.length)))];
  const amount = decimal(1_000_000n + units(subject, `amount:${index}`, 9_999_000_001n), scale);
  const feeUnits = 100n + units(subject, `fee:${index}`, 9_901n);
  const [feeAsset, feeScale] =
    OPERATION_ASSET_ENTRIES[Number(units(subject, `fee:asset:${index}`, BigInt(OPERATION_ASSET_ENTRIES.length)))];
  const legs =
    kind === "exchange"
      ? Object.freeze([
          Object.freeze({
            asset: "USDT",
            amount: decimal(1_000_000n + units(subject, `out:${index}`, 9_999_000_001n), 6),
            direction: "out"
          }),
          Object.freeze({ asset, amount, direction: "in" })
        ])
      : Object.freeze([
          Object.freeze({
            asset,
            amount,
            direction: kind === "withdrawal" ? "out" : "in"
          })
        ]);
  const exchange =
    kind === "exchange"
      ? Object.freeze({
          base_asset: "USDT",
          quote_asset: asset,
          rate: decimal(1_000_000n + units(subject, `rate:${index}`, 99_000_000n), RATE_SCALE)
        })
      : null;
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `at:${index}`, BigInt(STEP_MS)));
  const stepCount = 2 + Number(units(subject, `timeline:${index}`, 3n));
  const timeline = Object.freeze(
    Array.from({ length: stepCount }, (_value, step) => {
      const state = step + 1 === stepCount ? "current" : "done";
      return Object.freeze({
        title: `Step ${step + 1}`,
        detail: `Simulated ${KIND_TITLE[kind].toLowerCase()} milestone ${step + 1} on the test rail`,
        at: new Date(createdMs - (stepCount - 1 - step) * 3_600_000).toISOString(),
        state
      });
    })
  );
  return Object.freeze({
    operation_id: `ope_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    reference: `SCX-${String(10_000 + Number(units(subject, `ref:${index}`, 89_999n))).padStart(5, "0")}`,
    kind,
    status,
    title: `${KIND_TITLE[kind]} · ${status.replaceAll("_", " ")}`,
    channel: CHANNELS[Number(units(subject, `channel:${index}`, BigInt(CHANNELS.length)))],
    legs,
    fee_amount: decimal(feeUnits, feeScale),
    fee_asset: feeAsset,
    exchange,
    note: `Simulated ${KIND_TITLE[kind].toLowerCase()} on the test rail; no funds moved.`,
    timeline,
    created_at: new Date(createdMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {OperationsView}
 */
function buildOperationsView(subject) {
  const count = 1 + Number(units(subject, "count", BigInt(OPERATION_KINDS.length)));
  const operations = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildOperationItem(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", operations });
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

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 */
function isBoundedString(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

/** @param {unknown} leg */
function validOperationLeg(leg) {
  if (leg === null || typeof leg !== "object" || Array.isArray(leg)) {
    return false;
  }
  const candidate = /** @type {OperationLegView} */ (leg);
  if (JSON.stringify(Object.keys(leg).sort()) !== JSON.stringify([...LEG_KEYS].sort())) {
    return false;
  }
  const scale = OPERATION_ASSET_SCALES.get(candidate.asset);
  if (scale === undefined) {
    return false;
  }
  return (
    (candidate.direction === "in" || candidate.direction === "out") &&
    isScaledDecimal(candidate.amount, scale) &&
    parseUnits(candidate.amount) > 0n
  );
}

/** @param {unknown} step */
function validTimelineStep(step) {
  if (step === null || typeof step !== "object" || Array.isArray(step)) {
    return false;
  }
  const candidate = /** @type {OperationTimelineStepView} */ (step);
  if (JSON.stringify(Object.keys(step).sort()) !== JSON.stringify([...TIMELINE_KEYS].sort())) {
    return false;
  }
  if (
    !isBoundedString(candidate.title, 1, 64) ||
    !isBoundedString(candidate.detail, 1, 256) ||
    !TIMELINE_STATES.includes(candidate.state)
  ) {
    return false;
  }
  // Steps that already happened carry their timestamp; pending and
  // blocked steps carry null.
  if (candidate.state === "done" || candidate.state === "current") {
    return isIsoTimestamp(candidate.at);
  }
  return candidate.at === null;
}

/** @param {unknown} exchange */
function validExchange(exchange) {
  if (exchange === null || typeof exchange !== "object" || Array.isArray(exchange)) {
    return false;
  }
  const candidate = /** @type {OperationExchangeView} */ (exchange);
  if (JSON.stringify(Object.keys(exchange).sort()) !== JSON.stringify([...EXCHANGE_KEYS].sort())) {
    return false;
  }
  if (!OPERATION_ASSET_SCALES.has(candidate.base_asset) || !OPERATION_ASSET_SCALES.has(candidate.quote_asset)) {
    return false;
  }
  return isScaledDecimal(candidate.rate, RATE_SCALE) && parseUnits(candidate.rate) > 0n;
}

/** @param {unknown} item */
export function validOperationView(item) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const candidate = /** @type {OperationView} */ (item);
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify([...ITEM_KEYS].sort())) {
    return false;
  }
  if (
    !OPERATION_ID_PATTERN.test(candidate.operation_id) ||
    !REFERENCE_PATTERN.test(candidate.reference) ||
    !OPERATION_KINDS.includes(candidate.kind) ||
    !OPERATION_STATUSES[candidate.kind].includes(candidate.status) ||
    !isBoundedString(candidate.title, 1, 128) ||
    !isBoundedString(candidate.channel, 1, 64) ||
    !isBoundedString(candidate.note, 1, 256) ||
    !isIsoTimestamp(candidate.created_at) ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  const feeScale = OPERATION_ASSET_SCALES.get(candidate.fee_asset);
  if (
    feeScale === undefined ||
    !isScaledDecimal(candidate.fee_amount, feeScale) ||
    parseUnits(candidate.fee_amount) <= 0n
  ) {
    return false;
  }
  if (!Array.isArray(candidate.legs)) {
    return false;
  }
  const expectedLegs = candidate.kind === "exchange" ? 2 : 1;
  if (candidate.legs.length !== expectedLegs || !candidate.legs.every(validOperationLeg)) {
    return false;
  }
  if (candidate.kind === "exchange") {
    if (!validExchange(candidate.exchange)) {
      return false;
    }
    const exchange = /** @type {OperationExchangeView} */ (candidate.exchange);
    if (candidate.legs[0].asset !== exchange.base_asset || candidate.legs[0].direction !== "out") {
      return false;
    }
    if (candidate.legs[1].asset !== exchange.quote_asset || candidate.legs[1].direction !== "in") {
      return false;
    }
    if (exchange.base_asset === exchange.quote_asset) {
      return false;
    }
  } else {
    if (candidate.exchange !== null) {
      return false;
    }
    if (candidate.legs[0].direction !== (candidate.kind === "withdrawal" ? "out" : "in")) {
      return false;
    }
  }
  if (
    !Array.isArray(candidate.timeline) ||
    candidate.timeline.length < 1 ||
    candidate.timeline.length > 4 ||
    !candidate.timeline.every(validTimelineStep)
  ) {
    return false;
  }
  // The walk only ever moves forward inside the operation's own window:
  // recorded steps are non-decreasing in time and never past creation.
  const createdMs = Date.parse(candidate.created_at);
  let previousStep = Number.NEGATIVE_INFINITY;
  for (const step of candidate.timeline) {
    if (step.at === null) {
      continue;
    }
    const at = Date.parse(step.at);
    if (at < previousStep || at > createdMs) {
      return false;
    }
    previousStep = at;
  }
  return true;
}

/** @param {unknown} view */
export function validOperationsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {OperationsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.operations)) {
    return false;
  }
  // The feed stays bounded like the miniapp cap: at most one synthetic
  // entry per kind, newest first with unique ids and strictly decreasing
  // timestamps.
  if (candidate.operations.length < 1 || candidate.operations.length > OPERATION_KINDS.length) {
    return false;
  }
  const seen = new Set();
  const seenKinds = new Set();
  let previous = Number.POSITIVE_INFINITY;
  for (const item of candidate.operations) {
    if (!validOperationView(item) || seen.has(item.operation_id) || seenKinds.has(item.kind)) {
      return false;
    }
    const at = Date.parse(item.created_at);
    if (at >= previous) {
      return false;
    }
    seen.add(item.operation_id);
    seenKinds.add(item.kind);
    previous = at;
  }
  return true;
}

/** @returns {OperationDirectory} */
export function createSyntheticOperationDirectory() {
  // No per-subject memo: views are pure functions of the subject, and a
  // retained cache would grow without bound across distinct subjects.
  const directory = Object.freeze({
    /** @param {string} subject */
    async viewFor(subject) {
      return buildOperationsView(subject);
    },
    /**
     * Fails closed to null for ids the subject does not own and for
     * malformed ids — the router maps null to the pinned 404 envelope.
     * @param {string} subject
     * @param {string} operationId
     */
    async operationFor(subject, operationId) {
      const view = await directory.viewFor(subject);
      return view.operations.find((/** @type {OperationView} */ operation) => operation.operation_id === operationId) ?? null;
    }
  });
  return directory;
}
