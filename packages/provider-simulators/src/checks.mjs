import { timingSafeEqual } from "node:crypto";

import { createCallbackInbox } from "./callback-inbox.mjs";
import { formatAmount, parseAmount, parsePositiveAmount } from "./decimal.mjs";
import { createSeededRandom, createSimulatedClock, toIsoSeconds } from "./deterministic.mjs";
import { ProviderError } from "./errors.mjs";
import {
  createCallbackSigner,
  createCallbackVerifier,
  SIMULATOR_ENVIRONMENT,
} from "./signing.mjs";
import {
  DeliveryQueue,
  exactKeys,
  IdempotencyRegistry,
  idempotencyKey,
  isIsoSeconds,
  isPositiveSequence,
  isStringMatching,
  oneOf,
  outageError,
  resolveScenario,
  sha256Hex,
  SIM_ID,
  SYNTHETIC_REFERENCE,
  snapshotRequest,
  syntheticReference,
  validateScenarioPlan,
} from "./simulator-core.mjs";

/** @import { JsonValue } from "./canonical-json.mjs" */

/**
 * Provider-neutral adapter for Telegram in-chat crypto checks (D-019, Phase 1:
 * dev-only simulation). It records synthetic personal checks and reports state
 * transitions through signed callbacks verified with
 * `createChecksCallbackVerifier`. Personal checks only — bearer and
 * multi-claim checks stay out of scope until the open compliance questions
 * clear. No adapter method reserves, posts or moves funds: the outstanding
 * amount is a pure function of open check state and every view carries
 * `posting: "none"`.
 *
 * Lifecycle: `createCheck` (bot-side) → `issueCheck` (sender confirmation) →
 * `claimCheck` (verified recipient) or `cancelCheck` (sender) or expiry.
 *
 * @typedef {object} ChecksProviderAdapter
 * @property {string} providerId
 * @property {(request: CheckPreviewRequest) => Promise<CheckPreview>} previewCheck
 * @property {(request: CheckCreateRequest) => Promise<CheckView>} createCheck
 * @property {(request: CheckCommandRequest) => Promise<CheckView>} issueCheck
 * @property {(request: CheckClaimRequest) => Promise<CheckView>} claimCheck
 * @property {(request: CheckCommandRequest) => Promise<CheckView>} cancelCheck
 * @property {(checkId: string) => Promise<CheckView>} getCheckStatus
 */

/** @typedef {"personal"} CheckType */
/** @typedef {"awaiting_confirmation" | "created" | "awaiting_recipient_kyc" | "claimed" | "cancelled" | "expired"} CheckStatus */

/**
 * @typedef {object} CheckMember
 * @property {boolean} kyc_verified
 */

/**
 * @typedef {object} CheckPreviewRequest
 * @property {CheckType} check_type
 * @property {string} sender_ref Synthetic member reference (`sim-…`).
 * @property {string} recipient_ref
 * @property {string} amount Exact decimal string in the asset scale.
 * @property {"USDT" | "TON"} asset
 * @property {string} [comment]
 */

/**
 * @typedef {object} CheckPreview
 * @property {CheckType} check_type
 * @property {string} recipient_ref
 * @property {string} amount
 * @property {string} asset
 * @property {string} fee_amount Zero in this slice.
 * @property {string} preview_reference Synthetic preview handle.
 * @property {string} expires_at
 * @property {"none"} posting
 */

/**
 * @typedef {object} CheckCreateRequest
 * @property {string} check_ref Synthetic reference (`sim-…`); also the scenario key.
 * @property {CheckType} check_type
 * @property {string} sender_ref
 * @property {string} recipient_ref
 * @property {string} amount
 * @property {string} asset
 * @property {string} claim_reference Caller-supplied opaque claim handle; only
 *   its digest is stored.
 * @property {string} idempotency_key
 * @property {string} [comment]
 */

/**
 * @typedef {object} CheckCommandRequest
 * @property {string} check_id
 * @property {string} member_ref Authenticated caller's member reference.
 * @property {string} idempotency_key
 */

/**
 * @typedef {object} CheckClaimRequest
 * @property {string} check_id
 * @property {string} member_ref
 * @property {string} claim_reference
 * @property {string} idempotency_key
 */

