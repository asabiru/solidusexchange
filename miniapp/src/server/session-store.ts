import { createHash, randomBytes } from "node:crypto";

// Dev-only persistence seam for the Mini App BFF's customer-session state,
// ported from the backoffice operator-session seam
// (backoffice/src/server/session-store.ts with the PostgreSQL backend in
// backoffice/src/server/postgres-session-store.ts). A session record is the
// durable projection of one customer session: an opaque `sess_*` id, the
// owning pseudonymous subject, the login source, the session's coarse KYC
// view, the bearer token's sha256 digest — the raw token never reaches the
// store — a reserved device digest slot, issue/expiry/last-used epoch
// milliseconds and the revocation marker.
//
// The in-memory model this seam mirrors is the session map server.ts used
// before (issue, cookie lookup, last-seen touch, lazy KYC sync, revoke,
// logout, lazy expiry, the per-subject session and revoked-handle bounds):
// reads lazily evict expired unrevoked records, revocation keeps a bounded
// tombstone history per subject so a repeated handle revoke stays
// idempotent, a logout or cookie replacement drops the record outright, and
// per-subject bounds evict the subject's oldest records instead of growing
// without limit. Every backend answers bit-for-bit identically: the same
// command gets the same record, the same null and the same rejection on
// every implementation.
//
// Dev-only: the seam never holds money movement, ledger postings, custody
// material, credentials or raw tokens — digests and refs only — and no
// production path reads it.

export const CUSTOMER_SESSION_MAX_PER_SUBJECT = 5;
export const CUSTOMER_SESSION_MAX_REVOKED_PER_SUBJECT = 20;
export const CUSTOMER_SESSION_LIST_LIMIT = 32;

const SESSION_ID_PATTERN = /^sess_[0-9a-f]{24}$/u;
const SUBJECT_PATTERN = /^(dev|tg)-[0-9a-f]{16}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const BEARER_TOKEN_PATTERN = /^smt_[0-9a-f]{64}$/u;
const SUBJECT_BOUND_LIMIT = 64;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const TOKEN_DOMAIN = "solidchange-miniapp-session-token-v1";

export type SessionSource = "telegram" | "dev-synthetic";
export type SessionKyc = "verified" | "kyc-gated";

const SESSION_SOURCES: ReadonlySet<SessionSource> = new Set<SessionSource>([
  "telegram",
  "dev-synthetic"
]);
const SESSION_KYC_STATES: ReadonlySet<SessionKyc> = new Set<SessionKyc>([
  "verified",
  "kyc-gated"
]);

const NOT_INITIALIZED = "miniapp session store is not initialized";

/** Base error for session-store failures; never carries the DSN or credentials. */
export class SessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreError";
  }
}

