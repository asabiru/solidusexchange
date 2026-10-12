import { createHash, randomBytes } from "node:crypto";
import type { OperatorRole } from "../auth/access.js";

// Dev-only persistence seam for the backoffice BFF's operator-session state,
// ported from the customer-api auth-session seam
// (packages/customer-api/src/auth-session-store.mjs with the PostgreSQL
// backend in packages/customer-api/src/postgres-store.mjs). A session record
// is the durable projection of one operator session: an opaque `sess_*`
// handle, the owning operator subject, identity fields, the bearer token's
// sha256 digest — the raw token never reaches the store — an optional bound
// device digest, issue/expiry/last-used epoch milliseconds and the
// revocation marker.
//
// The in-memory model this seam mirrors is the session map server.ts used
// before (issue, lookup, revoke, lazy expiry, device displacement on login):
// reads lazily evict expired unrevoked records, revocation is terminal, and
// per-subject bounds evict the subject's oldest active (issue) and oldest
// revoked (revoke) records instead of growing without limit. A fresh login
// on a bound device also evicts the device's other live sessions, exactly
// like the old `deleteWhere(session => session.deviceId === deviceId)`.
// Every backend answers bit-for-bit identically: the same command gets the
// same record, the same null and the same rejection on every implementation.
//
// Dev-only: the seam never holds money movement, ledger postings, custody
// material, credentials or raw tokens — digests and refs only — and no
// production path reads it.

export const OPERATOR_SESSION_MAX_PER_SUBJECT = 8;
export const OPERATOR_SESSION_MAX_REVOKED_PER_SUBJECT = 8;
export const OPERATOR_SESSION_LIST_LIMIT = 32;

const SESSION_ID_PATTERN = /^sess_[0-9a-f]{24}$/u;
const SUBJECT_PATTERN = /^[a-zA-Z0-9_.+:@|-]{1,128}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const BEARER_TOKEN_PATTERN = /^[a-z0-9]+_[0-9a-f]{64}$/u;
const SUBJECT_BOUND_LIMIT = 64;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const EMAIL_MAX_CHARACTERS = 320;
const NAME_MAX_CHARACTERS = 200;
const TOKEN_DOMAIN = "solidchange-backoffice-operator-session-token-v1";

const OPERATOR_ROLES: ReadonlySet<OperatorRole> = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "fraud-investigator",
  "auditor"
]);

const NOT_INITIALIZED = "backoffice session store is not initialized";

/** Base error for session-store failures; never carries the DSN or credentials. */
export class SessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreError";
  }
}

/** The configured backend cannot be reached or is missing its schema. */
export class SessionStoreUnavailableError extends SessionStoreError {
  constructor(message = "backoffice session store is unavailable") {
    super(message);
    this.name = "SessionStoreUnavailableError";
  }
}

/** The store configuration itself is malformed. */
export class SessionStoreConfigError extends SessionStoreError {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreConfigError";
  }
}

/** A command violates the seam contract — caller misuse, not a backend fault. */
export class SessionStoreCommandError extends SessionStoreError {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreCommandError";
  }
}

export interface OperatorSessionRecord {
  /** Opaque session handle (`sess_` + 24 hex). */
  session_id: string;
  /** Owning operator subject (`dev:*`, `syn_oper_*` or an OIDC sub). */
  subject: string;
  email: string;
  name: string;
  role: OperatorRole;
  /** sha256 hex of the current bearer token. */
  token_digest: string;
  /** Bound device digest, null until bound. */
  device_digest: string | null;
  /** Epoch ms the session was issued. */
  issued_at_ms: number;
  /** Epoch ms the session ends. */
  expires_at_ms: number;
  /** Epoch ms the session was last observed. */
  last_used_at_ms: number;
  /** Terminal revocation flag. */
  revoked: boolean;
  /** Epoch ms revoked, null while active. */
  revoked_at_ms: number | null;
}

export interface SessionIssueCommand {
  session_id: string;
  subject: string;
  email: string;
  name: string;
  role: OperatorRole;
  token_digest: string;
  device_digest: string | null;
  issued_at_ms: number;
  expires_at_ms: number;
  last_used_at_ms: number;
  maxPerSubject: number;
}

