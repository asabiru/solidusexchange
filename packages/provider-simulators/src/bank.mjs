import { createCallbackInbox } from "./callback-inbox.mjs";
import { divideRounded, formatAmount, parseAmount, parsePositiveAmount } from "./decimal.mjs";
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
 * Provider-neutral RUB bank/SBP adapter (D-004: no bank selected). It only
 * creates payment intents and reports what the bank observed. There is
 * deliberately no payout, refund, settlement or ledger-posting method: bank
 * observations are reconciliation inputs, never ledger truth.
 *
 * @typedef {object} BankPaymentAdapter
 * @property {string} providerId
 * @property {(request: PaymentIntentRequest) => Promise<PaymentIntent>} createPaymentIntent
 * @property {(intentId: string) => Promise<PaymentStatus>} getPaymentStatus
 */

/**
 * @typedef {object} PaymentIntentRequest
 * @property {string} intent_ref Synthetic reference (`sim-…`).
 * @property {string} amount RUB decimal string with exactly 2 fraction digits.
 * @property {"RUB"} currency
 * @property {"sbp"} method
 * @property {string} idempotency_key
 */

/**
 * @typedef {object} PaymentIntent
 * @property {string} intent_id
 * @property {string} intent_ref
 * @property {"awaiting_payment"} status
 * @property {string} amount
 * @property {"RUB"} currency
 * @property {"sbp"} method
 * @property {string} payment_reference Synthetic payer-facing reference.
 * @property {string} created_at
 * @property {string} expires_at
 * @property {"none"} posting No ledger effect is produced by this adapter.
 */

/** @typedef {"awaiting_payment" | "payment_received" | "partial_payment" | "duplicate_payment" | "payment_reversed" | "expired_no_payment"} PaymentStatusName */

/**
 * @typedef {object} PaymentStatus
 * @property {string} intent_id
 * @property {PaymentStatusName} status
 * @property {number} sequence
 * @property {string} expected_amount
 * @property {string} received_total Sum of observed incoming payments.
 * @property {string} reversed_total
 * @property {"RUB"} currency
 * @property {"none"} posting
 */

export const BANK_SCENARIOS = Object.freeze({
  payment_found: { events: ["payment_received"], delivery: "normal" },
  payment_not_found: { events: ["expired_no_payment"], delivery: "normal" },
  partial_payment: { events: ["partial_payment"], delivery: "normal" },
  duplicate_payment: { events: ["payment_received", "duplicate_payment"], delivery: "normal" },
  reversed_payment: { events: ["payment_received", "payment_reversed"], delivery: "normal" },
  provider_outage: { events: [], delivery: "none" },
  duplicate_callback: { events: ["payment_received"], delivery: "duplicate" },
  out_of_order_callback: { events: ["payment_received", "payment_reversed"], delivery: "out_of_order" },
  late_callback: { events: ["payment_received"], delivery: "late" },
});

/** @typedef {keyof typeof BANK_SCENARIOS} BankScenario */

const SCENARIO_NAMES = /** @type {BankScenario[]} */ (Object.keys(BANK_SCENARIOS));
const CALLBACK_STATUSES = /** @type {const} */ ([
  "payment_received",
  "partial_payment",
  "duplicate_payment",
  "payment_reversed",
  "expired_no_payment",
]);
const BANK_TX = /^SIMBANK[0-9A-F]{16}$/;

export const BANK_TRANSITIONS = Object.freeze({
  awaiting_payment: Object.freeze(["payment_received", "partial_payment", "expired_no_payment"]),
  payment_received: Object.freeze(["duplicate_payment", "payment_reversed"]),
  partial_payment: Object.freeze(["payment_reversed"]),
  duplicate_payment: Object.freeze(["payment_reversed"]),
  payment_reversed: Object.freeze([]),
  expired_no_payment: Object.freeze([]),
});

export const BANK_CALLBACK_SCHEMA = "solidchange.sim.bank.callback.v1";
const CALLBACK_KEYS = [
  "bank_transaction_id",
  "currency",
  "domain",
  "environment",
  "event_id",
  "expected_amount",
  "intent_id",
  "intent_ref",
  "occurred_at",
  "paid_amount",
  "posting",
  "related_transaction_id",
  "schema",
  "sequence",
  "status",
];

/**
 * @param {Record<string, JsonValue>} payload
 * @returns {string | null}
 */
