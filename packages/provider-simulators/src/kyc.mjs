import { createCallbackInbox } from "./callback-inbox.mjs";
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
  SIM_ID,
  SYNTHETIC_REFERENCE,
  scheduleTimeline,
  snapshotRequest,
  syntheticReference,
  validateScenarioPlan,
} from "./simulator-core.mjs";

/** @import { JsonValue } from "./canonical-json.mjs" */

/**
 * Provider-neutral KYC adapter. A future real adapter (the legacy platform
 * used Sumsub; no provider is selected) implements exactly this shape and
 * delivers decisions through signed callbacks verified with
 * `createKycCallbackVerifier`. Provider statuses are evidence inputs: a human
 * applies the approved policy and records the customer decision.
 *
 * @typedef {object} KycProviderAdapter
 * @property {string} providerId
 * @property {(request: KycSubmissionRequest) => Promise<KycSubmission>} submitApplicant
 * @property {(providerReference: string) => Promise<KycApplicantStatus>} getApplicantStatus
 */

/**
 * @typedef {object} KycSubmissionRequest
 * @property {string} applicant_ref Synthetic, non-PII reference (`sim-…`).
 * @property {KycLevel} level
 * @property {string} idempotency_key
 */

/** @typedef {"basic" | "enhanced"} KycLevel */
/** @typedef {"submitted" | "in_review" | "approved" | "rejected" | "needs_more_data"} KycStatus */

/**
 * @typedef {object} KycSubmission
 * @property {string} provider_reference
 * @property {string} applicant_ref
 * @property {KycLevel} level
 * @property {"submitted"} status
 * @property {string} submitted_at
 * @property {string} review_deadline
 */

/**
 * @typedef {object} KycApplicantStatus
 * @property {string} provider_reference
 * @property {KycStatus} status
 * @property {number} sequence
 * @property {string} updated_at
 */

export const KYC_SCENARIOS = Object.freeze({
  approve: { outcome: "approved", delivery: "normal" },
  reject: { outcome: "rejected", delivery: "normal" },
  needs_more_data: { outcome: "needs_more_data", delivery: "normal" },
  pending_timeout: { outcome: null, delivery: "normal" },
  provider_outage: { outcome: null, delivery: "none" },
  duplicate_callback: { outcome: "approved", delivery: "duplicate" },
  out_of_order_callback: { outcome: "approved", delivery: "out_of_order" },
  late_callback: { outcome: "approved", delivery: "late" },
});

/** @typedef {keyof typeof KYC_SCENARIOS} KycScenario */

const SCENARIO_NAMES = /** @type {KycScenario[]} */ (Object.keys(KYC_SCENARIOS));
const LEVELS = /** @type {const} */ (["basic", "enhanced"]);
const STATUSES = /** @type {const} */ (["in_review", "approved", "rejected", "needs_more_data"]);
const REASON_CODES = /** @type {const} */ (["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"]);
const REQUESTED_ITEMS = /** @type {const} */ (["proof_of_address", "selfie_retake"]);

export const KYC_TRANSITIONS = Object.freeze({
  submitted: Object.freeze(["in_review", "approved", "rejected", "needs_more_data"]),
  in_review: Object.freeze(["approved", "rejected", "needs_more_data"]),
  needs_more_data: Object.freeze([]),
  approved: Object.freeze([]),
  rejected: Object.freeze([]),
});

export const KYC_CALLBACK_SCHEMA = "solidchange.sim.kyc.callback.v1";
const CALLBACK_KEYS = [
  "applicant_ref",
  "domain",
  "environment",
  "event_id",
  "level",
  "occurred_at",
  "provider_reference",
  "reason_codes",
  "requested_items",
  "schema",
  "sequence",
  "status",
];

/**
 * @param {Record<string, JsonValue>} payload
 * @returns {string | null}
 */
export function validateKycCallback(payload) {
  const keys = exactKeys(payload, CALLBACK_KEYS);
  if (keys) {
    return keys;
  }
  if (payload.schema !== KYC_CALLBACK_SCHEMA) {
    return "unknown schema";
  }
  if (!isStringMatching(payload.event_id, SIM_ID) || !isStringMatching(payload.provider_reference, SIM_ID)) {
    return "invalid identifiers";
  }
  if (!isStringMatching(payload.applicant_ref, SYNTHETIC_REFERENCE)) {
    return "invalid applicant_ref";
  }
  if (!LEVELS.includes(/** @type {any} */ (payload.level)) || !STATUSES.includes(/** @type {any} */ (payload.status))) {
    return "invalid level or status";
  }
  if (!isPositiveSequence(payload.sequence) || !isIsoSeconds(payload.occurred_at)) {
    return "invalid sequence or occurred_at";
  }
  if (!isCodeList(payload.reason_codes, REASON_CODES) || !isCodeList(payload.requested_items, REQUESTED_ITEMS)) {
    return "invalid reason codes";
  }
  if ((payload.status === "rejected") !== (/** @type {unknown[]} */ (payload.reason_codes).length > 0)) {
    return "reason_codes are required only for rejections";
  }
  if ((payload.status === "needs_more_data") !== (/** @type {unknown[]} */ (payload.requested_items).length > 0)) {
    return "requested_items are required only for needs_more_data";
  }
  return null;
}

/**
 * @param {JsonValue} value
 * @param {readonly string[]} allowed
 */
function isCodeList(value, allowed) {
  return (
    Array.isArray(value) &&
    value.length <= allowed.length &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && allowed.includes(item))
  );
}

