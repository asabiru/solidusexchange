import { createHash, randomBytes } from "node:crypto";

import {
  StoreCommandError,
  StoreError,
  StoreUnavailableError
} from "./store.mjs";

// Dev-only persistence seam for the customer-api's mutable auth-session
// state, the second domain on the store seam opened by
// `migrations/0001_customer_api_store.sql` (`CUSTOMER_API_STORE`). A session
// record is the durable projection of one dev-mode auth session: an opaque
// `sess_*` handle, the owning subject, the bearer token's sha256 digest —
// the raw token never reaches the store — an optional bound device digest,
// issue/expiry/last-used epoch milliseconds and the revocation marker.
//
// The in-memory model this seam mirrors is the sessions directory's live
// store (issue, lookup by session id or token digest, refresh rotation,
// revoke, expiry sweep, device binding): lookups lazily evict expired
// unrevoked records, revocation is terminal, and per-subject bounds evict
// the subject's oldest active (issue) and oldest revoked (revoke) records
// instead of growing without limit. Every backend answers bit-for-bit
// identically: the same command gets the same record, the same null and
// the same rejection on every implementation.
//
// Dev-only: the seam never holds money movement, ledger postings, custody
// material, credentials or raw tokens — digests and refs only — and no
// production path reads it.

export const AUTH_SESSION_TTL_MS = 3_600_000;
export const AUTH_SESSION_MAX_PER_SUBJECT = 8;
export const AUTH_SESSION_MAX_REVOKED_PER_SUBJECT = 8;
export const AUTH_SESSION_LIST_LIMIT = 32;

const SESSION_ID_PATTERN = /^sess_[0-9a-f]{24}$/u;
const SUBJECT_PATTERN = /^syn_(?:cust|oper)_[a-z0-9]{8,32}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SUBJECT_BOUND_LIMIT = 64;
const TOKEN_DOMAIN = "solidchange-customer-api-auth-session-token-v1";

const NOT_INITIALIZED = "customer-api auth session store is not initialized";

/**
 * @typedef {object} AuthSessionRecord
 * @property {string} session_id Opaque session handle (`sess_` + 24 hex).
 * @property {string} subject Owning synthetic subject ref.
 * @property {string} token_digest sha256 hex of the current bearer token.
 * @property {string | null} device_digest Bound device digest, null until bound.
 * @property {number} issued_at_ms Epoch ms the session was issued.
 * @property {number} expires_at_ms Epoch ms the session ends.
 * @property {number} last_used_at_ms Epoch ms the session was last observed.
 * @property {boolean} revoked Terminal revocation flag.
 * @property {number | null} revoked_at_ms Epoch ms revoked, null while active.
 */

/**
 * @typedef {object} AuthSessionStore
 * @property {string} kind Backend identity for observability (`memory` or `postgresql`).
 * @property {() => Promise<void>} [initialize]
 *   Startup probe run before the server listens; a backend that cannot reach
 *   or recognize its schema must reject so startup fails fast. Calling it
 *   again after `close()` re-opens the backend.
 * @property {(command: AuthSessionIssueCommand) => Promise<AuthSessionRecord>} issueSession
 *   Insert one session atomically: reject a session id or token digest that
 *   any stored record already holds (StoreError), sweep every expired
 *   unrevoked record, and evict the subject's oldest active records beyond
 *   `maxPerSubject` so the bound never grows.
 * @property {(command: {session_id: string, now: number}) => Promise<AuthSessionRecord | null>} getSession
 *   The stored record — including a revoked one — or null when absent; an
 *   expired unrevoked record is evicted and reads as absent.
 * @property {(command: {token_digest: string, now: number}) => Promise<AuthSessionRecord | null>} getSessionByTokenDigest
 *   Same lookup through the token digest index.
 * @property {(command: AuthSessionRefreshCommand) => Promise<AuthSessionRecord | null>} refreshSession
 *   Rotate the bearer digest and extend expiry on a live record; absent,
 *   expired (evicted) or revoked records answer null. A digest another
 *   record already holds is a deterministic StoreError.
 * @property {(command: AuthSessionRevokeCommand) => Promise<AuthSessionRecord | null>} revokeSession
 *   Mark a live record revoked at `now` and evict the subject's oldest
 *   revoked records beyond `maxRevokedPerSubject`; absent, expired or
 *   already-revoked records answer null.
 * @property {(command: AuthSessionBindDeviceCommand) => Promise<AuthSessionRecord | null>} bindDevice
 *   Bind the device digest slot once on a live record; absent, expired,
 *   revoked or already-bound records answer null.
 * @property {(command: {now: number}) => Promise<{swept: number}>} sweepExpiredSessions
 *   Evict every expired unrevoked record; resolves with the count removed.
 * @property {(command: {subject: string, now: number, limit: number}) => Promise<readonly AuthSessionRecord[]>} listSessions
 *   The subject's live records, most recently used first, bounded by `limit`.
 * @property {() => Promise<void>} close
 *   Release the backend's resources; every later operation fails closed as
 *   StoreUnavailableError on every backend.
 */

