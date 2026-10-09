import { createHash } from "node:crypto";

// Deterministic synthetic support-ticket source. A future support-desk adapter
// replaces it behind `listFor(subject) -> Promise<SupportTicketsView>`;
// payloads are frozen and derived from the subject only, so reads stay
// reproducible. Everything is a test-mode draft: delivery stays disabled and
// nothing here is sent to Telegram, email or any operator. No I/O.

const TICKET_TOPICS = Object.freeze({
  question: "Тестовый режим. Вопрос о работе сервиса.",
  operation_problem: "Тестовый режим. Проблема с операцией.",
  complaint: "Тестовый режим. Жалоба на обслуживание.",
  data_request: "Тестовый режим. Запрос данных аккаунта."
});
const TICKET_MESSAGES = Object.freeze({
  question: "Тестовый режим. Синтетический вопрос, он никуда не отправлен.",
  operation_problem: "Тестовый режим. Синтетическая проблема с операцией, она никуда не отправлена.",
  complaint: "Тестовый режим. Синтетическая жалоба, её никто не получит.",
  data_request: "Тестовый режим. Синтетический запрос данных, он никуда не отправлен."
});

/** @typedef {keyof typeof TICKET_TOPICS} TicketCategory */

export const TICKET_CATEGORIES = /** @type {readonly TicketCategory[]} */ (
  Object.freeze(Object.keys(TICKET_TOPICS))
);
export const TICKET_STATUSES = Object.freeze(["received", "in_review", "answered", "closed"]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-support-v1";
const VIEW_KEYS = Object.freeze(["delivery", "mode", "tickets"]);
const TICKET_KEYS = Object.freeze([
  "ticket_id",
  "category",
  "topic",
  "message",
  "status",
  "timeline",
  "complaint_acknowledged",
  "created_at",
  "expires_at"
]);
const TIMELINE_KEYS = Object.freeze(["at", "status"]);
const TICKET_ID_PATTERN = /^tck_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const TOPIC_MAX_LENGTH = 120;
const MESSAGE_MAX_LENGTH = 1_000;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;
const TIMELINE_STEP_MS = 3_600_000;
const TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * @typedef {object} TicketTimelineEntry
 * @property {string} status
 * @property {string} at
 */

/**
 * @typedef {object} TicketView
 * @property {string} ticket_id
 * @property {string} category
 * @property {string} topic
 * @property {string} message
 * @property {string} status
 * @property {readonly TicketTimelineEntry[]} timeline
 * @property {boolean} complaint_acknowledged
 * @property {string} created_at
 * @property {string} expires_at
 */

/**
 * @typedef {object} SupportTicketsView
 * @property {string} mode
 * @property {string} delivery
 * @property {readonly TicketView[]} tickets
 */

/**
 * @typedef {object} SupportDirectory
 * @property {(subject: string) => Promise<SupportTicketsView>} listFor
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
 * @param {string} subject
 * @param {number} index
 * @returns {TicketView}
 */
function buildTicket(subject, index) {
  const category = TICKET_CATEGORIES[Number(units(subject, `category:${index}`, BigInt(TICKET_CATEGORIES.length)))];
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  const depth = 1 + Number(units(subject, `timeline:${index}`, BigInt(TICKET_STATUSES.length)));
  const statuses = TICKET_STATUSES.slice(0, depth);
  const timeline = Object.freeze(
    statuses.map((status, step) =>
      Object.freeze({ status, at: new Date(createdMs + step * TIMELINE_STEP_MS).toISOString() })
    )
  );
  return Object.freeze({
    ticket_id: `tck_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    category,
    topic: TICKET_TOPICS[category],
    message: TICKET_MESSAGES[category],
    status: statuses[statuses.length - 1],
    timeline,
    complaint_acknowledged: category === "complaint",
    created_at: new Date(createdMs).toISOString(),
    expires_at: new Date(createdMs + TTL_MS).toISOString()
  });
}

/**
 * @param {string} subject
 * @returns {SupportTicketsView}
 */
function buildSupportTicketsView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const tickets = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildTicket(subject, index)).reverse()
  );
  return Object.freeze({
    mode: "test",
    delivery: "disabled",
    tickets
  });
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/** @param {unknown} entry */
function validTimelineEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const candidate = /** @type {TicketTimelineEntry} */ (entry);
  return (
    JSON.stringify(Object.keys(entry).sort()) === JSON.stringify([...TIMELINE_KEYS].sort()) &&
    TICKET_STATUSES.includes(candidate.status) &&
    isIsoTimestamp(candidate.at)
  );
}

/** @param {unknown} view */
export function validSupportTicketsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {SupportTicketsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || candidate.delivery !== "disabled" || !Array.isArray(candidate.tickets)) {
    return false;
  }
  return candidate.tickets.every((ticket) => {
    if (
      ticket === null ||
      typeof ticket !== "object" ||
      Array.isArray(ticket) ||
      JSON.stringify(Object.keys(ticket).sort()) !== JSON.stringify([...TICKET_KEYS].sort()) ||
      !TICKET_ID_PATTERN.test(ticket.ticket_id) ||
      !TICKET_CATEGORIES.includes(ticket.category) ||
      typeof ticket.topic !== "string" ||
      [...ticket.topic].length < 1 ||
      [...ticket.topic].length > TOPIC_MAX_LENGTH ||
      typeof ticket.message !== "string" ||
      [...ticket.message].length < 1 ||
      [...ticket.message].length > MESSAGE_MAX_LENGTH ||
      !TICKET_STATUSES.includes(ticket.status) ||
      !Array.isArray(ticket.timeline) ||
      ticket.timeline.length < 1 ||
      !ticket.timeline.every(validTimelineEntry) ||
      ticket.timeline.at(-1)?.status !== ticket.status ||
      typeof ticket.complaint_acknowledged !== "boolean" ||
      !isIsoTimestamp(ticket.created_at) ||
      !isIsoTimestamp(ticket.expires_at)
    ) {
      return false;
    }
    return true;
  });
}

/** @returns {SupportDirectory} */
export function createSyntheticSupportDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildSupportTicketsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
