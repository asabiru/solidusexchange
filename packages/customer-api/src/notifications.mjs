import { createHash } from "node:crypto";

// Deterministic synthetic notification source. A future notification/feed
// adapter replaces it behind `listFor(subject) -> Promise<NotificationsView>`;
// payloads are frozen and derived from the subject only, so reads stay
// reproducible. Everything is a test-mode draft: delivery stays disabled and
// nothing here sends or touches a real channel.

const NOTIFICATION_TEXTS = Object.freeze({
  session_login: "Тестовый режим. Выполнен вход в SOLID.",
  kyc_submitted: "Тестовый режим. Заявка на проверку личности принята.",
  kyc_in_review: "Тестовый режим. Заявка на проверку личности рассматривается.",
  kyc_approved: "Тестовый режим. Проверка личности пройдена.",
  kyc_rejected: "Тестовый режим. Проверка личности не пройдена.",
  kyc_needs_more_data: "Тестовый режим. Для проверки личности нужны дополнительные данные.",
  kyc_timed_out: "Тестовый режим. Срок рассмотрения заявки истёк.",
  kyc_unavailable: "Тестовый режим. Сервис проверки личности временно недоступен.",
  support_received: "Тестовый режим. Обращение сохранено, его никто не получит.",
  complaint_received: "Тестовый режим. Жалоба сохранена, её никто не получит."
});

/** @typedef {keyof typeof NOTIFICATION_TEXTS} NotificationTemplate */

export const NOTIFICATION_TEMPLATES = /** @type {readonly NotificationTemplate[]} */ (
  Object.freeze(Object.keys(NOTIFICATION_TEXTS))
);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-notifications-v1";
const NOTIFICATION_KEYS = Object.freeze([
  "notification_id",
  "created_at",
  "channel",
  "template",
  "locale",
  "text",
  "mode",
  "delivered",
  "read"
]);
const NOTIFICATION_TYPES = /** @type {Readonly<Record<string, string>>} */ (
  Object.freeze({
    notification_id: "string",
    created_at: "string",
    channel: "string",
    template: "string",
    locale: "string",
    text: "string",
    mode: "string",
    delivered: "boolean",
    read: "boolean"
  })
);
const VIEW_KEYS = Object.freeze(["delivery", "mode", "notifications", "unread"]);
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;

/**
 * @typedef {object} NotificationEntry
 * @property {string} notification_id
 * @property {string} created_at
 * @property {string} channel
 * @property {NotificationTemplate} template
 * @property {string} locale
 * @property {string} text
 * @property {string} mode
 * @property {boolean} delivered
 * @property {boolean} read
 */

/**
 * @typedef {object} NotificationsView
 * @property {string} mode
 * @property {string} delivery
 * @property {number} unread
 * @property {readonly NotificationEntry[]} notifications
 */

/**
 * @typedef {object} NotificationDirectory
 * @property {(subject: string) => Promise<NotificationsView>} listFor
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
 * @returns {NotificationEntry}
 */
function buildNotification(subject, index) {
  const template =
    NOTIFICATION_TEMPLATES[Number(units(subject, `template:${index}`, BigInt(NOTIFICATION_TEMPLATES.length)))];
  return Object.freeze({
    notification_id: `ntf_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    created_at: new Date(
      BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)))
    ).toISOString(),
    channel: "telegram-draft",
    template,
    locale: "ru",
    text: NOTIFICATION_TEXTS[template],
    mode: "test",
    delivered: false,
    read: units(subject, `read:${index}`, 4n) === 0n
  });
}

/**
 * @param {string} subject
 * @returns {NotificationsView}
 */
function buildNotificationsView(subject) {
  const count = 3 + Number(units(subject, "count", 3n));
  const notifications = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildNotification(subject, index)).reverse()
  );
  return Object.freeze({
    mode: "test",
    delivery: "disabled",
    unread: notifications.filter((notification) => !notification.read).length,
    notifications
  });
}

/** @param {unknown} view */
export function validNotificationsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {NotificationsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (
    candidate.mode !== "test" ||
    candidate.delivery !== "disabled" ||
    !Number.isSafeInteger(candidate.unread) ||
    candidate.unread < 0 ||
    !Array.isArray(candidate.notifications)
  ) {
    return false;
  }
  return candidate.notifications.every(
    (notification) =>
      notification !== null &&
      typeof notification === "object" &&
      !Array.isArray(notification) &&
      JSON.stringify(Object.keys(notification).sort()) ===
        JSON.stringify([...NOTIFICATION_KEYS].sort()) &&
      Object.entries(notification).every(([key, value]) => typeof value === NOTIFICATION_TYPES[key])
  );
}

/** @returns {NotificationDirectory} */
export function createSyntheticNotificationDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildNotificationsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