/**
 * @typedef {object} CheckView
 * @property {string} check_id
 * @property {string} check_ref
 * @property {CheckType} check_type
 * @property {CheckStatus} status
 * @property {string} sender_ref
 * @property {string} recipient_ref
 * @property {string} amount
 * @property {string} asset
 * @property {string} fee_amount
 * @property {string} outstanding_amount Pure function of state: the check
 *   amount while it is open (`created` / `awaiting_recipient_kyc`), zero
 *   otherwise.
 * @property {string} created_at
 * @property {string} expires_at
 * @property {string | null} resolved_at
 * @property {number} sequence Emitted callback count for this check.
 * @property {number} failed_claim_attempts
 * @property {"none"} posting No ledger effect is produced by this adapter.
 */

export const CHECKS_SCENARIOS = Object.freeze({
  delivered: { delivery: "normal" },
  duplicate_callback: { delivery: "duplicate" },
  late_callback: { delivery: "late" },
  silent_callback: { delivery: "none" },
  provider_outage: { delivery: "none" },
});

/** @typedef {keyof typeof CHECKS_SCENARIOS} ChecksScenario */

const SCENARIO_NAMES = /** @type {ChecksScenario[]} */ (Object.keys(CHECKS_SCENARIOS));
const CHECK_ASSETS = /** @type {const} */ (["USDT", "TON"]);
const CHECK_STATUSES = /** @type {const} */ ([
  "awaiting_confirmation",
  "created",
  "awaiting_recipient_kyc",
  "claimed",
  "cancelled",
  "expired",
]);
const CHECK_ID = /^[a-z][a-z0-9_-]{2,127}$/;
const CLAIM_REFERENCE = /^[A-Za-z0-9._:-]{16,128}$/;

export const CHECKS_TRANSITIONS = Object.freeze({
  registered: Object.freeze(["awaiting_confirmation"]),
  awaiting_confirmation: Object.freeze(["created", "awaiting_recipient_kyc", "cancelled", "expired"]),
  created: Object.freeze(["claimed", "cancelled", "expired"]),
  awaiting_recipient_kyc: Object.freeze(["created", "cancelled", "expired"]),
  claimed: Object.freeze([]),
  cancelled: Object.freeze([]),
  expired: Object.freeze([]),
});

export const CHECKS_CALLBACK_SCHEMA = "solidchange.sim.checks.callback.v1";
const CALLBACK_KEYS = [
  "amount",
  "asset",
  "check_id",
  "check_ref",
  "check_type",
  "domain",
  "environment",
  "event_id",
  "expires_at",
  "fee_amount",
  "occurred_at",
  "outstanding_amount",
  "posting",
  "recipient_ref",
  "schema",
  "sender_ref",
  "sequence",
  "status",
];

/**
 * @param {Record<string, JsonValue>} payload
 * @returns {string | null}
 */
export function validateChecksCallback(payload) {
  const keys = exactKeys(payload, CALLBACK_KEYS);
  if (keys) {
    return keys;
  }
  if (payload.schema !== CHECKS_CALLBACK_SCHEMA || payload.check_type !== "personal" || payload.posting !== "none") {
    return "unknown schema, check_type or posting";
  }
  if (!isStringMatching(payload.event_id, SIM_ID) || !isStringMatching(payload.check_id, SIM_ID)) {
    return "invalid identifiers";
  }
  if (
    !isStringMatching(payload.check_ref, SYNTHETIC_REFERENCE)
    || !isStringMatching(payload.sender_ref, SYNTHETIC_REFERENCE)
    || !isStringMatching(payload.recipient_ref, SYNTHETIC_REFERENCE)
  ) {
    return "invalid member references";
  }
  const status = /** @type {CheckStatus} */ (payload.status);
  if (!CHECK_STATUSES.includes(status)) {
    return "invalid status";
  }
  if (!isStringMatching(payload.asset, /^[A-Z0-9]{2,16}$/) || !CHECK_ASSETS.includes(/** @type {any} */ (payload.asset))) {
    return "invalid asset";
  }
  if (
    !isPositiveSequence(payload.sequence)
    || !isIsoSeconds(payload.occurred_at)
    || !isIsoSeconds(payload.expires_at)
  ) {
    return "invalid sequence or timestamps";
  }
  let amount;
  let fee;
  let outstanding;
  try {
    amount = parsePositiveAmount(/** @type {"USDT" | "TON"} */ (payload.asset), payload.amount);
    fee = parseAmount(/** @type {"USDT" | "TON"} */ (payload.asset), payload.fee_amount);
    outstanding = parseAmount(/** @type {"USDT" | "TON"} */ (payload.asset), payload.outstanding_amount);
  } catch {
    return "invalid amounts";
  }
  if (fee !== 0n) {
    return "fee_amount must be zero in this slice";
  }
  if (payload.sender_ref === payload.recipient_ref) {
    return "sender and recipient must differ";
  }
  const open = status === "created" || status === "awaiting_recipient_kyc";
  if (open ? outstanding !== amount : outstanding !== 0n) {
    return "outstanding amount must equal the check amount while open and be zero otherwise";
  }
  return null;
}

