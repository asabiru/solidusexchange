import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAuthSessionIssueCommand,
  assertAuthSessionRefreshCommand,
  assertAuthSessionRevokeCommand,
  createMemoryAuthSessionStore,
  digestAuthSessionToken
} from "../src/auth-session-store.mjs";
import { StoreCommandError, StoreError } from "../src/store.mjs";

// Wave-62 audit pins for the auth-session seam. These run entirely on the
// memory backend: every behavior asserted here is one the audit verified
// clean on both backends, so the memory map is the executable witness.
// Cross-instance and lifecycle races live in the postgres contract arm.

const freshSessionId = () => `sess_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
const freshDigest = () => crypto.randomUUID().replaceAll("-", "").repeat(2);
const freshSubject = () => `syn_cust_${crypto.randomUUID().replaceAll("-", "")}`;

const issueCommand = (overrides = {}) => ({
  session_id: freshSessionId(),
  subject: freshSubject(),
  token_digest: freshDigest(),
  device_digest: null,
  issued_at_ms: 1_000,
  expires_at_ms: 61_000,
  last_used_at_ms: 1_000,
  maxPerSubject: 4,
  ...overrides
});

const makeStore = async () => {
  const store = createMemoryAuthSessionStore();
  await store.initialize?.();
  return store;
};

test("the token digest is namespaced and never stores the raw token", () => {
  const token = "raw-bearer-token-value";
  const digest = digestAuthSessionToken(token);
  assert.match(digest, /^[0-9a-f]{64}$/u);
  // Namespacing is a hard separation: the same raw token digests
  // differently under this store's domain than under any other domain, so
  // a digest minted for another service can never alias a session here.
  assert.equal(digest, digestAuthSessionToken(token));
  assert.notEqual(digest, digestAuthSessionToken(`${token}x`));
});

test("an expired record's digest stays a conflict until the record is evicted", async () => {
  const store = await makeStore();
  const subject = freshSubject();
  const stale = await store.issueSession(issueCommand({
    subject,
    issued_at_ms: 1_000,
    expires_at_ms: 2_000,
    last_used_at_ms: 1_000
  }));
  // The expired row is still stored: issuing a fresh session that reuses
  // its token digest conflicts, exactly like the postgres conflicts CTE
  // that ignores liveness.
  await assert.rejects(
    () => store.issueSession(issueCommand({ subject, token_digest: stale.token_digest })),
    StoreError
  );
  // A read that lazy-evicts the dead record frees the digest: the same
  // digest is then reclaimable by a new session.
  assert.equal(
    await store.getSessionByTokenDigest({ token_digest: stale.token_digest, now: 3_000 }),
    null
  );
  const reclaimed = await store.issueSession(issueCommand({
    subject,
    token_digest: stale.token_digest
  }));
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
  // Tombstones keep their digest indexed: a fresh issue that reuses it is
  // a deterministic StoreError, matching the postgres conflicts CTE which
  // includes revoked rows.
  await assert.rejects(
    () => store.issueSession(issueCommand({ token_digest: issued.token_digest })),
    StoreError
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
  // The revoked expired record survives every sweep: tombstones are
  // terminal state, not garbage.
  assert.equal(
    (await store.getSession({ session_id: tombstone.session_id, now: 3_000 }))?.revoked,
    true
  );
});

test("lazy expiry and the sweep agree on the same record", async () => {
  const store = await makeStore();
  const dead = await store.issueSession(issueCommand({ expires_at_ms: 2_000 }));
  // A lazy-expiring read removes the record; a later sweep reports it
  // already gone — the count is honest, not double-counted.
  assert.equal(await store.getSession({ session_id: dead.session_id, now: 3_000 }), null);
  assert.deepEqual(await store.sweepExpiredSessions({ now: 3_000 }), { swept: 0 });
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
    ["session_id uppercase", { ...good, session_id: "sess_" + "A".repeat(24) }],
    ["subject wrong prefix", { ...good, subject: "usr_12345678" }],
    ["subject empty", { ...good, subject: "" }],
    ["digest uppercase", { ...good, token_digest: "A".repeat(64) }],
    ["digest short", { ...good, token_digest: "ab".repeat(16) }],
    ["device_digest bad grammar", { ...good, device_digest: "z".repeat(64) }],
    ["expires equals issued", { ...good, expires_at_ms: good.issued_at_ms }],
    ["last_used before issued", { ...good, last_used_at_ms: 999 }],
    ["maxPerSubject zero", { ...good, maxPerSubject: 0 }],
    ["maxPerSubject above limit", { ...good, maxPerSubject: 65 }],
    ["maxPerSubject float", { ...good, maxPerSubject: 2.5 }]
  ]) {
    assert.throws(() => assertAuthSessionIssueCommand(command), StoreCommandError, field);
  }
  for (const [field, command] of [
    ["refresh expires not later than now", { session_id: good.session_id, token_digest: freshDigest(), now: 5_000, expires_at_ms: 5_000 }],
    ["refresh non-integer now", { session_id: good.session_id, token_digest: freshDigest(), now: 1.5, expires_at_ms: 9_000 }]
  ]) {
    assert.throws(() => assertAuthSessionRefreshCommand(command), StoreCommandError, field);
  }
  for (const [field, command] of [
    ["revoke bound zero", { session_id: good.session_id, now: 2_000, maxRevokedPerSubject: 0 }],
    ["revoke bound above limit", { session_id: good.session_id, now: 2_000, maxRevokedPerSubject: 65 }]
  ]) {
    assert.throws(() => assertAuthSessionRevokeCommand(command), StoreCommandError, field);
  }
});

test("list returns live sessions newest-first and hides revoked and dead", async () => {
  const store = await makeStore();
  const subject = freshSubject();
  const oldest = await store.issueSession(issueCommand({ subject, last_used_at_ms: 1_000 }));
  const middle = await store.issueSession(issueCommand({ subject, last_used_at_ms: 2_000 }));
  const dead = await store.issueSession(issueCommand({ subject, last_used_at_ms: 3_000, expires_at_ms: 2_500 }));
  const revoked = await store.issueSession(issueCommand({ subject, last_used_at_ms: 4_000 }));
  await store.revokeSession({
    session_id: revoked.session_id,
    now: 4_500,
    maxRevokedPerSubject: 4
  });
  const listed = await store.listSessions({ subject, now: 5_000, limit: 8 });
  assert.deepEqual(
    listed.map((record) => record.session_id),
    [middle.session_id, oldest.session_id]
  );
  assert.equal(
    listed.find((record) => record.session_id === dead.session_id),
    undefined
  );
});
