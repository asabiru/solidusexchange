import { createCallbackInbox } from "./callback-inbox.mjs";
import { parsePositiveAmount } from "./decimal.mjs";
import { createSeededRandom, createSimulatedClock, toIsoSeconds } from "./deterministic.mjs";
import { ProviderError, invalidRequest } from "./errors.mjs";
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
  sha256Hex,
  snapshotRequest,
  syntheticReference,
  validateScenarioPlan,
} from "./simulator-core.mjs";

/** @import { JsonValue } from "./canonical-json.mjs" */

/**
 * Provider-neutral KYT adapter (D-011: Ranex or another provider is not
 * selected). Risk output is evidence for a human-owned compliance policy; it
 * never blocks, releases or approves anything by itself.
 *
 * @typedef {object} KytProviderAdapter
 * @property {string} providerId
 * @property {(request: KytScreeningRequest) => Promise<KytAssessment>} screenTransfer
 * @property {(assessmentId: string) => Promise<KytAssessment>} getAssessment
 */

/**
 * @typedef {object} KytScreeningRequest
 * @property {"TON" | "USDT"} asset
 * @property {"TON_TESTNET" | "TRON_TESTNET"} network
 * @property {"inbound" | "outbound"} direction
 * @property {string} address Synthetic counterparty reference (`sim-…`).
 * @property {string} [tx_ref] Synthetic transaction reference (`sim-…`).
 * @property {string} amount Decimal string in the asset scale.
 * @property {string} idempotency_key
 */

/** @typedef {"low" | "medium" | "high" | "severe"} KytRiskLevel */

/**
 * @typedef {object} KytBinding
 * @property {string} asset
 * @property {string} network
 * @property {string} direction
 * @property {string} address
 * @property {string | null} tx_ref
 * @property {string} amount
 */

/**
 * @typedef {object} KytAssessment
 * @property {string} assessment_id
 * @property {"pending" | "completed"} status
 * @property {KytRiskLevel | null} risk_level
 * @property {number | null} risk_score
 * @property {boolean | null} sanctions_hit
 * @property {string[]} categories
 * @property {KytBinding} binding
 * @property {string} binding_digest SHA-256 of the canonical binding.
 * @property {string} assessed_at
 */

export const KYT_SCENARIOS = Object.freeze({
  low: { risk: "low", sanctions: false, delivery: "normal" },
  medium: { risk: "medium", sanctions: false, delivery: "normal" },
  high: { risk: "high", sanctions: false, delivery: "normal" },
  severe: { risk: "severe", sanctions: false, delivery: "normal" },
  sanctions_hit: { risk: "severe", sanctions: true, delivery: "normal" },
  pending_timeout: { risk: null, sanctions: false, delivery: "normal" },
  provider_outage: { risk: null, sanctions: false, delivery: "none" },
  duplicate_callback: { risk: "medium", sanctions: false, delivery: "duplicate" },
  out_of_order_callback: { risk: "medium", sanctions: false, delivery: "out_of_order" },
  late_callback: { risk: "medium", sanctions: false, delivery: "late" },
});

/** @typedef {keyof typeof KYT_SCENARIOS} KytScenario */