/** The configured backend cannot be reached or is missing its schema. */
export class SessionStoreUnavailableError extends SessionStoreError {
  constructor(message = "miniapp session store is unavailable") {
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

export interface CustomerSessionRecord {
  /** Opaque session id (`sess_` + 24 hex). */
  session_id: string;
  /** Owning pseudonymous subject (`dev-*` or `tg-*`). */
  subject: string;
  /** How the session was established. */
  source: SessionSource;
  /** The session's coarse KYC view; gated promotes to verified one-way. */
  kyc: SessionKyc;
  /** sha256 hex of the bearer token the cookie carries. */
  token_digest: string;
  /** Reserved device digest slot; nothing binds it yet. */
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
  source: SessionSource;
  kyc: SessionKyc;
  token_digest: string;
  device_digest: string | null;
  issued_at_ms: number;
  expires_at_ms: number;
  last_used_at_ms: number;
  maxPerSubject: number;
}

export interface SessionGetCommand {
  session_id: string;
  now: number;
}

export interface SessionGetByTokenCommand {
  token_digest: string;
  now: number;
}

export interface SessionTouchCommand {
  session_id: string;
  now: number;
}

export interface SessionVerifyKycCommand {
  session_id: string;
  now: number;
}

export interface SessionRevokeCommand {
  session_id: string;
  now: number;
  maxRevokedPerSubject: number;
}

export interface SessionDeleteByTokenCommand {
  token_digest: string;
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
   * unrevoked record, and evict the subject's oldest live records beyond
   * `maxPerSubject` so the bound never grows.
   */
  issueSession(command: SessionIssueCommand): Promise<CustomerSessionRecord>;
  /**
   * The stored record — including a revoked one — or null when absent; an
   * expired unrevoked record is evicted and reads as absent.
   */
  getSession(command: SessionGetCommand): Promise<CustomerSessionRecord | null>;
  /** Same lookup through the token digest index. */
  getSessionByTokenDigest(
    command: SessionGetByTokenCommand
  ): Promise<CustomerSessionRecord | null>;
  /**
   * Move last-used forward on a live record; absent, expired (evicted) or
   * revoked records answer null.
   */
  touchSession(command: SessionTouchCommand): Promise<CustomerSessionRecord | null>;
  /**
   * Mark a live record's KYC view verified; absent, expired (evicted) or
   * revoked records answer null. The transition is one-way.
   */
  verifySessionKyc(command: SessionVerifyKycCommand): Promise<CustomerSessionRecord | null>;
  /**
   * Mark a live record revoked at `now` and evict the subject's oldest
   * revoked records beyond `maxRevokedPerSubject`; absent, expired or
   * already-revoked records answer null.
   */
  revokeSession(command: SessionRevokeCommand): Promise<CustomerSessionRecord | null>;
  /**
   * Drop the record answering a bearer digest entirely — the logout and
   * cookie-replacement path, which keeps no tombstone; absent records
   * answer null.
   */
  deleteSessionByTokenDigest(
    command: SessionDeleteByTokenCommand
  ): Promise<CustomerSessionRecord | null>;
  /** Evict every expired unrevoked record; resolves with the count removed. */
  sweepExpiredSessions(command: SessionSweepCommand): Promise<{ swept: number }>;
  /** The subject's live records, most recently used first, bounded by `limit`. */
  listSessions(command: SessionListCommand): Promise<readonly CustomerSessionRecord[]>;
  /** The subject's revoked unexpired records, most recently revoked first. */
  listRevokedSessions(command: SessionListCommand): Promise<readonly CustomerSessionRecord[]>;
  /** Count of live (unexpired, unrevoked) records at `now`. */
  countSessions(command: SessionCountCommand): Promise<number>;
  /**
   * Release the backend's resources; every later operation fails closed as
   * SessionStoreUnavailableError on every backend.
   */
  close(): Promise<void>;
}

/**
 * A minted session id: `sess_` + 24 hex, the same id grammar the migration's
 * CHECK constraint pins.
 */
export function mintSessionId(): string {
  return `sess_${randomBytes(12).toString("hex")}`;
}

/**
 * A minted opaque bearer token: the raw value goes to the cookie, only its
 * digest is ever persisted.
 */
export function mintSessionToken(): string {
  return `smt_${randomBytes(32).toString("hex")}`;
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
    throw new SessionStoreCommandError(`customer session ${field} ${requirement}`);
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
      `customer session ${field} must be a ${strictlyPositive ? "positive" : "non-negative"} safe integer`
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
      `customer session ${field} must be a safe integer from 1 to ${SUBJECT_BOUND_LIMIT}`
    );
  }
}

function assertSourceField(value: unknown): asserts value is SessionSource {
  if (typeof value !== "string" || !SESSION_SOURCES.has(value as SessionSource)) {
    throw new SessionStoreCommandError("customer session source must be a known session source");
  }
}

function assertKycField(value: unknown): asserts value is SessionKyc {
  if (typeof value !== "string" || !SESSION_KYC_STATES.has(value as SessionKyc)) {
    throw new SessionStoreCommandError("customer session kyc must be a known session kyc state");
  }
}

export function assertSessionIssueCommand(command: SessionIssueCommand): void {
  const {
    session_id,
    subject,
    source,
    kyc,
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
    "must match (dev|tg)-[0-9a-f]{16}"
  );
  assertSourceField(source);
  assertKycField(kyc);
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
    throw new SessionStoreCommandError("customer session expires_at_ms must be later than issued_at_ms");
  }
  assertMsField("last_used_at_ms", last_used_at_ms);
  if (last_used_at_ms < issued_at_ms) {
    throw new SessionStoreCommandError("customer session last_used_at_ms cannot precede issued_at_ms");
  }
  assertBoundField("maxPerSubject", maxPerSubject);
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

export function assertSessionTouchCommand(command: SessionTouchCommand): void {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertMsField("now", command.now, false);
}

export function assertSessionVerifyKycCommand(command: SessionVerifyKycCommand): void {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertMsField("now", command.now, false);
}

export function assertSessionRevokeCommand(command: SessionRevokeCommand): void {
  assertPatternField("session_id", command.session_id, SESSION_ID_PATTERN, "must match sess_[0-9a-f]{24}");
  assertMsField("now", command.now, false);
  assertBoundField("maxRevokedPerSubject", command.maxRevokedPerSubject);
}

export function assertSessionDeleteByTokenCommand(command: SessionDeleteByTokenCommand): void {
  assertPatternField(
    "token_digest",
    command.token_digest,
    DIGEST_PATTERN,
    "must be a 64-character lowercase hex digest"
  );
}