/**
 * @param {Omit<import("./signing.mjs").CallbackVerifierOptions, "domain" | "validatePayload">} options
 */
export function createChecksCallbackVerifier(options) {
  return createCallbackVerifier({ ...options, domain: "checks", validatePayload: validateChecksCallback });
}

export function createChecksCallbackInbox() {
  return createCallbackInbox({
    subjectField: "check_id",
    initialStatus: "registered",
    transitions: CHECKS_TRANSITIONS,
  });
}

/**
 * @typedef {object} ChecksSimulatorOptions
 * @property {string} seed
 * @property {import("./signing.mjs").SimulatorKey} key Per-run key from `generateSimulatorKey`.
 * @property {Record<string, CheckMember>} members Member directory keyed by
 *   synthetic `sim-…` reference; membership and KYC status are deny-by-default.
 * @property {import("./deterministic.mjs").SimulatedClock} [clock]
 * @property {Record<string, ChecksScenario>} [scenarios] check_ref → scenario.
 * @property {ChecksScenario} [defaultScenario]
 * @property {number} [checkTtlSeconds]
 */

/**
 * Deterministic, scenario-driven checks simulator. No network, no live
 * provider, no PII, no ledger postings: member references must be synthetic
 * and every transition is recorded through signed callbacks only.
 *
 * @param {ChecksSimulatorOptions} options
 */