const SCENARIO_NAMES = /** @type {KytScenario[]} */ (Object.keys(KYT_SCENARIOS));
const RISK_LEVELS = /** @type {const} */ (["low", "medium", "high", "severe"]);
const RISK_SCORE_RANGES = Object.freeze({
  low: [0, 24],
  medium: [25, 49],
  high: [50, 74],
  severe: [75, 100],
});
const RISK_CATEGORIES = Object.freeze({
  low: [],
  medium: ["SIM_UNVERIFIED_SERVICE"],
  high: ["SIM_MIXER_EXPOSURE"],
  severe: ["SIM_DARKNET_EXPOSURE"],
});
const ALL_CATEGORIES = ["SIM_DARKNET_EXPOSURE", "SIM_MIXER_EXPOSURE", "SIM_SANCTIONS", "SIM_UNVERIFIED_SERVICE"];
/** Testnet-only pairs; mirrors `packages/custody-core/custody-policy.json`. */
export const KYT_ASSET_NETWORKS = Object.freeze([
  Object.freeze({ asset: "TON", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TRON_TESTNET" }),
]);
const DIRECTIONS = /** @type {const} */ (["inbound", "outbound"]);

export const KYT_TRANSITIONS = Object.freeze({
  requested: Object.freeze(["pending", "completed"]),
  pending: Object.freeze(["completed"]),
  completed: Object.freeze([]),
});

export const KYT_CALLBACK_SCHEMA = "solidchange.sim.kyt.callback.v1";
const CALLBACK_KEYS = [
  "assessment_id",
  "binding",
  "binding_digest",
  "categories",
  "domain",
  "environment",
  "event_id",
  "occurred_at",
  "risk_level",
  "risk_score",
  "sanctions_hit",
  "schema",
  "sequence",
  "status",
];
const BINDING_KEYS = ["address", "amount", "asset", "direction", "network", "tx_ref"];

/**
 * @param {KytBinding} binding
 */
export function kytBindingDigest(binding) {
  return sha256Hex(binding);
}

/**
 * @param {Record<string, JsonValue>} payload
 * @returns {string | null}
 */
export function validateKytCallback(payload) {
  const keys = exactKeys(payload, CALLBACK_KEYS);
  if (keys) {
    return keys;
  }
  if (payload.schema !== KYT_CALLBACK_SCHEMA) {
    return "unknown schema";
  }
  if (!isStringMatching(payload.event_id, SIM_ID) || !isStringMatching(payload.assessment_id, SIM_ID)) {
    return "invalid identifiers";
  }
  if (!isPositiveSequence(payload.sequence) || !isIsoSeconds(payload.occurred_at)) {
    return "invalid sequence or occurred_at";
  }
  const binding = payload.binding;
  if (binding === null || typeof binding !== "object" || Array.isArray(binding)) {
    return "invalid binding";
  }
  if (exactKeys(binding, BINDING_KEYS) || bindingError(binding) !== null) {
    return "invalid binding";
  }
  if (payload.binding_digest !== kytBindingDigest(/** @type {any} */ (binding))) {
    return "binding digest mismatch";
  }
  const categories = payload.categories;
  if (
    !Array.isArray(categories) ||
    new Set(categories).size !== categories.length ||
    !categories.every((item) => typeof item === "string" && ALL_CATEGORIES.includes(item))
  ) {
    return "invalid categories";
  }
  if (payload.status === "pending") {
    return payload.risk_level === null &&
      payload.risk_score === null &&
      payload.sanctions_hit === null &&
      categories.length === 0
      ? null
      : "pending assessments carry no risk result";
  }
  if (payload.status !== "completed") {
    return "invalid status";
  }
  const level = /** @type {KytRiskLevel} */ (payload.risk_level);
  if (!RISK_LEVELS.includes(level) || typeof payload.sanctions_hit !== "boolean") {
    return "invalid risk result";
  }
  const [min, max] = RISK_SCORE_RANGES[level];
  const score = payload.risk_score;
  if (typeof score !== "number" || !Number.isSafeInteger(score) || score < min || score > max) {
    return "risk_score does not match risk_level";
  }
  if (payload.sanctions_hit && (level !== "severe" || !categories.includes("SIM_SANCTIONS"))) {
    return "a sanctions hit must be severe and categorized";
  }
  return null;
}

/**
 * @param {Record<string, JsonValue>} binding
 * @returns {string | null}
 */
function bindingError(binding) {
  const pair = KYT_ASSET_NETWORKS.find(
    (entry) => entry.asset === binding.asset && entry.network === binding.network,
  );
  if (!pair) {
    return "asset/network pair is not enabled";
  }
  if (!DIRECTIONS.includes(/** @type {any} */ (binding.direction))) {
    return "invalid direction";
  }
  if (!isStringMatching(binding.address, SYNTHETIC_REFERENCE)) {
    return "invalid address";
  }
  if (binding.tx_ref !== null && !isStringMatching(binding.tx_ref, SYNTHETIC_REFERENCE)) {
    return "invalid tx_ref";
  }
  try {
    parsePositiveAmount(pair.asset, binding.amount);
  } catch {
    return "invalid amount";
  }
  return null;
}

/**
 * @param {Omit<import("./signing.mjs").CallbackVerifierOptions, "domain" | "validatePayload">} options
 */
export function createKytCallbackVerifier(options) {
  return createCallbackVerifier({ ...options, domain: "kyt", validatePayload: validateKytCallback });
}

export function createKytCallbackInbox() {
  return createCallbackInbox({
    subjectField: "assessment_id",
    initialStatus: "requested",
    transitions: KYT_TRANSITIONS,
  });
}

/**
 * @typedef {object} KytSimulatorOptions
 * @property {string} seed
 * @property {import("./signing.mjs").SimulatorKey} key
 * @property {import("./deterministic.mjs").SimulatedClock} [clock]
 * @property {Record<string, KytScenario>} [scenarios] address → scenario.
 * @property {KytScenario} [defaultScenario]
 * @property {number} [screeningTimeoutSeconds]
 */

/**
 * @param {KytSimulatorOptions} options
 */
export function createKytSimulator(options) {
  const random = createSeededRandom(options.seed);
  const clock = options.clock ?? createSimulatedClock();
  const scenarios = validateScenarioPlan(options.scenarios, SCENARIO_NAMES);
  const fallback = options.defaultScenario;
  if (fallback !== undefined && !SCENARIO_NAMES.includes(fallback)) {
    throw new TypeError("unknown default KYT scenario");
  }
  const screeningTimeoutSeconds = options.screeningTimeoutSeconds ?? 900;
  if (!Number.isSafeInteger(screeningTimeoutSeconds) || screeningTimeoutSeconds < 60) {
    throw new RangeError("screeningTimeoutSeconds must be an integer of at least 60");
  }
  const queue = new DeliveryQueue(createCallbackSigner({ key: options.key, domain: "kyt", random }));
  /** @type {IdempotencyRegistry<KytAssessment & { screening_deadline: string }>} */
  const idempotency = new IdempotencyRegistry();
  /** @type {Map<string, { final: KytAssessment, completedAt: number, pending: KytAssessment }>} */
  const assessments = new Map();

  /** @type {KytProviderAdapter & { scenarioFor: (address: string) => KytScenario, drainCallbacks: () => import("./simulator-core.mjs").ScheduledDelivery[], pendingCallbacks: () => number }} */
  const simulator = {
    providerId: "simulator",

    scenarioFor(address) {
      return resolveScenario(scenarios, fallback, SCENARIO_NAMES, address);
    },

    async screenTransfer(request) {
      const input = snapshotRequest(
        request,
        ["asset", "network", "direction", "address", "amount", "idempotency_key"],
        ["tx_ref"],
      );
      /** @type {KytBinding} */
      const binding = {
        asset: String(oneOf(input.asset, ["TON", "USDT"], "asset")),
        network: String(oneOf(input.network, ["TON_TESTNET", "TRON_TESTNET"], "network")),
        direction: oneOf(input.direction, DIRECTIONS, "direction"),
        address: syntheticReference(input.address, "address"),
        tx_ref: input.tx_ref === undefined ? null : syntheticReference(input.tx_ref, "tx_ref"),
        amount: /** @type {string} */ (input.amount),
      };
      const problem = bindingError(/** @type {any} */ (binding));
      if (problem) {
        invalidRequest(problem);
      }
      const key = idempotencyKey(input.idempotency_key);
      const scenario = simulator.scenarioFor(binding.address);
      if (scenario === "provider_outage") {
        throw outageError(30);
      }
      return idempotency.run(key, input, () => {
        const now = clock.now();
        const plan = KYT_SCENARIOS[scenario];
        const assessmentId = random.id("kytasm", "kyt-assessment");
        const bindingDigest = kytBindingDigest(binding);
        const deadline = now + screeningTimeoutSeconds;
        /** @type {KytAssessment} */
        const pending = {
          assessment_id: assessmentId,
          status: "pending",
          risk_level: null,
          risk_score: null,
          sanctions_hit: null,
          categories: [],
          binding,
          binding_digest: bindingDigest,
          assessed_at: toIsoSeconds(now),
        };
        /** @type {{ payload: KytAssessment, occurredAt: number }[]} */
        const events = [{ payload: pending, occurredAt: now + random.int("kyt-ack-delay", 1, 5) }];
        let final = pending;
        let completedAt = now;
        if (plan.risk) {
          const level = /** @type {KytRiskLevel} */ (plan.risk);
          const [min, max] = RISK_SCORE_RANGES[level];
          completedAt =
            plan.delivery === "late"
              ? deadline + random.int("kyt-late-delay", 60, 600)
              : now + random.int("kyt-complete-delay", 10, 60);
          final = {
            ...pending,
            status: "completed",
            risk_level: level,
            risk_score: random.int("kyt-score", min, max),
            sanctions_hit: plan.sanctions,
            categories: plan.sanctions
              ? ["SIM_SANCTIONS", ...RISK_CATEGORIES[level]].sort()
              : [...RISK_CATEGORIES[level]],
            assessed_at: toIsoSeconds(completedAt),
          };
          events.push({ payload: final, occurredAt: completedAt });
        }
        assessments.set(assessmentId, { final, completedAt, pending });
        scheduleTimeline(
          queue,
          events.map((event, index) => ({
            occurredAt: event.occurredAt,
            payload: {
              schema: KYT_CALLBACK_SCHEMA,
              environment: SIMULATOR_ENVIRONMENT,
              domain: "kyt",
              event_id: random.id("kytevt", "kyt-event"),
              assessment_id: assessmentId,
              sequence: index + 1,
              status: event.payload.status,
              risk_level: event.payload.risk_level,
              risk_score: event.payload.risk_score,
              sanctions_hit: event.payload.sanctions_hit,
              categories: event.payload.categories,
              binding: /** @type {any} */ ({ ...binding }),
              binding_digest: bindingDigest,
              occurred_at: toIsoSeconds(event.occurredAt),
            },
          })),
          plan.delivery === "late" ? "normal" : /** @type {import("./simulator-core.mjs").DeliveryMode} */ (plan.delivery),
          random,
        );
        return { ...pending, screening_deadline: toIsoSeconds(deadline) };
      });
    },

    async getAssessment(assessmentId) {
      const entry = assessments.get(assessmentId);
      if (!entry) {
        throw new ProviderError("not_found", "unknown assessment");
      }
      const done = entry.final.status === "completed" && entry.completedAt <= clock.now();
      return structuredClone(done ? entry.final : entry.pending);
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
