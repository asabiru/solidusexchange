import { sha256Hex } from "./simulator-core.mjs";

/** @import { JsonValue } from "./canonical-json.mjs" */

/**
 * @typedef {"applied"
 *   | "buffered"
 *   | "duplicate"
 *   | "conflict"
 *   | "stale"
 *   | "late"
 *   | "invalid_transition"
 *   | "unknown_subject"} InboxAction
 */

/**
 * @typedef {object} InboxSubject
 * @property {string} status
 * @property {number} sequence Highest contiguously applied provider sequence.
 * @property {number} deadline Epoch seconds after which new events are late.
 * @property {boolean} timedOut
 * @property {number} lateEvents
 * @property {number} reviewEvents Conflicting or invalid events held for review.
 * @property {number} buffered Events waiting for a missing predecessor.
 */

/**
 * @typedef {object} InboxResult
 * @property {InboxAction} action
 * @property {string | null} status Local projection after this event.
 * @property {string[]} appliedStatuses Statuses applied by this call, in order.
 */

/**
 * @typedef {object} CallbackInbox
 * @property {(subjectId: string, options: { deadline: number }) => void} openSubject
 * @property {(payload: Record<string, JsonValue>, options: { receivedAt: number }) => InboxResult} accept
 * @property {(now: number) => string[]} expire
 * @property {(subjectId: string) => Readonly<InboxSubject> | undefined} get
 */

/**
 * Provider-neutral consumer state for already verified callbacks. It never
 * moves money or posts anything: it only decides whether a verified event may
 * update the local projection, or needs review.
 *
 * - repeated `event_id` with identical content: `duplicate` (no effect);
 * - repeated `event_id` with different content: `conflict` (review);
 * - sequence ahead of the next expected one: `buffered` until the gap fills,
 *   then applied in sequence order (out-of-order delivery);
 * - sequence not newer than the applied one: `stale` (ignored);
 * - received after the subject deadline or local timeout: `late` (review);
 * - status change not in `transitions`: `invalid_transition` (review).
 *
 * @param {{ subjectField: string, initialStatus: string, transitions: Readonly<Record<string, readonly string[]>> }} options
 * @returns {CallbackInbox}
 */
export function createCallbackInbox({ subjectField, initialStatus, transitions }) {
  /** @type {Map<string, InboxSubject & { parked: Map<number, string> }>} */
  const subjects = new Map();
  /** @type {Map<string, string>} */
  const events = new Map();

  /**
   * @param {InboxSubject} subject
   * @param {string} next
   */
  const allowed = (subject, next) =>
    Object.hasOwn(transitions, subject.status) && transitions[subject.status].includes(next);

  return Object.freeze({
    openSubject(subjectId, { deadline }) {
      if (subjects.has(subjectId)) {
        throw new TypeError("subject is already open");
      }
      if (!Number.isSafeInteger(deadline)) {
        throw new TypeError("deadline must be integer epoch seconds");
      }
      subjects.set(subjectId, {
        status: initialStatus,
        sequence: 0,
        deadline,
        timedOut: false,
        lateEvents: 0,
        reviewEvents: 0,
        buffered: 0,
        parked: new Map(),
      });
    },

    accept(payload, { receivedAt }) {
      const subjectId = payload[subjectField];
      const subject = typeof subjectId === "string" ? subjects.get(subjectId) : undefined;
      if (!subject) {
        return { action: "unknown_subject", status: null, appliedStatuses: [] };
      }
      /** @param {InboxAction} action @param {string[]} [appliedStatuses] */
      const result = (action, appliedStatuses = []) => ({ action, status: subject.status, appliedStatuses });
      const eventId = String(payload.event_id);
      const digest = sha256Hex(payload);
      const seen = events.get(eventId);
      if (seen !== undefined) {
        if (seen !== digest) {
          subject.reviewEvents += 1;
          return result("conflict");
        }
        return result("duplicate");
      }
      events.set(eventId, digest);

      if (subject.timedOut || receivedAt > subject.deadline) {
        subject.lateEvents += 1;
        return result("late");
      }
      const sequence = Number(payload.sequence);
      const next = String(payload.status);
      if (sequence <= subject.sequence || subject.parked.has(sequence)) {
        return result("stale");
      }
      if (sequence > subject.sequence + 1) {
        subject.parked.set(sequence, next);
        subject.buffered = subject.parked.size;
        return result("buffered");
      }
      if (!allowed(subject, next)) {
        subject.reviewEvents += 1;
        return result("invalid_transition");
      }
      /** @type {string[]} */
      const applied = [];
      let status = next;
      for (;;) {
        subject.status = status;
        subject.sequence += 1;
        applied.push(status);
        const parked = subject.parked.get(subject.sequence + 1);
        if (parked === undefined) {
          break;
        }
        subject.parked.delete(subject.sequence + 1);
        if (!allowed(subject, parked)) {
          subject.reviewEvents += 1;
          break;
        }
        status = parked;
      }
      subject.buffered = subject.parked.size;
      return result("applied", applied);
    },

    expire(now) {
      const expired = [];
      for (const [subjectId, subject] of subjects) {
        const terminal = !Object.hasOwn(transitions, subject.status) || transitions[subject.status].length === 0;
        if (!subject.timedOut && !terminal && now > subject.deadline) {
          subject.timedOut = true;
          expired.push(subjectId);
        }
      }
      return expired;
    },

    get(subjectId) {
      const subject = subjects.get(subjectId);
      if (!subject) {
        return undefined;
      }
      const { parked: _parked, ...view } = subject;
      return Object.freeze(view);
    },
  });
}