export interface SessionRefreshCommand {
  session_id: string;
  /** New bearer digest the session rotates to. */
  token_digest: string;
  now: number;
  /** New expiry; must stay ahead of `now`. */
  expires_at_ms: number;
}

export interface SessionRevokeCommand {
  session_id: string;
  now: number;
  maxRevokedPerSubject: number;
}

export interface SessionBindDeviceCommand {
  session_id: string;
  device_digest: string;
  now: number;
}

export interface SessionGetCommand {
  session_id: string;
  now: number;
}

export interface SessionGetByTokenCommand {
  token_digest: string;
  now: number;
}

export interface SessionSweepCommand {
  now: number;
}

export interface SessionListCommand {
  subject: string;
  now: number;
  limit: number;
}

export interface SessionCountCommand {
  now: number;
}

export interface SessionStore {
  /** Backend identity for observability (`memory` or `postgresql`). */
  readonly kind: "memory" | "postgresql";
  /**
   * Startup probe run before the server listens; a backend that cannot reach
   * or recognize its schema must reject so startup fails fast. Calling it
   * again after `close()` re-opens the backend.
   */
  initialize(): Promise<void>;
  /**
   * Insert one session atomically: reject a session id or token digest that
   * any stored record already holds (SessionStoreError), sweep every expired
   * unrevoked record, evict the device's other live sessions when a device
   * digest is bound, and evict the subject's oldest active records beyond
   * `maxPerSubject` so the bound never grows.
   */
  issueSession(command: SessionIssueCommand): Promise<OperatorSessionRecord>;
  /**
   * The stored record — including a revoked one — or null when absent; an
   * expired unrevoked record is evicted and reads as absent.
   */
  getSession(command: SessionGetCommand): Promise<OperatorSessionRecord | null>;
  /** Same lookup through the token digest index. */
  getSessionByTokenDigest(
    command: SessionGetByTokenCommand
  ): Promise<OperatorSessionRecord | null>;
  /**
   * Rotate the bearer digest and extend expiry on a live record; absent,
   * expired (evicted) or revoked records answer null. A digest another
   * record already holds is a deterministic SessionStoreError.
   */
  refreshSession(
    command: SessionRefreshCommand
  ): Promise<OperatorSessionRecord | null>;
  /**
   * Mark a live record revoked at `now` and evict the subject's oldest
   * revoked records beyond `maxRevokedPerSubject`; absent, expired or
   * already-revoked records answer null.
   */
  revokeSession(
    command: SessionRevokeCommand
  ): Promise<OperatorSessionRecord | null>;
  /**
   * Bind the device digest slot once on a live record; absent, expired,
   * revoked or already-bound records answer null.
   */
  bindDevice(
    command: SessionBindDeviceCommand
  ): Promise<OperatorSessionRecord | null>;
  /** Evict every expired unrevoked record; resolves with the count removed. */
  sweepExpiredSessions(command: SessionSweepCommand): Promise<{ swept: number }>;
  /** The subject's live records, most recently used first, bounded by `limit`. */
  listSessions(command: SessionListCommand): Promise<readonly OperatorSessionRecord[]>;
  /** Count of live (unexpired, unrevoked) records at `now`. */
  countSessions(command: SessionCountCommand): Promise<number>;
  /**
   * Release the backend's resources; every later operation fails closed as
   * SessionStoreUnavailableError on every backend.
   */
  close(): Promise<void>;
}

/**
 * A minted session handle: `sess_` + 24 hex, the same id grammar the
 * migration's CHECK constraint pins.
 */
export function mintSessionId(): string {
  return `sess_${randomBytes(12).toString("hex")}`;
}

/**
 * A minted opaque bearer token: the raw value goes to the cookie, only its
 * digest is ever persisted.
 */
export function mintSessionToken(): string {
  return `sbt_${randomBytes(32).toString("hex")}`;
}

/**
 * The persisted form of a bearer token: a namespaced sha256 digest, so the
 * store — and any dump of it — can never authenticate.
 */