/**
 * @typedef {object} AuthSessionIssueCommand
 * @property {string} session_id
 * @property {string} subject
 * @property {string} token_digest
 * @property {string | null} device_digest
 * @property {number} issued_at_ms
 * @property {number} expires_at_ms
 * @property {number} last_used_at_ms
 * @property {number} maxPerSubject
 */

/**
 * @typedef {object} AuthSessionRefreshCommand
 * @property {string} session_id
 * @property {string} token_digest New bearer digest the session rotates to.
 * @property {number} now
 * @property {number} expires_at_ms New expiry; must stay ahead of `now`.
 */

/**
 * @typedef {object} AuthSessionRevokeCommand
 * @property {string} session_id
 * @property {number} now
 * @property {number} maxRevokedPerSubject
 */

/**
 * @typedef {object} AuthSessionBindDeviceCommand
 * @property {string} session_id
 * @property {string} device_digest
 * @property {number} now
 */

/**
 * A minted session handle: `sess_` + 24 hex, the same id grammar the
 * contract's synthetic auth-session view pins.
 *
 * @returns {string}
 */
export function mintAuthSessionId() {
  return `sess_${randomBytes(12).toString("hex")}`;
}

/**
 * A minted opaque bearer token for the stored directory: the raw value goes
 * to the caller, only its digest is ever persisted.
 *
 * @returns {string}
 */
export function mintAuthSessionToken() {
  return `sat_${randomBytes(24).toString("hex")}`;
}

/**
 * The persisted form of a bearer token: a namespaced sha256 digest, so the
 * store — and any dump of it — can never authenticate.
 *
 * @param {string} token
 * @returns {string}
 */
export function digestAuthSessionToken(token) {
  return createHash("sha256").update(`${TOKEN_DOMAIN}\n${token}`).digest("hex");
}

/**
 * @param {string} field
 * @param {unknown} value
 * @param {RegExp} pattern
 * @param {string} requirement
 */
function assertPatternField(field, value, pattern, requirement) {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\u0000") ||
    !pattern.test(value)
  ) {
    throw new StoreCommandError(`auth session ${field} ${requirement}`);
  }
}

/**
 * @param {string} field
 * @param {unknown} value
 * @param {boolean} [strictlyPositive]
 */
function assertMsField(field, value, strictlyPositive = true) {
  const floor = strictlyPositive ? 1 : 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < floor) {
    throw new StoreCommandError(
      `auth session ${field} must be a ${strictlyPositive ? "positive" : "non-negative"} safe integer`
    );
  }
}

/**
 * @param {string} field
 * @param {unknown} value
 */
function assertBoundField(field, value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > SUBJECT_BOUND_LIMIT) {
    throw new StoreCommandError(`auth session ${field} must be a safe integer from 1 to ${SUBJECT_BOUND_LIMIT}`);
  }
}