export function createChecksSimulator(options) {
  const random = createSeededRandom(options.seed);
  const clock = options.clock ?? createSimulatedClock();
  const scenarios = validateScenarioPlan(options.scenarios, SCENARIO_NAMES);
  const fallback = options.defaultScenario;
  if (fallback !== undefined && !SCENARIO_NAMES.includes(fallback)) {
    throw new TypeError("unknown default checks scenario");
  }
  const members = validateMembers(options.members);
  const checkTtlSeconds = options.checkTtlSeconds ?? 259_200;
  if (!Number.isSafeInteger(checkTtlSeconds) || checkTtlSeconds < 3600 || checkTtlSeconds > 604_800) {
    throw new RangeError("checkTtlSeconds must be an integer between 3600 and 604800");
  }
  const queue = new DeliveryQueue(createCallbackSigner({ key: options.key, domain: "checks", random }));
  /** @type {IdempotencyRegistry<CheckView>} */
  const createRegistry = new IdempotencyRegistry();
  /** @type {IdempotencyRegistry<CheckView>} */
  const issueRegistry = new IdempotencyRegistry();
  /** @type {IdempotencyRegistry<CheckView>} */
  const claimRegistry = new IdempotencyRegistry();
  /** @type {IdempotencyRegistry<CheckView>} */
  const cancelRegistry = new IdempotencyRegistry();
  /** @type {Map<string, CheckRecord>} */
  const checks = new Map();

  /**
   * @typedef {object} CheckRecord
   * @property {string} check_id
   * @property {string} check_ref
   * @property {CheckStatus} status
   * @property {string} sender_ref
   * @property {string} recipient_ref
   * @property {bigint} amountUnits
   * @property {"USDT" | "TON"} asset
   * @property {string} claimDigest
   * @property {ChecksScenario} scenario
   * @property {number} createdAt
   * @property {number} expiresAt
   * @property {number | null} resolvedAt
   * @property {number} sequence
   * @property {number} failed_claim_attempts
   */

  /**
   * @param {CheckRecord} check
   * @returns {CheckView}
   */
  function viewOf(check) {
    const open = check.status === "created" || check.status === "awaiting_recipient_kyc";
    return {
      check_id: check.check_id,
      check_ref: check.check_ref,
      check_type: "personal",
      status: check.status,
      sender_ref: check.sender_ref,
      recipient_ref: check.recipient_ref,
      amount: formatAmount(check.asset, check.amountUnits),
      asset: check.asset,
      fee_amount: formatAmount(check.asset, 0n),
      outstanding_amount: formatAmount(check.asset, open ? check.amountUnits : 0n),
      created_at: toIsoSeconds(check.createdAt),
      expires_at: toIsoSeconds(check.expiresAt),
      resolved_at: check.resolvedAt === null ? null : toIsoSeconds(check.resolvedAt),
      sequence: check.sequence,
      failed_claim_attempts: check.failed_claim_attempts,
      posting: "none",
    };
  }

  /**
   * @param {CheckRecord} check
   * @param {number} occurredAt
   */
  function emit(check, occurredAt) {
    check.sequence += 1;
    const scenario = CHECKS_SCENARIOS[check.scenario];
    if (scenario.delivery === "none") {
      return;
    }
    const view = viewOf(check);
    const payload = {
      schema: CHECKS_CALLBACK_SCHEMA,
      environment: SIMULATOR_ENVIRONMENT,
      domain: "checks",
      event_id: random.id("chkevt", "checks-event"),
      check_id: check.check_id,
      check_ref: check.check_ref,
      check_type: "personal",
      sender_ref: check.sender_ref,
      recipient_ref: check.recipient_ref,
      sequence: check.sequence,
      status: check.status,
      amount: view.amount,
      asset: view.asset,
      fee_amount: view.fee_amount,
      outstanding_amount: view.outstanding_amount,
      expires_at: view.expires_at,
      occurred_at: toIsoSeconds(occurredAt),
      posting: "none",
    };
    const deliverAt =
      scenario.delivery === "late"
        ? occurredAt + checkTtlSeconds + random.int("checks-late-delay", 600, 1200)
        : occurredAt;
    queue.schedule(payload, deliverAt);
    if (scenario.delivery === "duplicate") {
      queue.schedule(payload, deliverAt + random.int("checks-duplicate-delay", 30, 120));
    }
  }

  /** @param {CheckRecord} check */
  function expireIfDue(check) {
    const open =
      check.status === "awaiting_confirmation"
      || check.status === "created"
      || check.status === "awaiting_recipient_kyc";
    if (!open || clock.now() <= check.expiresAt) {
      return;
    }
    check.status = "expired";
    check.resolvedAt = check.expiresAt;
    emit(check, check.expiresAt);
  }

  /** @param {string} ref */
  function memberFor(ref) {
    const member = members.get(ref);
    if (!member) {
      throw new ProviderError("invalid_request", `unknown member: ${ref}`);
    }
    return member;
  }

  /** @param {string} checkId */
  function checkFor(checkId) {
    const check = checks.get(checkId);
    if (!check) {
      throw new ProviderError("not_found", "unknown check");
    }
    return check;
  }

  /** @type {ChecksProviderAdapter & { scenarioFor: (ref: string) => ChecksScenario, drainCallbacks: () => import("./simulator-core.mjs").ScheduledDelivery[], pendingCallbacks: () => number }} */
  const simulator = {
    providerId: "simulator",

    scenarioFor(ref) {
      return resolveScenario(scenarios, fallback, SCENARIO_NAMES, ref);
    },

    async previewCheck(request) {
      const input = snapshotRequest(
        request,
        ["check_type", "sender_ref", "recipient_ref", "amount", "asset"],
        ["comment"],
      );
      oneOf(input.check_type, ["personal"], "check_type");
      const senderRef = syntheticReference(input.sender_ref, "sender_ref");
      const recipientRef = syntheticReference(input.recipient_ref, "recipient_ref");
      memberFor(senderRef);
      memberFor(recipientRef);
      const asset = oneOf(input.asset, CHECK_ASSETS, "asset");
      checkComment(input.comment);
      const units = positiveUnits(asset, input.amount);
      const now = clock.now();
      return {
        check_type: "personal",
        recipient_ref: recipientRef,
        amount: formatAmount(asset, units),
        asset,
        fee_amount: formatAmount(asset, 0n),
        preview_reference: random.id("chkref", "checks-preview-ref"),
        expires_at: toIsoSeconds(now + checkTtlSeconds),
        posting: "none",
      };
    },

    async createCheck(request) {
      const input = snapshotRequest(
        request,
        ["check_ref", "check_type", "sender_ref", "recipient_ref", "amount", "asset", "claim_reference", "idempotency_key"],
        ["comment"],
      );
      const checkRef = syntheticReference(input.check_ref, "check_ref");
      oneOf(input.check_type, ["personal"], "check_type");
      const senderRef = syntheticReference(input.sender_ref, "sender_ref");
      const recipientRef = syntheticReference(input.recipient_ref, "recipient_ref");
      const sender = memberFor(senderRef);
      memberFor(recipientRef);
      if (!sender.kyc_verified) {
        throw new ProviderError("invalid_request", "sender is not KYC verified");
      }
      if (senderRef === recipientRef) {
        throw new ProviderError("invalid_request", "sender and recipient must differ");
      }
      const asset = oneOf(input.asset, CHECK_ASSETS, "asset");
      checkComment(input.comment);
      const claimReference = claimReferenceOf(input.claim_reference);
      const units = positiveUnits(asset, input.amount);
      const key = idempotencyKey(input.idempotency_key);
      const scenario = simulator.scenarioFor(checkRef);
      if (scenario === "provider_outage") {
        throw outageError(90);
      }
      return createRegistry.run(key, input, () => {
        const now = clock.now();
        /** @type {CheckRecord} */
        const check = {
          check_id: random.id("chk", "checks-id"),
          check_ref: checkRef,
          status: "awaiting_confirmation",
          sender_ref: senderRef,
          recipient_ref: recipientRef,
          amountUnits: units,
          asset,
          claimDigest: sha256Hex(claimReference),
          scenario,
          createdAt: now,
          expiresAt: now + checkTtlSeconds,
          resolvedAt: null,
          sequence: 0,
          failed_claim_attempts: 0,
        };
        checks.set(check.check_id, check);
        emit(check, now);
        return viewOf(check);
      });
    },

    async issueCheck(request) {
      const input = snapshotRequest(request, ["check_id", "member_ref", "idempotency_key"]);
      const checkId = checkIdentifier(input.check_id);
      const memberRef = syntheticReference(input.member_ref, "member_ref");
      memberFor(memberRef);
      const key = idempotencyKey(input.idempotency_key);
      return issueRegistry.run(key, input, () => {
        const check = checkFor(checkId);
        expireIfDue(check);
        if (memberRef !== check.sender_ref) {
          throw new ProviderError("invalid_request", "only the sender can confirm this check");
        }
        if (check.status !== "awaiting_confirmation") {
          throw new ProviderError("invalid_request", `check is ${check.status}`);
        }
        const recipient = memberFor(check.recipient_ref);
        check.status = recipient.kyc_verified ? "created" : "awaiting_recipient_kyc";
        emit(check, clock.now());
        return viewOf(check);
      });
    },

    async claimCheck(request) {
      const input = snapshotRequest(request, ["check_id", "member_ref", "claim_reference", "idempotency_key"]);
      const checkId = checkIdentifier(input.check_id);
      const memberRef = syntheticReference(input.member_ref, "member_ref");
      const member = memberFor(memberRef);
      const claimReference = claimReferenceOf(input.claim_reference);
      const key = idempotencyKey(input.idempotency_key);
      return claimRegistry.run(key, input, () => {
        const check = checkFor(checkId);
        expireIfDue(check);
        if (memberRef !== check.recipient_ref) {
          throw new ProviderError("invalid_request", "only the named recipient can claim this check");
        }
        if (!member.kyc_verified) {
          throw new ProviderError("invalid_request", "recipient is not KYC verified");
        }
        if (check.status !== "created") {
          throw new ProviderError("invalid_request", `check is ${check.status}`);
        }
        const suppliedDigest = Buffer.from(sha256Hex(claimReference), "utf8");
        const storedDigest = Buffer.from(check.claimDigest, "utf8");
        if (
          suppliedDigest.length !== storedDigest.length
          || !timingSafeEqual(suppliedDigest, storedDigest)
        ) {
          check.failed_claim_attempts += 1;
          throw new ProviderError("invalid_request", "claim reference does not match this check");
        }
        check.status = "claimed";
        check.resolvedAt = clock.now();
        emit(check, clock.now());
        return viewOf(check);
      });
    },

    async cancelCheck(request) {
      const input = snapshotRequest(request, ["check_id", "member_ref", "idempotency_key"]);
      const checkId = checkIdentifier(input.check_id);
      const memberRef = syntheticReference(input.member_ref, "member_ref");
      memberFor(memberRef);
      const key = idempotencyKey(input.idempotency_key);
      return cancelRegistry.run(key, input, () => {
        const check = checkFor(checkId);
        expireIfDue(check);
        if (memberRef !== check.sender_ref) {
          throw new ProviderError("invalid_request", "only the sender can cancel this check");
        }
        if (
          check.status !== "awaiting_confirmation"
          && check.status !== "created"
          && check.status !== "awaiting_recipient_kyc"
        ) {
          throw new ProviderError("invalid_request", `check is ${check.status}`);
        }
        check.status = "cancelled";
        check.resolvedAt = clock.now();
        emit(check, clock.now());
        return viewOf(check);
      });
    },

    async getCheckStatus(checkId) {
      const check = checkFor(checkIdentifier(checkId));
      expireIfDue(check);
      return viewOf(check);
    },

    drainCallbacks() {
      return queue.drain(clock.now());
    },

    pendingCallbacks() {
      return queue.size();
    },
  };
  return Object.freeze(simulator);
}

