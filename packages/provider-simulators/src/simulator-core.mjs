import { createHash } from "node:crypto";

import { canonicalStringify } from "./canonical-json.mjs";
import { ProviderError, invalidRequest } from "./errors.mjs";

/** @import { JsonValue } from "./canonical-json.mjs" */
/** @import { CallbackSigner } from "./signing.mjs" */
/** @import { SignedDelivery } from "./signing.mjs" */

export const SYNTHETIC_REFERENCE = /^sim-[a-z0-9-]{1,60}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function sha256Hex(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

/**
 * Snapshots a request into a fresh plain record and rejects unknown or
 * missing members. Accessors, symbols and non-plain prototypes are refused so
 * a value cannot change between validation and use.
 *
 * @param {unknown} request
 * @param {readonly string[]} required
 * @param {readonly string[]} [optional]
 * @returns {Record<string, unknown>}
 */
export function snapshotRequest(request, required, optional = []) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    invalidRequest("request must be an object");
  }
  const prototype = Object.getPrototypeOf(request);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(request).length > 0
  ) {
    invalidRequest("request must be a plain object");
  }
  /** @type {Record<string, unknown>} */
  const snapshot = {};
  for (const key of Object.keys(request)) {
    if (!required.includes(key) && !optional.includes(key)) {
      invalidRequest(`unknown request member ${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(request, key);
    if (!descriptor || !("value" in descriptor)) {
      invalidRequest("request members must be data properties");
    }
    if (descriptor.value === undefined) {
      invalidRequest(`request member ${key} must not be undefined`);
    }
    snapshot[key] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(snapshot, key)) {
      invalidRequest(`missing request member ${key}`);
    }
  }
  return snapshot;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
export function syntheticReference(value, name) {
  if (typeof value !== "string" || !SYNTHETIC_REFERENCE.test(value)) {
    invalidRequest(`${name} must be a synthetic reference matching ^sim-[a-z0-9-]{1,60}$`);
  }
  return value;
}

/**
 * @template T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @param {string} name
 * @returns {T}
 */
export function oneOf(value, allowed, name) {
  if (!allowed.includes(/** @type {T} */ (value))) {
    invalidRequest(`${name} is not supported`);
  }
  return /** @type {T} */ (value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function idempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    invalidRequest("idempotency_key must match ^[A-Za-z0-9._:-]{8,128}$");
  }
  return value;
}

/**
 * Exact-replay idempotency: the same key with the same request returns the
 * stored response; the same key with a different request fails closed.
 *
 * @template T
 */
export class IdempotencyRegistry {
  constructor() {
    /** @type {Map<string, { digest: string, response: T }>} */
    this.entries = new Map();
  }

  /**
   * @param {string} key
   * @param {Record<string, unknown>} request
   * @param {() => T} create
   * @returns {T}
   */
  run(key, request, create) {
    const digest = sha256Hex(request);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.digest !== digest) {
        throw new ProviderError(
          "idempotency_conflict",
          "idempotency key was already used with a different request",
        );
      }
      return structuredClone(existing.response);
    }
    const response = create();
    this.entries.set(key, { digest, response: structuredClone(response) });
    return structuredClone(response);
  }
}

/**
 * @template {string} S
 * @param {Readonly<Record<string, S>>} plan
 * @param {S | undefined} fallback
 * @param {readonly S[]} known
 * @param {string} subject
 * @returns {S}
 */
export function resolveScenario(plan, fallback, known, subject) {
  const scenario = Object.hasOwn(plan, subject) ? plan[subject] : fallback;
  if (scenario === undefined || !known.includes(scenario)) {
    throw new ProviderError(
      "scenario_not_configured",
      "no simulator scenario is configured for this subject",
    );
  }
  return scenario;
}

/**
 * @param {unknown} plan
 * @param {readonly string[]} known
 * @returns {Readonly<Record<string, any>>}
 */
export function validateScenarioPlan(plan, known) {
  /** @type {Record<string, string>} */
  const copy = Object.create(null);
  if (plan === undefined) {
    return Object.freeze(copy);
  }
  if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("scenarios must be an object");
  }
  for (const [subject, scenario] of Object.entries(plan)) {
    if (!SYNTHETIC_REFERENCE.test(subject) || !known.includes(scenario)) {
      throw new TypeError(`invalid scenario mapping for ${subject}`);
    }
    copy[subject] = scenario;
  }
  return Object.freeze(copy);
}

/** @param {number} seconds */
export function outageError(seconds = 0) {
  return new ProviderError(
    "provider_unavailable",
    seconds > 0
      ? `simulated provider outage; retry after ${seconds}s`
      : "simulated provider outage",
    { retryable: true },
  );
}

/**
 * @typedef {object} ScheduledDelivery
 * @property {number} deliverAt
 * @property {Record<string, string>} headers
 * @property {Buffer} body
 */

/**
 * Signed callbacks waiting for their simulated delivery time. Signing happens
 * when a callback is scheduled, so outputs do not depend on drain timing.
 */
export class DeliveryQueue {
  /** @param {CallbackSigner} signer */
  constructor(signer) {
    this.signer = signer;
    /** @type {{ deliverAt: number, order: number, delivery: SignedDelivery }[]} */
    this.pending = [];
    this.order = 0;
  }

  /**
   * @param {Record<string, JsonValue>} payload
   * @param {number} deliverAt
   */
  schedule(payload, deliverAt) {
    const delivery = this.signer.sign(payload, deliverAt);
    this.pending.push({ deliverAt, order: this.order, delivery });
    this.order += 1;
  }

  /**
   * Removes and returns deliveries due at or before `now`, in delivery order.
   *
   * @param {number} now
   * @returns {ScheduledDelivery[]}
   */
  drain(now) {
    const due = this.pending
      .filter((entry) => entry.deliverAt <= now)
      .sort((left, right) => left.deliverAt - right.deliverAt || left.order - right.order);
    this.pending = this.pending.filter((entry) => entry.deliverAt > now);
    return due.map(({ deliverAt, delivery }) => ({
      deliverAt,
      headers: { ...delivery.headers },
      body: Buffer.from(delivery.body),
    }));
  }

  size() {
    return this.pending.length;
  }
}

/**
 * Exact-key schema check used by payload validators.
 *
 * @param {Record<string, JsonValue>} payload
 * @param {readonly string[]} keys
 * @returns {string | null}
 */
export function exactKeys(payload, keys) {
  const actual = Object.keys(payload).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return "payload members do not match the schema";
  }
  return null;
}

export const ISO_SECONDS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
export const SIM_ID = /^[a-z]+_[0-9a-f]{32}$/;

/**
 * @param {unknown} value
 */
export function isPositiveSequence(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000;
}

/**
 * @param {unknown} value
 */
export function isIsoSeconds(value) {
  if (typeof value !== "string" || !ISO_SECONDS.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace(".000Z", "Z") === value;
}

/**
 * @param {unknown} value
 * @param {RegExp} pattern
 */
export function isStringMatching(value, pattern) {
  return typeof value === "string" && pattern.test(value);
}

/** @typedef {"normal" | "duplicate" | "out_of_order" | "none"} DeliveryMode */

/**
 * Schedules a subject's provider events according to a delivery mode:
 * `duplicate` re-delivers the final event (same body, new nonce),
 * `out_of_order` delivers the final event before its predecessor and
 * `none` keeps the provider silent.
 *
 * @param {DeliveryQueue} queue
 * @param {{ payload: Record<string, JsonValue>, occurredAt: number }[]} events
 * @param {DeliveryMode} mode
 * @param {import("./deterministic.mjs").SeededRandom} random
 */
export function scheduleTimeline(queue, events, mode, random) {
  if (mode === "none" || events.length === 0) {
    return;
  }
  const last = events[events.length - 1];
  if (mode === "out_of_order" && events.length >= 2) {
    for (const event of events.slice(0, -2)) {
      queue.schedule(event.payload, event.occurredAt);
    }
    const previous = events[events.length - 2];
    queue.schedule(last.payload, last.occurredAt);
    queue.schedule(previous.payload, last.occurredAt + random.int("delivery-reorder", 5, 60));
    return;
  }
  for (const event of events) {
    queue.schedule(event.payload, event.occurredAt);
  }
  if (mode === "duplicate") {
    queue.schedule(last.payload, last.occurredAt + random.int("delivery-duplicate", 30, 120));
  }
}
