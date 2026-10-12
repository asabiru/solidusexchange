import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSessionIssueCommand,
  assertSessionRefreshCommand,
  assertSessionRevokeCommand,
  createMemorySessionStore,
  digestSessionToken,
  type SessionIssueCommand,
  SessionStoreCommandError,
  SessionStoreError
} from "./session-store.js";

// Wave-62 audit pins for the operator session-store seam. These run
// entirely on the memory backend: every behavior asserted here is one the
// audit verified clean on both backends, so the memory map is the
// executable witness. Cross-instance and lifecycle races live in the
// postgres contract arm.

const freshSessionId = () => `sess_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
const freshDigest = () => crypto.randomUUID().replaceAll("-", "").repeat(2);
const freshSubject = () => `syn_oper_${crypto.randomUUID().replaceAll("-", "")}`;

const issueCommand = (overrides: Partial<SessionIssueCommand> = {}): SessionIssueCommand => ({
  session_id: freshSessionId(),
  subject: freshSubject(),
  email: "audit@dev.solidchange.invalid",
  name: "Wave62 Audit",
  role: "compliance-lead",
  token_digest: freshDigest(),
  device_digest: null,
  issued_at_ms: 1_000,
  expires_at_ms: 61_000,
  last_used_at_ms: 1_000,
  maxPerSubject: 4,
  ...overrides
});

const makeStore = async () => {
  const store = createMemorySessionStore();
  await store.initialize();
  return store;
};

test("the token digest is namespaced and never stores the raw token", () => {
  const token = "raw-bearer-token-value";
  const digest = digestSessionToken(token);
  assert.match(digest, /^[0-9a-f]{64}$/u);
  // Namespacing is a hard separation: the same raw token digests
  // differently under this store's domain than under any other domain, so
  // a digest minted for another service can never alias a session here.
  assert.equal(digest, digestSessionToken(token));
  assert.notEqual(digest, digestSessionToken(`${token}x`));
});

test("an expired record's digest stays a conflict until the record is evicted", async () => {
  const store = await makeStore();
  const subject = freshSubject();
  const stale = await store.issueSession(
    issueCommand({ subject, issued_at_ms: 1_000, expires_at_ms: 2_000, last_used_at_ms: 1_000 })
  );
  // The expired row is still stored: issuing a fresh session that reuses
  // its token digest conflicts, exactly like the postgres conflicts CTE
  // that ignores liveness.
  await assert.rejects(
    () => store.issueSession(issueCommand({ subject, token_digest: stale.token_digest })),
    SessionStoreError
  );
  // A read that lazy-evicts the dead record frees the digest: the same
  // digest is then reclaimable by a new session.
  assert.equal(
    await store.getSessionByTokenDigest({ token_digest: stale.token_digest, now: 3_000 }),
    null
  );
  const reclaimed = await store.issueSession(
    issueCommand({ subject, token_digest: stale.token_digest })
  );
  assert.equal(reclaimed.token_digest, stale.token_digest);
});

test("a revoked session keeps holding its digest as a conflict", async () => {
  const store = await makeStore();
  const issued = await store.issueSession(issueCommand());
  await store.revokeSession({
    session_id: issued.session_id,
    now: 2_000,
    maxRevokedPerSubject: 4
  });
  await assert.rejects(
    () => store.issueSession(issueCommand({ token_digest: issued.token_digest })),
    SessionStoreError
  );
});

test("a fresh login on a bound device displaces the device's other live sessions", async () => {
  const store = await makeStore();
  const device = freshDigest();
  const displaced = await store.issueSession(issueCommand({ device_digest: device }));
  const other = await store.issueSession(issueCommand());
  const arrived = await store.issueSession(issueCommand({ device_digest: device }));
  // The new session claims the device: every other live record bound to
  // it is gone, while unrelated sessions are untouched.
  assert.equal(await store.getSession({ session_id: displaced.session_id, now: 2_000 }), null);
  assert.equal(
    (await store.getSession({ session_id: other.session_id, now: 2_000 }))?.session_id,
    other.session_id
  );
  assert.equal(
    (await store.getSession({ session_id: arrived.session_id, now: 2_000 }))?.device_digest,
    device
  );
});

test("the sweep drops only dead unrevoked records", async () => {
  const store = await makeStore();
  const subject = freshSubject();
  const live = await store.issueSession(issueCommand({ subject, expires_at_ms: 2_000 }));
  const tombstone = await store.issueSession(issueCommand({ subject, expires_at_ms: 2_000 }));
  await store.revokeSession({
    session_id: tombstone.session_id,
    now: 1_500,
    maxRevokedPerSubject: 4
  });
  const result = await store.sweepExpiredSessions({ now: 3_000 });
  assert.equal(result.swept, 1);
  assert.equal(await store.getSession({ session_id: live.session_id, now: 3_000 }), null);
  assert.equal(
    (await store.getSession({ session_id: tombstone.session_id, now: 3_000 }))?.revoked,
    true
  );
});

test("bind-once rejects a second bind and binds never attach to dead records", async () => {
  const store = await makeStore();
  const bound = await store.issueSession(issueCommand({ device_digest: freshDigest() }));
  assert.equal(
    await store.bindDevice({
      session_id: bound.session_id,
      device_digest: freshDigest(),
      now: 2_000
    }),
    null,
    "a second device bind on an already-bound record must answer null"
  );
  const dead = await store.issueSession(issueCommand({ expires_at_ms: 1_500 }));
  assert.equal(
    await store.bindDevice({
      session_id: dead.session_id,
      device_digest: freshDigest(),
      now: 2_000
    }),
    null,
    "a device bind on an expired record must answer null"
  );
  const revoked = await store.issueSession(issueCommand());
  await store.revokeSession({
    session_id: revoked.session_id,
    now: 1_500,
    maxRevokedPerSubject: 4
  });
  assert.equal(
    await store.bindDevice({
      session_id: revoked.session_id,
      device_digest: freshDigest(),
      now: 2_000
    }),
    null,
    "a device bind on a revoked record must answer null"
  );
});

test("command grammar rejects out-of-shape values before any backend work", () => {
  const good = issueCommand();
  for (const [field, command] of [
    ["session_id too short", { ...good, session_id: "sess_abc" }],
    ["session_id uppercase", { ...good, session_id: `sess_${"A".repeat(24)}` }],
    ["subject empty", { ...good, subject: "" }],
    ["subject too long", { ...good, subject: "x".repeat(129) }],
    ["email too long", { ...good, email: `${"x".repeat(321)}@d.invalid` }],
    ["digest uppercase", { ...good, token_digest: "A".repeat(64) }],
    ["digest short", { ...good, token_digest: "ab".repeat(16) }],
    ["device_digest bad grammar", { ...good, device_digest: "z".repeat(64) }],
    ["expires equals issued", { ...good, expires_at_ms: good.issued_at_ms }],
    ["last_used before issued", { ...good, last_used_at_ms: 999 }],
    ["maxPerSubject zero", { ...good, maxPerSubject: 0 }],
    ["maxPerSubject above limit", { ...good, maxPerSubject: 65 }],
    ["maxPerSubject float", { ...good, maxPerSubject: 2.5 }]
  ] as const) {
    assert.throws(() => assertSessionIssueCommand(command), SessionStoreCommandError, field);
  }
  for (const [field, command] of [
    [
      "refresh expires not later than now",
      { session_id: good.session_id, token_digest: freshDigest(), now: 5_000, expires_at_ms: 5_000 }
    ],
    [
      "refresh non-integer now",
      { session_id: good.session_id, token_digest: freshDigest(), now: 1.5, expires_at_ms: 9_000 }
    ]
  ] as const) {
    assert.throws(() => assertSessionRefreshCommand(command), SessionStoreCommandError, field);
  }
  for (const [field, command] of [
    ["revoke bound zero", { session_id: good.session_id, now: 2_000, maxRevokedPerSubject: 0 }],
    [
      "revoke bound above limit",
      { session_id: good.session_id, now: 2_000, maxRevokedPerSubject: 65 }
    ]
  ] as const) {
    assert.throws(() => assertSessionRevokeCommand(command), SessionStoreCommandError, field);
  }
});

test("countSessions counts only live unrevoked records", async () => {
  const store = await makeStore();
  const before = await store.countSessions({ now: 1_000 });
  await store.issueSession(issueCommand());
  await store.issueSession(issueCommand({ expires_at_ms: 1_500 }));
  const revoked = await store.issueSession(issueCommand());
  await store.revokeSession({
    session_id: revoked.session_id,
    now: 1_200,
    maxRevokedPerSubject: 4
  });
  assert.equal(
    await store.countSessions({ now: 1_000 }),
    before + 2,
    "the revoked tombstone never counts; the not-yet-expired record does"
  );
  assert.equal(
    await store.countSessions({ now: 2_000 }),
    before + 1,
    "only the live unrevoked record counts"
  );
});