export function digestSessionToken(token: string): string {
  return createHash("sha256").update(`${TOKEN_DOMAIN}\n${token}`).digest("hex");
}

function assertPatternField(
  field: string,
  value: unknown,
  pattern: RegExp,
  requirement: string
): asserts value is string {
  if (
    typeof value !== "string"
    || UNPAIRED_SURROGATE.test(value)
    || value.includes("\u0000")
    || !pattern.test(value)
  ) {
    throw new SessionStoreCommandError(`operator session ${field} ${requirement}`);
  }
}

function assertBoundedTextField(
  field: string,
  value: unknown,
  maxCharacters: number
): asserts value is string {
  // Identity fields are informational (the IdP may omit them): empty is
  // valid, only the byte bound and the character hygiene are enforced.
  if (
    typeof value !== "string"
    || value.length > maxCharacters
    || UNPAIRED_SURROGATE.test(value)
    || value.includes("\u0000")
  ) {
    throw new SessionStoreCommandError(
      `operator session ${field} must be a well-formed string of at most ${maxCharacters} characters without NUL`
    );
  }
}

function assertMsField(
  field: string,
  value: unknown,
  strictlyPositive = true
): asserts value is number {
  const floor = strictlyPositive ? 1 : 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < floor) {
    throw new SessionStoreCommandError(
      `operator session ${field} must be a ${strictlyPositive ? "positive" : "non-negative"} safe integer`
    );
  }
}

function assertBoundField(field: string, value: unknown): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > SUBJECT_BOUND_LIMIT
  ) {
    throw new SessionStoreCommandError(
      `operator session ${field} must be a safe integer from 1 to ${SUBJECT_BOUND_LIMIT}`
    );
  }
}

function assertRoleField(value: unknown): asserts value is OperatorRole {
  if (typeof value !== "string" || !OPERATOR_ROLES.has(value as OperatorRole)) {
    throw new SessionStoreCommandError("operator session role must be a known operator role");
  }
}

