import { createHash } from "node:crypto";

// Deterministic synthetic auth-session source. A future sessions adapter
// replaces it behind `listFor(subject) -> Promise<AuthSessionsView>`;
// payloads are frozen and derived from the subject only, so reads stay
// reproducible. Every record is a test-mode auth session held by the
// subject on a customer-facing client — the read is the subject's own
// sign-in surface (the miniapp's /bff/sessions device list). It carries
// session metadata only: an opaque sess_* handle, the owning client
// platform, ISO created/last-seen timestamps, the lifecycle state and a
// current marker — never tokens, secrets or credential material, so
// nothing here can authenticate or authorize anything. No I/O.

// The state set is the auth-session lifecycle: a session is live (active),
// ended by the subject or an operator (revoked), or timed out past its
// expiry (expired). No status implying a money or command effect exists.
export const AUTH_SESSION_STATES = Object.freeze(["active", "revoked", "expired"]);
// The customer-facing client platforms that can hold a customer auth
// session: the operator-web and service platforms can never own one.
export const AUTH_SESSION_PLATFORMS = Object.freeze(["web", "ios", "android", "telegram-mini-app"]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-auth-sessions-v1";
const VIEW_KEYS = Object.freeze(["mode", "sessions"]);
const SESSION_KEYS = Object.freeze([
  "session_id",
  "platform",
  "state",
  "created_at",
  "last_seen_at",
  "current"
]);
const SESSION_ID_PATTERN = /^sess_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * @typedef {object} AuthSessionView
 * @property {string} session_id
 * @property {string} platform
 * @property {string} state
 * @property {string} created_at
 * @property {string} last_seen_at
 * @property {boolean} current
 */

/**
 * @typedef {object} AuthSessionsView
 * @property {string} mode
 * @property {readonly AuthSessionView[]} sessions
 */

/**
 * @typedef {object} AuthSessionDirectory
 * @property {(subject: string) => Promise<AuthSessionsView>} listFor
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
 * @param {boolean} current
 * @returns {AuthSessionView}
 */
function buildAuthSession(subject, index, current) {
  const state = current
    ? "active"
    : AUTH_SESSION_STATES[Number(units(subject, `state:${index}`, BigInt(AUTH_SESSION_STATES.length)))];
  const platform =
    AUTH_SESSION_PLATFORMS[Number(units(subject, `platform:${index}`, BigInt(AUTH_SESSION_PLATFORMS.length)))];
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  // A live session may never have been re-observed since creation; a session
  // that ended (revoked or expired) was necessarily observed after it began.
  const lastSeenMs =
    state === "active"
      ? createdMs + Number(units(subject, `seen:${index}`, 2n)) * HOUR_MS
      : createdMs + (1 + Number(units(subject, `seen:${index}`, 24n))) * HOUR_MS;
  return Object.freeze({
    session_id: `sess_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    platform,
    state,
    created_at: new Date(createdMs).toISOString(),
    last_seen_at: new Date(lastSeenMs).toISOString(),
    current
  });
}

/**
 * @param {string} subject
 * @returns {AuthSessionsView}
 */
function buildAuthSessionsView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const currentIndex = Number(units(subject, "current", BigInt(count)));
  // The caller's own session lists first, then the rest by most recent
  // observation — the ordering the miniapp's device list shows.
  const sessions = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildAuthSession(subject, index, index === currentIndex)).sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at) ||
        Date.parse(b.created_at) - Date.parse(a.created_at)
    )
  );
  return Object.freeze({ mode: "test", sessions });
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/** @param {unknown} session */
function validAuthSession(session) {
  if (session === null || typeof session !== "object" || Array.isArray(session)) {
    return false;
  }
  const candidate = /** @type {AuthSessionView} */ (session);
  if (JSON.stringify(Object.keys(session).sort()) !== JSON.stringify([...SESSION_KEYS].sort())) {
    return false;
  }
  if (
    !SESSION_ID_PATTERN.test(candidate.session_id) ||
    !AUTH_SESSION_PLATFORMS.includes(candidate.platform) ||
    !AUTH_SESSION_STATES.includes(candidate.state) ||
    typeof candidate.current !== "boolean"
  ) {
    return false;
  }
  if (!isIsoTimestamp(candidate.created_at) || !isIsoTimestamp(candidate.last_seen_at)) {
    return false;
  }
  const created = Date.parse(candidate.created_at);
  const lastSeen = Date.parse(candidate.last_seen_at);
  // Lifecycle coherence mirrors the synthetic build: a session cannot be
  // observed before it began, a current session is live by definition, a
  // session that ended was necessarily observed after it began, and a live
  // session may never have been re-observed since creation.
  if (lastSeen < created) {
    return false;
  }
  if (candidate.current && candidate.state !== "active") {
    return false;
  }
  return candidate.state === "active" || lastSeen > created;
}

/** @param {unknown} view */
export function validAuthSessionsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {AuthSessionsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.sessions)) {
    return false;
  }
  // Exactly one session is the caller's own: the current marker identifies
  // the session that made the request, so a directory drifting to zero or
  // several current sessions fails closed.
  if (
    candidate.sessions.filter(
      (session) => session !== null && typeof session === "object" && !Array.isArray(session) && session.current === true
    ).length !== 1
  ) {
    return false;
  }
  return candidate.sessions.every(validAuthSession);
}

/** @returns {AuthSessionDirectory} */
export function createSyntheticAuthSessionDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildAuthSessionsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