/** @param {AuthSessionIssueCommand} command */
export function assertAuthSessionIssueCommand(command) {
  const { session_id, subject, token_digest, device_digest, issued_at_ms, expires_at_ms, last_used_at_ms, maxPerSubject } =
    command;
  assertPatternField("session_id", session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertPatternField("subject", subject, SUBJECT_PATTERN, "must match syn_(cust|oper)_[a-z0-9]{8,32}");
  assertPatternField("token_digest", token_digest, DIGEST_PATTERN, "must be a 64-character lowercase hex digest");
  if (device_digest !== null) {
    assertPatternField("device_digest", device_digest, DIGEST_PATTERN, "must be null or a 64-character lowercase hex digest");
  }
  assertMsField("issued_at_ms", issued_at_ms);
  assertMsField("expires_at_ms", expires_at_ms);
  if (expires_at_ms <= issued_at_ms) {
    throw new StoreCommandError("auth session expires_at_ms must be later than issued_at_ms");
  }
  assertMsField("last_used_at_ms", last_used_at_ms);
  if (last_used_at_ms < issued_at_ms) {
    throw new StoreCommandError("auth session last_used_at_ms cannot precede issued_at_ms");
  }
  assertBoundField("maxPerSubject", maxPerSubject);
}

/** @param {AuthSessionRefreshCommand} command */
export function assertAuthSessionRefreshCommand(command) {
  const { session_id, token_digest, now, expires_at_ms } = command;
  assertPatternField("session_id", session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertPatternField("token_digest", token_digest, DIGEST_PATTERN, "must be a 64-character lowercase hex digest");
  assertMsField("now", now, false);
  assertMsField("expires_at_ms", expires_at_ms);
  if (expires_at_ms <= now) {
    throw new StoreCommandError("auth session refresh expires_at_ms must be later than now");
  }
}

/** @param {AuthSessionRevokeCommand} command */
export function assertAuthSessionRevokeCommand(command) {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertMsField("now", command.now, false);
  assertBoundField("maxRevokedPerSubject", command.maxRevokedPerSubject);
}

/** @param {AuthSessionBindDeviceCommand} command */
export function assertAuthSessionBindDeviceCommand(command) {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertPatternField("device_digest", command.device_digest, DIGEST_PATTERN, "must be a 64-character lowercase hex digest");
  assertMsField("now", command.now, false);
}

/** @param {{session_id: string, now: number}} command */
export function assertAuthSessionGetCommand(command) {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertMsField("now", command.now, false);
}

/** @param {{token_digest: string, now: number}} command */
export function assertAuthSessionGetByTokenCommand(command) {
  assertPatternField("token_digest", command.token_digest, DIGEST_PATTERN, "must be a 64-character lowercase hex digest");
  assertMsField("now", command.now, false);
}

/** @param {{now: number}} command */
export function assertAuthSessionSweepCommand(command) {
  assertMsField("now", command.now, false);
}

/** @param {{subject: string, now: number, limit: number}} command */
export function assertAuthSessionListCommand(command) {
  assertPatternField("subject", command.subject, SUBJECT_PATTERN, "must match syn_(cust|oper)_[a-z0-9]{8,32}");
  assertMsField("now", command.now, false);
  assertBoundField("limit", command.limit);
}

/**
 * @param {AuthSessionRecord} record
 * @returns {AuthSessionRecord}
 */
function freezeRecord(record) {
  return Object.freeze({ ...record });
}

/**
 * @param {Map<string, AuthSessionRecord>} sessions
 * @param {Map<string, string>} digests
 * @param {AuthSessionRecord} record
 */
function dropRecord(sessions, digests, record) {
  sessions.delete(record.session_id);
  digests.delete(record.token_digest);
}

/**
 * @param {Map<string, AuthSessionRecord>} sessions
 * @param {Map<string, string>} digests
 * @param {number} now
 * @returns {number}
 */
function sweepExpired(sessions, digests, now) {
  let swept = 0;
  for (const record of [...sessions.values()]) {
    if (record.revoked_at_ms === null && record.expires_at_ms <= now) {
      dropRecord(sessions, digests, record);
      swept += 1;
    }
  }
  return swept;
}

/**
 * @param {Map<string, AuthSessionRecord>} sessions
 * @param {Map<string, string>} digests
 * @param {string} subject
 * @param {(record: AuthSessionRecord) => boolean} match
 * @param {number} keep
 */
function evictSubjectOverflow(sessions, digests, subject, match, keep) {
  const survivors = [...sessions.values()]
    .filter((record) => record.subject === subject && match(record))
    .sort(
      (a, b) =>
        (b.revoked_at_ms ?? b.issued_at_ms) - (a.revoked_at_ms ?? a.issued_at_ms) ||
        a.session_id.localeCompare(b.session_id)
    );
  for (const record of survivors.slice(keep)) {
    dropRecord(sessions, digests, record);
  }
}

/**
 * The default backend: the sessions directory's in-process record map behind
 * the seam. Every operation is a synchronous pass over the map — the same
 * atomicity the serialized PostgreSQL backend provides.
 *
 * @returns {AuthSessionStore}
 */
export function createMemoryAuthSessionStore() {
  /** @type {Map<string, AuthSessionRecord>} */
  const sessions = new Map();
  /** @type {Map<string, string>} */
  const digests = new Map();
  let ready = false;

  /**
   * @param {AuthSessionRecord} record
   * @param {number} now
   * @returns {AuthSessionRecord | null}
   */
  function live(record, now) {
    if (record.revoked_at_ms === null && record.expires_at_ms <= now) {
      dropRecord(sessions, digests, record);
      return null;
    }
    return record;
  }

  /**
   * @param {AuthSessionRecord} record
   */
  function index(record) {
    sessions.set(record.session_id, record);
    digests.set(record.token_digest, record.session_id);
  }

  /**
   * @param {AuthSessionRecord} record
   */
  function unindex(record) {
    sessions.delete(record.session_id);
    digests.delete(record.token_digest);
  }

  return Object.freeze({
    kind: "memory",
    async initialize() {
      ready = true;
    },
    /** @param {AuthSessionIssueCommand} command */
    async issueSession(command) {
      assertAuthSessionIssueCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      // Uniqueness pins the whole stored set — expired records included,
      // exactly like the backend's same-snapshot conflict check: an id or
      // token digest any record holds is a deterministic StoreError.
      if (
        sessions.has(command.session_id) ||
        digests.has(command.token_digest)
      ) {
        throw new StoreError("auth session conflicts with a stored record");
      }
      sweepExpired(sessions, digests, command.last_used_at_ms);
      // Evict before indexing so the subject keeps its newest
      // maxPerSubject - 1 actives and the issued record always lands —
      // the same total the backend reaches against its pre-insert
      // snapshot.
      evictSubjectOverflow(
        sessions,
        digests,
        command.subject,
        (record) => record.revoked_at_ms === null,
        command.maxPerSubject - 1
      );
      const stored = freezeRecord({
        session_id: command.session_id,
        subject: command.subject,
        token_digest: command.token_digest,
        device_digest: command.device_digest,
        issued_at_ms: command.issued_at_ms,
        expires_at_ms: command.expires_at_ms,
        last_used_at_ms: command.last_used_at_ms,
        revoked: false,
        revoked_at_ms: null
      });
      index(stored);
      return freezeRecord(stored);
    },
    /** @param {{session_id: string, now: number}} command */
    async getSession(command) {
      assertAuthSessionGetCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      const record = sessions.get(command.session_id);
      const resolved = record === undefined ? null : live(record, command.now);
      return resolved === null ? null : freezeRecord(resolved);
    },
    /** @param {{token_digest: string, now: number}} command */
    async getSessionByTokenDigest(command) {
      assertAuthSessionGetByTokenCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      const id = digests.get(command.token_digest);
      const record = id === undefined ? undefined : sessions.get(id);
      const resolved = record === undefined ? null : live(record, command.now);
      return resolved === null ? null : freezeRecord(resolved);
    },
    /** @param {AuthSessionRefreshCommand} command */
    async refreshSession(command) {
      assertAuthSessionRefreshCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      const record = sessions.get(command.session_id);
      if (record === undefined) {
        return null;
      }
      if (live(record, command.now) === null || record.revoked_at_ms !== null) {
        return null;
      }
      const holder = digests.get(command.token_digest);
      if (holder !== undefined && holder !== command.session_id) {
        throw new StoreError("auth session token digest conflicts with a stored record");
      }
      unindex(record);
      // Refresh extends, never shortens: expiry and last-used only move
      // forward, the same GREATEST the backend's UPDATE applies.
      const rotated = freezeRecord({
        ...record,
        token_digest: command.token_digest,
        expires_at_ms: Math.max(command.expires_at_ms, record.expires_at_ms),
        last_used_at_ms: Math.max(command.now, record.last_used_at_ms)
      });
      index(rotated);
      return freezeRecord(rotated);
    },
    /** @param {AuthSessionRevokeCommand} command */
    async revokeSession(command) {
      assertAuthSessionRevokeCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      const record = sessions.get(command.session_id);
      if (record === undefined) {
        return null;
      }
      if (live(record, command.now) === null || record.revoked_at_ms !== null) {
        return null;
      }
      // Evict before marking so the subject keeps its newest
      // maxRevokedPerSubject revoked records and the revoked record always
      // lands — the same snapshot the backend's CTE orders against.
      evictSubjectOverflow(
        sessions,
        digests,
        record.subject,
        (entry) => entry.revoked_at_ms !== null,
        command.maxRevokedPerSubject
      );
      // revoked_at_ms never precedes issue, the same GREATEST the
      // backend's UPDATE applies.
      const revoked = freezeRecord({
        ...record,
        revoked: true,
        revoked_at_ms: Math.max(command.now, record.issued_at_ms)
      });
      sessions.set(record.session_id, revoked);
      return freezeRecord(revoked);
    },
    /** @param {AuthSessionBindDeviceCommand} command */
    async bindDevice(command) {
      assertAuthSessionBindDeviceCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      const record = sessions.get(command.session_id);
      if (record === undefined) {
        return null;
      }
      if (
        live(record, command.now) === null ||
        record.revoked_at_ms !== null ||
        record.device_digest !== null
      ) {
        return null;
      }
      const bound = freezeRecord({
        ...record,
        device_digest: command.device_digest,
        last_used_at_ms: Math.max(command.now, record.last_used_at_ms)
      });
      sessions.set(record.session_id, bound);
      return freezeRecord(bound);
    },
    /** @param {{now: number}} command */
    async sweepExpiredSessions(command) {
      assertAuthSessionSweepCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      return { swept: sweepExpired(sessions, digests, command.now) };
    },
    /** @param {{subject: string, now: number, limit: number}} command */
    async listSessions(command) {
      assertAuthSessionListCommand(command);
      if (!ready) {
        throw new StoreUnavailableError(NOT_INITIALIZED);
      }
      const records = [...sessions.values()]
        .filter(
          (record) =>
            record.subject === command.subject &&
            record.revoked_at_ms === null &&
            record.expires_at_ms > command.now
        )
        .sort(
          (a, b) =>
            b.last_used_at_ms - a.last_used_at_ms || a.session_id.localeCompare(b.session_id)
        )
        .slice(0, command.limit)
        .map((record) => freezeRecord(record));
      return Object.freeze(records);
    },
    async close() {
      ready = false;
    }
  });
}

/**
 * The sessions directory: the lifecycle surface that consumes the seam. Each
 * method maps to exactly one serialized store call, so the memory backend
 * reproduces in-process ordering and the PostgreSQL backend survives a
 * restart with identical answers. Bearer tokens are minted here and leave
 * only as digests — the store never sees raw token material.
 *
 * @param {{
 *   store: AuthSessionStore,
 *   clock?: () => number,
 *   ttlMs?: number,
 *   maxPerSubject?: number,
 *   maxRevokedPerSubject?: number,
 *   listLimit?: number
 * }} options
 */
export function createStoredAuthSessionDirectory({
  store,
  clock = () => Date.now(),
  ttlMs = AUTH_SESSION_TTL_MS,
  maxPerSubject = AUTH_SESSION_MAX_PER_SUBJECT,
  maxRevokedPerSubject = AUTH_SESSION_MAX_REVOKED_PER_SUBJECT,
  listLimit = AUTH_SESSION_LIST_LIMIT
}) {
  if (typeof store?.issueSession !== "function") {
    throw new Error("An auth session store is required");
  }
  for (const [name, bound] of Object.entries({
    ttlMs,
    maxPerSubject,
    maxRevokedPerSubject,
    listLimit
  })) {
    if (!Number.isSafeInteger(bound) || bound < 1) {
      throw new Error(`Auth session directory ${name} must be a positive integer`);
    }
  }
  return Object.freeze({
    /**
     * @param {{subject: string, deviceDigest?: string | null, now?: number}} options
     * @returns {Promise<{session: AuthSessionRecord, token: string}>}
     */
    async issue({ subject, deviceDigest = null, now = clock() }) {
      const token = mintAuthSessionToken();
      const session = await store.issueSession({
        session_id: mintAuthSessionId(),
        subject,
        token_digest: digestAuthSessionToken(token),
        device_digest: deviceDigest,
        issued_at_ms: now,
        expires_at_ms: now + ttlMs,
        last_used_at_ms: now,
        maxPerSubject
      });
      return Object.freeze({ session, token });
    },
    /**
     * @param {string} sessionId
     * @param {number} [now]
     * @returns {Promise<AuthSessionRecord | null>}
     */
    async getById(sessionId, now = clock()) {
      return store.getSession({ session_id: sessionId, now });
    },
    /**
     * @param {string} tokenDigest
     * @param {number} [now]
     * @returns {Promise<AuthSessionRecord | null>}
     */
    async getByTokenDigest(tokenDigest, now = clock()) {
      return store.getSessionByTokenDigest({ token_digest: tokenDigest, now });
    },
    /**
     * @param {string} sessionId
     * @param {number} [now]
     * @returns {Promise<{session: AuthSessionRecord, token: string} | null>}
     */
    async refresh(sessionId, now = clock()) {
      const token = mintAuthSessionToken();
      const session = await store.refreshSession({
        session_id: sessionId,
        token_digest: digestAuthSessionToken(token),
        now,
        expires_at_ms: now + ttlMs
      });
      return session === null ? null : Object.freeze({ session, token });
    },
    /**
     * @param {string} sessionId
     * @param {number} [now]
     * @returns {Promise<AuthSessionRecord | null>}
     */
    async revoke(sessionId, now = clock()) {
      return store.revokeSession({
        session_id: sessionId,
        now,
        maxRevokedPerSubject
      });
    },
    /**
     * @param {string} sessionId
     * @param {string} deviceDigest
     * @param {number} [now]
     * @returns {Promise<AuthSessionRecord | null>}
     */
    async bindDevice(sessionId, deviceDigest, now = clock()) {
      return store.bindDevice({ session_id: sessionId, device_digest: deviceDigest, now });
    },
    /**
     * @param {number} [now]
     * @returns {Promise<{swept: number}>}
     */
    async sweep(now = clock()) {
      return store.sweepExpiredSessions({ now });
    },
    /**
     * @param {string} subject
     * @param {number} [now]
     * @returns {Promise<readonly AuthSessionRecord[]>}
     */
    async listFor(subject, now = clock()) {
      return store.listSessions({ subject, now, limit: listLimit });
    }
  });
}