export function assertSessionSweepCommand(command: SessionSweepCommand): void {
  assertMsField("now", command.now, false);
}

export function assertSessionListCommand(command: SessionListCommand): void {
  assertPatternField(
    "subject",
    command.subject,
    SUBJECT_PATTERN,
    "must match (dev|tg)-[0-9a-f]{16}"
  );
  assertMsField("now", command.now, false);
  assertBoundField("limit", command.limit);
}

export function assertSessionCountCommand(command: SessionCountCommand): void {
  assertMsField("now", command.now, false);
}

type StoredSessionRecord = CustomerSessionRecord & { store_seq: number };

function freezeRecord(record: StoredSessionRecord): CustomerSessionRecord {
  const { store_seq: _ordering, ...rest } = record;
  return Object.freeze({ ...rest });
}

function dropRecord(
  sessions: Map<string, StoredSessionRecord>,
  digests: Map<string, string>,
  record: StoredSessionRecord
): void {
  sessions.delete(record.session_id);
  digests.delete(record.token_digest);
}

function sweepExpired(
  sessions: Map<string, StoredSessionRecord>,
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
  sessions: Map<string, StoredSessionRecord>,
  digests: Map<string, string>,
  subject: string,
  match: (record: StoredSessionRecord) => boolean,
  keep: number
): void {
  const survivors = [...sessions.values()]
    .filter((record) => record.subject === subject && match(record))
    .sort(
      (a, b) =>
        b.store_seq - a.store_seq || a.session_id.localeCompare(b.session_id)
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
  const sessions = new Map<string, StoredSessionRecord>();
  const digests = new Map<string, string>();
  let ready = false;
  // Monotonic write counter: issue and revoke claim a fresh value so the
  // per-subject bounds keep the same insertion order the legacy Map had —
  // records minted inside one `now` tick still evict oldest-first.
  let storeSequence = 0;

  function live(record: StoredSessionRecord, now: number): StoredSessionRecord | null {
    if (record.revoked_at_ms === null && record.expires_at_ms <= now) {
      dropRecord(sessions, digests, record);
      return null;
    }
    return record;
  }

  function index(record: StoredSessionRecord): void {
    sessions.set(record.session_id, record);
    digests.set(record.token_digest, record.session_id);
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
      // Uniqueness pins the whole stored set — expired and revoked records
      // included, exactly like the backend's same-snapshot conflict check:
      // an id or token digest any record holds is a deterministic
      // SessionStoreError.
      if (sessions.has(command.session_id) || digests.has(command.token_digest)) {
        throw new SessionStoreError("customer session conflicts with a stored record");
      }
      sweepExpired(sessions, digests, command.last_used_at_ms);
      // Evict before indexing so the subject keeps its newest
      // maxPerSubject - 1 live records and the issued record always lands —
      // the same total the backend reaches against its pre-insert snapshot.
      evictSubjectOverflow(
        sessions,
        digests,
        command.subject,
        (record) => record.revoked_at_ms === null,
        command.maxPerSubject - 1
      );
      const stored: StoredSessionRecord = {
        session_id: command.session_id,
        subject: command.subject,
        source: command.source,
        kyc: command.kyc,
        token_digest: command.token_digest,
        device_digest: command.device_digest,
        issued_at_ms: command.issued_at_ms,
        expires_at_ms: command.expires_at_ms,
        last_used_at_ms: command.last_used_at_ms,
        revoked: false,
        revoked_at_ms: null,
        store_seq: ++storeSequence
      };
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
    async touchSession(command: SessionTouchCommand) {
      assertSessionTouchCommand(command);
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
      // Last-used only moves forward, the same GREATEST the backend's
      // UPDATE applies.
      const touched: StoredSessionRecord = {
        ...record,
        last_used_at_ms: Math.max(command.now, record.last_used_at_ms)
      };
      sessions.set(record.session_id, touched);
      return freezeRecord(touched);
    },
    async verifySessionKyc(command: SessionVerifyKycCommand) {
      assertSessionVerifyKycCommand(command);
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
      const verified: StoredSessionRecord = { ...record, kyc: "verified" };
      sessions.set(record.session_id, verified);
      return freezeRecord(verified);
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
      // maxRevokedPerSubject revoked records including the new one — the
      // same snapshot the backend's CTE orders against.
      evictSubjectOverflow(
        sessions,
        digests,
        record.subject,
        (entry) => entry.revoked_at_ms !== null,
        command.maxRevokedPerSubject - 1
      );
      // revoked_at_ms never precedes issue, the same GREATEST the
      // backend's UPDATE applies. The fresh sequence slot keeps the
      // revoked bound ordered by revoke call, not by issue order.
      const revoked: StoredSessionRecord = {
        ...record,
        revoked: true,
        revoked_at_ms: Math.max(command.now, record.issued_at_ms),
        store_seq: ++storeSequence
      };
      sessions.set(record.session_id, revoked);
      return freezeRecord(revoked);
    },
    async deleteSessionByTokenDigest(command: SessionDeleteByTokenCommand) {
      assertSessionDeleteByTokenCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      const id = digests.get(command.token_digest);
      const record = id === undefined ? undefined : sessions.get(id);
      if (record === undefined) {
        return null;
      }
      dropRecord(sessions, digests, record);
      return freezeRecord(record);
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
    async listRevokedSessions(command: SessionListCommand) {
      assertSessionListCommand(command);
      if (!ready) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED);
      }
      const records = [...sessions.values()]
        .filter(
          (record) =>
            record.subject === command.subject
            && record.revoked_at_ms !== null
            && record.expires_at_ms > command.now
        )
        .sort(
          (a, b) =>
            b.store_seq - a.store_seq || a.session_id.localeCompare(b.session_id)
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

export interface CustomerSessionDirectoryOptions {
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
export function createCustomerSessionDirectory({
  store,
  clock = () => Date.now(),
  ttlMs,
  maxPerSubject = CUSTOMER_SESSION_MAX_PER_SUBJECT,
  maxRevokedPerSubject = CUSTOMER_SESSION_MAX_REVOKED_PER_SUBJECT,
  listLimit = CUSTOMER_SESSION_LIST_LIMIT
}: CustomerSessionDirectoryOptions) {
  if (typeof store?.issueSession !== "function") {
    throw new Error("A customer session store is required");
  }
  if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 1)) {
    throw new Error("Customer session directory ttlMs must be a positive integer");
  }
  const sessionTtlMs = ttlMs ?? 1_800_000;
  for (const [name, bound] of Object.entries({
    maxPerSubject,
    maxRevokedPerSubject,
    listLimit
  })) {
    if (!Number.isSafeInteger(bound) || (bound as number) < 1) {
      throw new Error(`Customer session directory ${name} must be a positive integer`);
    }
  }

  async function resolveToken(
    token: string,
    now: number
  ): Promise<CustomerSessionRecord | null> {
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
      source: SessionSource;
      kyc: SessionKyc;
      now?: number;
    }): Promise<{ session: CustomerSessionRecord; token: string }> {
      const now = options.now ?? clock();
      const token = mintSessionToken();
      const session = await store.issueSession({
        session_id: mintSessionId(),
        subject: options.subject,
        source: options.source,
        kyc: options.kyc,
        token_digest: digestSessionToken(token),
        device_digest: null,
        issued_at_ms: now,
        expires_at_ms: now + sessionTtlMs,
        last_used_at_ms: now,
        maxPerSubject
      });
      return Object.freeze({ session, token });
    },
    async resolve(token: string, now: number = clock()): Promise<CustomerSessionRecord | null> {
      return resolveToken(token, now);
    },
    async touch(
      sessionId: string,
      now: number = clock()
    ): Promise<CustomerSessionRecord | null> {
      return store.touchSession({ session_id: sessionId, now });
    },
    async verifyKyc(
      sessionId: string,
      now: number = clock()
    ): Promise<CustomerSessionRecord | null> {
      return store.verifySessionKyc({ session_id: sessionId, now });
    },
    async revoke(sessionId: string, now: number = clock()): Promise<CustomerSessionRecord | null> {
      return store.revokeSession({ session_id: sessionId, now, maxRevokedPerSubject });
    },
    async revokeByToken(token: string, now: number = clock()): Promise<CustomerSessionRecord | null> {
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
    async dropByToken(token: string): Promise<CustomerSessionRecord | null> {
      if (typeof token !== "string" || !BEARER_TOKEN_PATTERN.test(token)) {
        return null;
      }
      return store.deleteSessionByTokenDigest({ token_digest: digestSessionToken(token) });
    },
    async sweep(now: number = clock()): Promise<{ swept: number }> {
      return store.sweepExpiredSessions({ now });
    },
    async listFor(subject: string, now: number = clock()): Promise<readonly CustomerSessionRecord[]> {
      return store.listSessions({ subject, now, limit: listLimit });
    },
    async listRevoked(subject: string, now: number = clock()): Promise<readonly CustomerSessionRecord[]> {
      return store.listRevokedSessions({ subject, now, limit: listLimit });
    },
    async countLive(now: number = clock()): Promise<number> {
      return store.countSessions({ now });
    }
  });
}