/**
 * @param {Omit<import("./signing.mjs").CallbackVerifierOptions, "domain" | "validatePayload">} options
 */
export function createKycCallbackVerifier(options) {
  return createCallbackVerifier({ ...options, domain: "kyc", validatePayload: validateKycCallback });
}

export function createKycCallbackInbox() {
  return createCallbackInbox({
    subjectField: "provider_reference",
    initialStatus: "submitted",
    transitions: KYC_TRANSITIONS,
  });
}

/**
 * @typedef {object} KycSimulatorOptions
 * @property {string} seed
 * @property {import("./signing.mjs").SimulatorKey} key Per-run key from `generateSimulatorKey`.
 * @property {import("./deterministic.mjs").SimulatedClock} [clock]
 * @property {Record<string, KycScenario>} [scenarios] applicant_ref → scenario.
 * @property {KycScenario} [defaultScenario]
 * @property {number} [reviewTimeoutSeconds]
 */

/**
 * Deterministic, scenario-driven KYC simulator. No network, no real
 * provider, no PII: applicant references must be synthetic.
 *
 * @param {KycSimulatorOptions} options
 */
export function createKycSimulator(options) {
  const random = createSeededRandom(options.seed);
  const clock = options.clock ?? createSimulatedClock();
  const scenarios = validateScenarioPlan(options.scenarios, SCENARIO_NAMES);
  const fallback = options.defaultScenario;
  if (fallback !== undefined && !SCENARIO_NAMES.includes(fallback)) {
    throw new TypeError("unknown default KYC scenario");
  }
  const reviewTimeoutSeconds = options.reviewTimeoutSeconds ?? 3600;
  if (!Number.isSafeInteger(reviewTimeoutSeconds) || reviewTimeoutSeconds < 600) {
    throw new RangeError("reviewTimeoutSeconds must be an integer of at least 600");
  }
  const queue = new DeliveryQueue(createCallbackSigner({ key: options.key, domain: "kyc", random }));
  /** @type {IdempotencyRegistry<KycSubmission>} */
  const idempotency = new IdempotencyRegistry();
  /** @type {Map<string, { status: KycStatus, sequence: number, occurredAt: number }[]>} */
  const timelines = new Map();

  /** @type {KycProviderAdapter & { scenarioFor: (ref: string) => KycScenario, drainCallbacks: () => import("./simulator-core.mjs").ScheduledDelivery[], pendingCallbacks: () => number }} */
  const simulator = {
    providerId: "simulator",

    scenarioFor(ref) {
      return resolveScenario(scenarios, fallback, SCENARIO_NAMES, ref);
    },

    async submitApplicant(request) {
      const input = snapshotRequest(request, ["applicant_ref", "level", "idempotency_key"]);
      const applicantRef = syntheticReference(input.applicant_ref, "applicant_ref");
      const level = oneOf(input.level, LEVELS, "level");
      const key = idempotencyKey(input.idempotency_key);
      const scenario = simulator.scenarioFor(applicantRef);
      if (scenario === "provider_outage") {
        throw outageError(60);
      }
      return idempotency.run(key, input, () => {
        const now = clock.now();
        const providerReference = random.id("kycref", "kyc-reference");
        const deadline = now + reviewTimeoutSeconds;
        const plan = KYC_SCENARIOS[scenario];
        const reviewAt = now + random.int("kyc-review-delay", 30, 90);
        const events = [{ status: /** @type {KycStatus} */ ("in_review"), occurredAt: reviewAt }];
        if (plan.outcome) {
          const decidedAt =
            plan.delivery === "late"
              ? deadline + random.int("kyc-late-delay", 60, 600)
              : reviewAt + random.int("kyc-decision-delay", 60, 300);
          events.push({ status: /** @type {KycStatus} */ (plan.outcome), occurredAt: decidedAt });
        }
        const timeline = events.map((event, index) => ({ ...event, sequence: index + 1 }));
        timelines.set(providerReference, timeline);
        scheduleTimeline(
          queue,
          timeline.map((event) => ({
            occurredAt: event.occurredAt,
            payload: {
              schema: KYC_CALLBACK_SCHEMA,
              environment: SIMULATOR_ENVIRONMENT,
              domain: "kyc",
              event_id: random.id("kycevt", "kyc-event"),
              provider_reference: providerReference,
              applicant_ref: applicantRef,
              level,
              sequence: event.sequence,
              status: event.status,
              reason_codes: event.status === "rejected" ? ["SIM_DOCUMENT_UNREADABLE"] : [],
              requested_items: event.status === "needs_more_data" ? ["proof_of_address"] : [],
              occurred_at: toIsoSeconds(event.occurredAt),
            },
          })),
          plan.delivery === "late" ? "normal" : /** @type {import("./simulator-core.mjs").DeliveryMode} */ (plan.delivery),
          random,
        );
        return {
          provider_reference: providerReference,
          applicant_ref: applicantRef,
          level,
          status: /** @type {const} */ ("submitted"),
          submitted_at: toIsoSeconds(now),
          review_deadline: toIsoSeconds(deadline),
        };
      });
    },

    async getApplicantStatus(providerReference) {
      const timeline = timelines.get(providerReference);
      if (!timeline) {
        throw new ProviderError("not_found", "unknown provider reference");
      }
      const now = clock.now();
      const latest = timeline.filter((event) => event.occurredAt <= now).at(-1);
      return {
        provider_reference: providerReference,
        status: latest ? latest.status : "submitted",
        sequence: latest ? latest.sequence : 0,
        updated_at: toIsoSeconds(latest ? latest.occurredAt : now),
      };
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