export function validateBankCallback(payload) {
  const keys = exactKeys(payload, CALLBACK_KEYS);
  if (keys) {
    return keys;
  }
  if (payload.schema !== BANK_CALLBACK_SCHEMA || payload.currency !== "RUB" || payload.posting !== "none") {
    return "unknown schema, currency or posting";
  }
  if (!isStringMatching(payload.event_id, SIM_ID) || !isStringMatching(payload.intent_id, SIM_ID)) {
    return "invalid identifiers";
  }
  if (!isStringMatching(payload.intent_ref, SYNTHETIC_REFERENCE)) {
    return "invalid intent_ref";
  }
  if (!isPositiveSequence(payload.sequence) || !isIsoSeconds(payload.occurred_at)) {
    return "invalid sequence or occurred_at";
  }
  const status = /** @type {(typeof CALLBACK_STATUSES)[number]} */ (payload.status);
  if (!CALLBACK_STATUSES.includes(status)) {
    return "invalid status";
  }
  let expected;
  let paid;
  try {
    expected = parsePositiveAmount("RUB", payload.expected_amount);
    paid = parseAmount("RUB", payload.paid_amount);
  } catch {
    return "invalid amounts";
  }
  const transaction = payload.bank_transaction_id;
  const related = payload.related_transaction_id;
  if (status === "expired_no_payment") {
    return paid === 0n && transaction === null && related === null ? null : "expired intents carry no payment";
  }
  if (!isStringMatching(transaction, BANK_TX)) {
    return "invalid bank_transaction_id";
  }
  if (status === "partial_payment") {
    return paid > 0n && paid < expected && related === null ? null : "partial payment must be below the expected amount";
  }
  if (paid !== expected && status !== "payment_reversed") {
    return "paid amount must equal the expected amount";
  }
  if (status === "payment_received") {
    return related === null ? null : "a first payment has no related transaction";
  }
  if (!isStringMatching(related, BANK_TX) || related === transaction) {
    return "related_transaction_id must reference another bank transaction";
  }
  return paid > 0n && paid <= expected ? null : "invalid reversal amount";
}

/**
 * @param {Omit<import("./signing.mjs").CallbackVerifierOptions, "domain" | "validatePayload">} options
 */
export function createBankCallbackVerifier(options) {
  return createCallbackVerifier({ ...options, domain: "bank", validatePayload: validateBankCallback });
}

export function createBankCallbackInbox() {
  return createCallbackInbox({
    subjectField: "intent_id",
    initialStatus: "awaiting_payment",
    transitions: BANK_TRANSITIONS,
  });
}

/**
 * @typedef {object} BankSimulatorOptions
 * @property {string} seed
 * @property {import("./signing.mjs").SimulatorKey} key
 * @property {import("./deterministic.mjs").SimulatedClock} [clock]
 * @property {Record<string, BankScenario>} [scenarios] intent_ref → scenario.
 * @property {BankScenario} [defaultScenario]
 * @property {number} [intentTtlSeconds]
 */

/**
 * Deterministic RUB/SBP simulator. It produces only synthetic payment-intent
 * and callback records; nothing is posted to any ledger.
 *
 * @param {BankSimulatorOptions} options
 */