export function assertSessionIssueCommand(command: SessionIssueCommand): void {
  const {
    session_id,
    subject,
    email,
    name,
    role,
    token_digest,
    device_digest,
    issued_at_ms,
    expires_at_ms,
    last_used_at_ms,
    maxPerSubject
  } = command;
  assertPatternField("session_id", session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertPatternField(
    "subject",
    subject,
    SUBJECT_PATTERN,
    "must be 1-128 characters of [a-zA-Z0-9_.+:@|-]"
  );
  assertBoundedTextField("email", email, EMAIL_MAX_CHARACTERS);
  assertBoundedTextField("name", name, NAME_MAX_CHARACTERS);
  assertRoleField(role);
  assertPatternField("token_digest", token_digest, DIGEST_PATTERN, "must be a 64-character lowercase hex digest");
  if (device_digest !== null) {
    assertPatternField(
      "device_digest",
      device_digest,
      DIGEST_PATTERN,
      "must be null or a 64-character lowercase hex digest"
    );
  }
  assertMsField("issued_at_ms", issued_at_ms);
  assertMsField("expires_at_ms", expires_at_ms);
  if (expires_at_ms <= issued_at_ms) {
    throw new SessionStoreCommandError("operator session expires_at_ms must be later than issued_at_ms");
  }
  assertMsField("last_used_at_ms", last_used_at_ms);
  if (last_used_at_ms < issued_at_ms) {
    throw new SessionStoreCommandError("operator session last_used_at_ms cannot precede issued_at_ms");
  }
  assertBoundField("maxPerSubject", maxPerSubject);
}

export function assertSessionRefreshCommand(command: SessionRefreshCommand): void {
  const { session_id, token_digest, now, expires_at_ms } = command;
  assertPatternField("session_id", session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertPatternField("token_digest", token_digest, DIGEST_PATTERN, "must be a 64-character lowercase hex digest");
  assertMsField("now", now, false);
  assertMsField("expires_at_ms", expires_at_ms);
  if (expires_at_ms <= now) {
    throw new SessionStoreCommandError("operator session refresh expires_at_ms must be later than now");
  }
}

export function assertSessionRevokeCommand(command: SessionRevokeCommand): void {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertMsField("now", command.now, false);
  assertBoundField("maxRevokedPerSubject", command.maxRevokedPerSubject);
}

export function assertSessionBindDeviceCommand(command: SessionBindDeviceCommand): void {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertPatternField(
    "device_digest",
    command.device_digest,
    DIGEST_PATTERN,
    "must be a 64-character lowercase hex digest"
  );
  assertMsField("now", command.now, false);
}

export function assertSessionGetCommand(command: SessionGetCommand): void {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertMsField("now", command.now, false);
}

export function assertSessionGetByTokenCommand(command: SessionGetByTokenCommand): void {
  assertPatternField(
    "token_digest",
    command.token_digest,
    DIGEST_PATTERN,
    "must be a 64-character lowercase hex digest"
  );
  assertMsField("now", command.now, false);
}

export function assertSessionSweepCommand(command: SessionSweepCommand): void {
  assertMsField("now", command.now, false);
}

export function assertSessionListCommand(command: SessionListCommand): void {
  assertPatternField(
    "subject",
    command.subject,
    SUBJECT_PATTERN,
    "must be 1-128 characters of [a-zA-Z0-9_.+:@|-]"
  );
  assertMsField("now", command.now, false);
  assertBoundField("limit", command.limit);
}

export function assertSessionCountCommand(command: SessionCountCommand): void {
  assertMsField("now", command.now, false);
}

function freezeRecord(record: OperatorSessionRecord): OperatorSessionRecord {
  return Object.freeze({ ...record });
}

function dropRecord(
  sessions: Map<string, OperatorSessionRecord>,
  digests: Map<string, string>,
  record: OperatorSessionRecord
): void {
  sessions.delete(record.session_id);
  digests.delete(record.token_digest);
}

function sweepExpired(
  sessions: Map<string, OperatorSessionRecord>,
  digests: Map<string, string>,
  now: number
): number {
  let swept = 0;
  for (const record of [...sessions.values()]) {
    if (record.revoked_at_ms === null && record.expires_at_ms <= now) {
      dropRecord(sessions, digests, record);
      swept += 1;
    }
  }
  return swept;
}

function evictSubjectOverflow(
  sessions: Map<string, OperatorSessionRecord>,
  digests: Map<string, string>,
  subject: string,
  match: (record: OperatorSessionRecord) => boolean,
  keep: number
): void {
  const survivors = [...sessions.values()]
    .filter((record) => record.subject === subject && match(record))
    .sort(
      (a, b) =>
        (b.revoked_at_ms ?? b.issued_at_ms) - (a.revoked_at_ms ?? a.issued_at_ms)
        || a.session_id.localeCompare(b.session_id)
    );
  for (const record of survivors.slice(keep)) {
    dropRecord(sessions, digests, record);
  }
}

/**
 * The default backend: the BFF's in-process session map behind the seam.
 * Every operation is a synchronous pass over the map — the same atomicity
 * the serialized PostgreSQL backend provides.
 */
export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, OperatorSessionRecord>();
  const digests = new Map<string, string>();
  let ready = false;

  function live(record: OperatorSessionRecord, now: number): OperatorSessionRecord | null {
    if (record.revoked_at_ms === null && record.expires_at_ms <= now) {
      dropRecord(sessions, digests, record);
      return null;
    }
    return record;
  }

  function index(record: OperatorSessionRecord): void {
    sessions.set(record.session_id, record);
    digests.set(record.token_digest, record.session_id);
  }

  function unindex(record: OperatorSessionRecord): void {
    sessions.delete(record.session_id);
    digests.delete(record.token_digest);
  }

  return Object.freeze({
    kind: "memory",
    async initialize() {
      ready = true;
    },
    async issueSession(command: SessionIssueCommand) {
      assertSessionIssueCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      // Uniqueness pins the whole stored set — expired records included,
      // exactly like the backend's same-snapshot conflict check: an id or
      // token digest any record holds is a deterministic SessionStoreError.
      if (sessions.has(command.session_id) || digests.has(command.token_digest)) {
        throw new SessionStoreError("operator session conflicts with a stored record");
      }
      sweepExpired(sessions, digests, command.last_used_at_ms);
      // A fresh login on a bound device displaces the device's other live
      // sessions — the old deleteWhere(deviceId match) before set.
      if (command.device_digest !== null) {
        for (const record of [...sessions.values()]) {
          if (record.revoked_at_ms === null && record.device_digest === command.device_digest) {
            dropRecord(sessions, digests, record);
          }
        }
      }
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
        email: command.email,
        name: command.name,
        role: command.role,
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
    async getSession(command: SessionGetCommand) {
      assertSessionGetCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      const record = sessions.get(command.session_id);
      const resolved = record === undefined ? null : live(record, command.now);
      return resolved === null ? null : freezeRecord(resolved);
    },
    async getSessionByTokenDigest(command: SessionGetByTokenCommand) {
      assertSessionGetByTokenCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      const id = digests.get(command.token_digest);
      const record = id === undefined ? undefined : sessions.get(id);
      const resolved = record === undefined ? null : live(record, command.now);
      return resolved === null ? null : freezeRecord(resolved);
    },
    async refreshSession(command: SessionRefreshCommand) {
      assertSessionRefreshCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
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
        throw new SessionStoreError("operator session token digest conflicts with a stored record");
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
    async revokeSession(command: SessionRevokeCommand) {
      assertSessionRevokeCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
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
    async bindDevice(command: SessionBindDeviceCommand) {
      assertSessionBindDeviceCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      const record = sessions.get(command.session_id);
      if (record === undefined) {
        return null;
      }
      if (
        live(record, command.now) === null
        || record.revoked_at_ms !== null
        || record.device_digest !== null
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
    async sweepExpiredSessions(command: SessionSweepCommand) {
      assertSessionSweepCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      return { swept: sweepExpired(sessions, digests, command.now) };
    },
    async listSessions(command: SessionListCommand) {
      assertSessionListCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      const records = [...sessions.values()]
        .filter(
          (record) =>
            record.subject === command.subject
            && record.revoked_at_ms === null
            && record.expires_at_ms > command.now
        )
        .sort(
          (a, b) =>
            b.last_used_at_ms - a.last_used_at_ms || a.session_id.localeCompare(b.session_id)
        )
        .slice(0, command.limit)
        .map((record) => freezeRecord(record));
      return Object.freeze(records);
    },
    async countSessions(command: SessionCountCommand) {
      assertSessionCountCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      let count = 0;
      for (const record of sessions.values()) {
        if (record.revoked_at_ms === null && record.expires_at_ms > command.now) {
          count += 1;
        }
      }
      return count;
    },
    async close() {
      ready = false;
    }
  });
}

/**
 * The operator-session view the BFF consumes — the same fields the old
 * in-memory OperatorSession carried, plus the immutable session handle and
 * the bound device digest (never the raw device id).
 */
export interface OperatorSession {
  id: string;
  subject: string;
  email: string;
  name: string;
  role: OperatorRole;
  deviceDigest: string | null;
  expiresAt: number;
}

function toOperatorSession(record: OperatorSessionRecord): OperatorSession {
  return Object.freeze({
    id: record.session_id,
    subject: record.subject,
    email: record.email,
    name: record.name,
    role: record.role,
    deviceDigest: record.device_digest,
    expiresAt: record.expires_at_ms
  });
}

export interface OperatorSessionDirectoryOptions {
  store: SessionStore;
  clock?: () => number;
  ttlMs?: number;
  maxPerSubject?: number;
  maxRevokedPerSubject?: number;
  listLimit?: number;
}

/**
 * The sessions directory: the lifecycle surface that consumes the seam. Each
 * method maps to exactly one store call, so the memory backend reproduces
 * in-process ordering and the PostgreSQL backend survives a restart with
 * identical answers. Bearer tokens are minted here and leave only as
 * digests — the store never sees raw token material.
 */
export function createOperatorSessionDirectory({
  store,
  clock = () => Date.now(),
  ttlMs,
  maxPerSubject = OPERATOR_SESSION_MAX_PER_SUBJECT,
  maxRevokedPerSubject = OPERATOR_SESSION_MAX_REVOKED_PER_SUBJECT,
  listLimit = OPERATOR_SESSION_LIST_LIMIT
}: OperatorSessionDirectoryOptions) {
  if (typeof store?.issueSession !== "function") {
    throw new Error("An operator session store is required");
  }
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 1)) {
    throw new Error("Operator session directory ttlMs must be a positive integer");
  }
  const sessionTtlMs = ttlMs ?? 900_000;
  for (const [name, bound] of Object.entries({
    maxPerSubject,
    maxRevokedPerSubject,
    listLimit
  })) {
    if (!Number.isSafeInteger(bound) || (bound as number) < 1) {
      throw new Error(`Operator session directory ${name} must be a positive integer`);
    }
  }

  async function resolveToken(
    token: string,
    now: number
  ): Promise<OperatorSessionRecord | null> {
    // The bearer travels in a cookie, so arbitrary garbage can reach here:
    // anything outside the minted grammar is simply not a session, exactly
    // like a miss in the old map — never a store rejection.
    if (typeof token !== "string" || !BEARER_TOKEN_PATTERN.test(token)) {
      return null;
    }
    const record = await store.getSessionByTokenDigest({
      token_digest: digestSessionToken(token),
      now
    });
    // A revoked record still reads back from the store; for callers it is
    // gone — revocation is terminal, exactly like the old map delete.
    return record === null || record.revoked ? null : record;
  }

  return Object.freeze({
    async issue(options: {
      subject: string;
      email: string;
      name: string;
      role: OperatorRole;
      deviceDigest?: string | null;
      now?: number;
    }): Promise<{ session: OperatorSession; token: string }> {
      const now = options.now ?? clock();
      const token = mintSessionToken();
      const session = await store.issueSession({
        session_id: mintSessionId(),
        subject: options.subject,
        email: options.email,
        name: options.name,
        role: options.role,
        token_digest: digestSessionToken(token),
        device_digest: options.deviceDigest ?? null,
        issued_at_ms: now,
        expires_at_ms: now + sessionTtlMs,
        last_used_at_ms: now,
        maxPerSubject
      });
      return Object.freeze({ session: toOperatorSession(session), token });
    },
    async resolve(token: string, now: number = clock()): Promise<OperatorSession | null> {
      const record = await resolveToken(token, now);
      return record === null ? null : toOperatorSession(record);
    },
    async refresh(
      sessionId: string,
      now: number = clock()
    ): Promise<{ session: OperatorSession; token: string } | null> {
      const token = mintSessionToken();
      const session = await store.refreshSession({
        session_id: sessionId,
        token_digest: digestSessionToken(token),
        now,
        expires_at_ms: now + sessionTtlMs
      });
      return session === null ? null : Object.freeze({ session: toOperatorSession(session), token });
    },
    async revoke(sessionId: string, now: number = clock()): Promise<OperatorSessionRecord | null> {
      return store.revokeSession({ session_id: sessionId, now, maxRevokedPerSubject });
    },
    async revokeByToken(token: string, now: number = clock()): Promise<OperatorSessionRecord | null> {
      const record = await resolveToken(token, now);
      if (record === null) {
        return null;
      }
      return store.revokeSession({
        session_id: record.session_id,
        now,
        maxRevokedPerSubject
      });
    },
    async bindDevice(
      sessionId: string,
      deviceDigest: string,
      now: number = clock()
    ): Promise<OperatorSessionRecord | null> {
      return store.bindDevice({ session_id: sessionId, device_digest: deviceDigest, now });
    },
    async sweep(now: number = clock()): Promise<{ swept: number }> {
      return store.sweepExpiredSessions({ now });
    },
    async listFor(subject: string, now: number = clock()): Promise<readonly OperatorSessionRecord[]> {
      return store.listSessions({ subject, now, limit: listLimit });
    },
    async countLive(now: number = clock()): Promise<number> {
      return store.countSessions({ now });
    }
  });
}