/**
 * @param {unknown} members
 * @returns {Map<string, CheckMember>}
 */
function validateMembers(members) {
  if (members === undefined || members === null || typeof members !== "object" || Array.isArray(members)) {
    throw new TypeError("members must be an object of sim-* member references");
  }
  const directory = new Map();
  for (const [ref, profile] of Object.entries(members)) {
    if (!SYNTHETIC_REFERENCE.test(ref)) {
      throw new TypeError(`invalid member reference: ${ref}`);
    }
    if (
      profile === null
      || typeof profile !== "object"
      || Array.isArray(profile)
      || Object.keys(profile).length !== 1
      || typeof (/** @type {CheckMember} */ (profile)).kyc_verified !== "boolean"
    ) {
      throw new TypeError(`member profile for ${ref} must contain only kyc_verified`);
    }
    directory.set(ref, { kyc_verified: (/** @type {CheckMember} */ (profile)).kyc_verified });
  }
  if (directory.size === 0) {
    throw new TypeError("members must declare at least one member");
  }
  return directory;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function checkIdentifier(value) {
  if (typeof value !== "string" || !CHECK_ID.test(value)) {
    throw new ProviderError("invalid_request", "check_id must match ^[a-z][a-z0-9_-]{2,127}$");
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function claimReferenceOf(value) {
  if (typeof value !== "string" || !CLAIM_REFERENCE.test(value)) {
    throw new ProviderError("invalid_request", "claim_reference must match ^[A-Za-z0-9._:-]{16,128}$");
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function checkComment(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > 140) {
    throw new ProviderError("invalid_request", "comment must be a string of at most 140 characters");
  }
  return value;
}

/**
 * @param {"USDT" | "TON"} asset
 * @param {unknown} amount
 * @returns {bigint}
 */
function positiveUnits(asset, amount) {
  try {
    return parsePositiveAmount(asset, /** @type {string} */ (amount));
  } catch (error) {
    throw new ProviderError("invalid_request", `amount: ${/** @type {Error} */ (error).message}`);
  }
}