export function createBankSimulator(options) {
  const random = createSeededRandom(options.seed);
  const clock = options.clock ?? createSimulatedClock();
  const scenarios = validateScenarioPlan(options.scenarios, SCENARIO_NAMES);
  const fallback = options.defaultScenario;
  if (fallback !== undefined && !SCENARIO_NAMES.includes(fallback)) {
    throw new TypeError("unknown default bank scenario");
  }
  const intentTtlSeconds = options.intentTtlSeconds ?? 900;
  if (!Number.isSafeInteger(intentTtlSeconds) || intentTtlSeconds < 60 || intentTtlSeconds > 86_400) {
    throw new RangeError("intentTtlSeconds must be an integer between 60 and 86400");
  }
  const queue = new DeliveryQueue(createCallbackSigner({ key: options.key, domain: "bank", random }));
  /** @type {IdempotencyRegistry<PaymentIntent>} */
  const idempotency = new IdempotencyRegistry();
  /** @type {Map<string, { intent: PaymentIntent, events: { status: PaymentStatusName, sequence: number, occurredAt: number, paid: bigint }[] }>} */
  const intents = new Map();

  /** @type {BankPaymentAdapter & { scenarioFor: (ref: string) => BankScenario, drainCallbacks: () => import("./simulator-core.mjs").ScheduledDelivery[], pendingCallbacks: () => number }} */
  const simulator = {
    providerId: "simulator",

    scenarioFor(ref) {
      return resolveScenario(scenarios, fallback, SCENARIO_NAMES, ref);
    },

    async createPaymentIntent(request) {
      const input = snapshotRequest(request, ["intent_ref", "amount", "currency", "method", "idempotency_key"]);
      const intentRef = syntheticReference(input.intent_ref, "intent_ref");
      oneOf(input.currency, ["RUB"], "currency");
      oneOf(input.method, ["sbp"], "method");
      let expected;
      try {
        expected = parsePositiveAmount("RUB", input.amount);
      } catch (error) {
        throw new ProviderError("invalid_request", `amount: ${/** @type {Error} */ (error).message}`);
      }
      const key = idempotencyKey(input.idempotency_key);
      const scenario = simulator.scenarioFor(intentRef);
      if (scenario === "provider_outage") {
        throw outageError(120);
      }
      return idempotency.run(key, input, () => {
        const now = clock.now();
        const expiresAt = now + intentTtlSeconds;
        const intentId = random.id("bankint", "bank-intent");
        const plan = BANK_SCENARIOS[scenario];
        /** @type {PaymentIntent} */
        const intent = {
          intent_id: intentId,
          intent_ref: intentRef,
          status: "awaiting_payment",
          amount: formatAmount("RUB", expected),
          currency: "RUB",
          method: "sbp",
          payment_reference: `SIMSBP${random.hex("bank-payment-reference", 6).toUpperCase()}`,
          created_at: toIsoSeconds(now),
          expires_at: toIsoSeconds(expiresAt),
          posting: "none",
        };
        const firstTransaction = `SIMBANK${random.hex("bank-transaction", 8).toUpperCase()}`;
        let previousAt = now;
        const events = plan.events.map((status, index) => {
          const occurredAt =
            status === "expired_no_payment"
              ? expiresAt + 1
              : plan.delivery === "late" && index === 0
                ? expiresAt + random.int("bank-late-delay", 60, 600)
                : previousAt + random.int("bank-event-delay", 20, 240);
          previousAt = occurredAt;
          const paid =
            status === "expired_no_payment"
              ? 0n
              : status === "partial_payment"
                ? divideRounded(expected * BigInt(random.int("bank-partial-percent", 10, 90)), 100n, "down") || 1n
                : expected;
          const transaction =
            status === "expired_no_payment"
              ? null
              : status === "duplicate_payment"
                ? `SIMBANK${random.hex("bank-transaction", 8).toUpperCase()}`
                : status === "payment_reversed"
                  ? `SIMBANK${random.hex("bank-transaction", 8).toUpperCase()}`
                  : firstTransaction;
          return {
            status: /** @type {PaymentStatusName} */ (status),
            sequence: index + 1,
            occurredAt,
            paid,
            transaction,
            related: status === "duplicate_payment" || status === "payment_reversed" ? firstTransaction : null,
          };
        });
        intents.set(intentId, { intent, events });
        scheduleTimeline(
          queue,
          events.map((event) => ({
            occurredAt: event.occurredAt,
            payload: {
              schema: BANK_CALLBACK_SCHEMA,
              environment: SIMULATOR_ENVIRONMENT,
              domain: "bank",
              event_id: random.id("bankevt", "bank-event"),
              intent_id: intentId,
              intent_ref: intentRef,
              sequence: event.sequence,
              status: event.status,
              expected_amount: intent.amount,
              paid_amount: formatAmount("RUB", event.paid),
              currency: "RUB",
              bank_transaction_id: event.transaction,
              related_transaction_id: event.related,
              occurred_at: toIsoSeconds(event.occurredAt),
              posting: "none",
            },
          })),
          plan.delivery === "late" ? "normal" : /** @type {import("./simulator-core.mjs").DeliveryMode} */ (plan.delivery),
          random,
        );
        return intent;
      });
    },

    async getPaymentStatus(intentId) {
      const entry = intents.get(intentId);
      if (!entry) {
        throw new ProviderError("not_found", "unknown payment intent");
      }
      const visible = entry.events.filter((event) => event.occurredAt <= clock.now());
      let received = 0n;
      let reversed = 0n;
      for (const event of visible) {
        if (event.status === "payment_reversed") {
          reversed += event.paid;
        } else {
          received += event.paid;
        }
      }
      const latest = visible.at(-1);
      return {
        intent_id: intentId,
        status: latest ? latest.status : "awaiting_payment",
        sequence: latest ? latest.sequence : 0,
        expected_amount: entry.intent.amount,
        received_total: formatAmount("RUB", received),
        reversed_total: formatAmount("RUB", reversed),
        currency: "RUB",
        posting: "none",
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
