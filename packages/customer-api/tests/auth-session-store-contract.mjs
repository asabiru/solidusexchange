import assert from "node:assert/strict";
import test from "node:test";

import { StoreCommandError, StoreError, StoreUnavailableError } from "../src/store.mjs";

// Shared auth-session-store contract: the same suite runs against the
// memory and PostgreSQL backends so both honor identical lifecycle
// semantics — issue, lookup, refresh rotation, revoke, device binding,
// expiry sweep and the per-subject bounds. Each case builds its store
// through `makeStore` and closes it through `t.after`, so a backend may
// hold real connections (the PostgreSQL pool) without leaking.
// `makeRawStore` builds a backend in the not-yet-initialized state so the
// contract can pin identical lifecycle rejection on every implementation.
// `freshSubject` isolates every case on its own subject so the suite runs
// identically against a shared database table.

/**
 * @param {{
 *   name: string,
 *   makeStore: () => Promise<import("../src/auth-session-store.mjs").AuthSessionStore>,
 *   makeRawStore: () => Promise<import("../src/auth-session-store.mjs").AuthSessionStore>,
 *   freshSubject?: () => string
 * }} options
 */
export function registerAuthSessionStoreContract({
  name,
  makeStore,
  makeRawStore,
  freshSubject = () => `syn_cust_${(counter++).toString(16).padStart(8, "0")}`
}) {
  const freshSessionId = () => `sess_${(counter++).toString(16).padStart(24, "0")}`;
  const freshDigest = () => (counter++).toString(16).padStart(64, "0");

  /**
   * @param {Record<string, unknown>} [overrides]
   */
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

  /** @param {import("../src/auth-session-store.mjs").AuthSessionStore} store */
  const issueFor = async (store, overrides = {}) => store.issueSession(issueCommand(overrides));

  test(`${name}: issue lands a live record read back by id and token digest`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const command = issueCommand();
    const issued = await store.issueSession(command);
    assert.deepEqual(issued, {
      session_id: command.session_id,
      subject: command.subject,
      token_digest: command.token_digest,
      device_digest: null,
      issued_at_ms: command.issued_at_ms,
      expires_at_ms: command.expires_at_ms,
      last_used_at_ms: command.last_used_at_ms,
      revoked: false,
      revoked_at_ms: null
    });
    assert.deepEqual(
      await store.getSession({ session_id: command.session_id, now: 2_000 }),
      issued
    );
    assert.deepEqual(
      await store.getSessionByTokenDigest({ token_digest: command.token_digest, now: 2_000 }),
      issued
    );
  });

  test(`${name}: reads answer null for unknown ids and digests`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    await issueFor(store);
    assert.equal(await store.getSession({ session_id: freshSessionId(), now: 1_500 }), null);
    assert.equal(
      await store.getSessionByTokenDigest({ token_digest: freshDigest(), now: 1_500 }),
      null
    );
  });

  test(`${name}: a stored session id or token digest conflict is a StoreError`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    for (const overrides of [
      { session_id: issued.session_id },
      { token_digest: issued.token_digest }
    ]) {
      await assert.rejects(
        async () => store.issueSession(issueCommand(overrides)),
        StoreError,
        `conflicting ${JSON.stringify(overrides)}`
      );
    }
  });

  test(`${name}: issue sweeps expired records before inserting`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const stale = await issueFor(store, {
      subject,
      issued_at_ms: 1_000,
      last_used_at_ms: 1_000,
      expires_at_ms: 2_000
    });
    // The expired row is still stored until an operation touches it; the
    // issue's own conflict check still sees it and must reject its digest.
    await assert.rejects(
      async () =>
        store.issueSession(
          issueCommand({ subject, token_digest: stale.token_digest, last_used_at_ms: 5_000 })
        ),
      StoreError
    );
    await issueFor(store, { subject, last_used_at_ms: 5_000 });
    // After the issue-time sweep the stale row is gone for good: its digest
    // is free to claim again.
    await issueFor(store, { subject, token_digest: stale.token_digest, last_used_at_ms: 6_000 });
  });

  test(`${name}: the per-subject bound evicts the oldest actives`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const other = freshSubject();
    const oldest = await issueFor(store, {
      subject, issued_at_ms: 1_000, last_used_at_ms: 1_000, maxPerSubject: 2
    });
    const middle = await issueFor(store, {
      subject, issued_at_ms: 2_000, last_used_at_ms: 2_000, maxPerSubject: 2
    });
    const survivor = await issueFor(store, {
      subject, issued_at_ms: 3_000, last_used_at_ms: 3_000, maxPerSubject: 2
    });
    const foreign = await issueFor(store, { subject: other, maxPerSubject: 2 });
    assert.equal(
      await store.getSession({ session_id: oldest.session_id, now: 4_000 }),
      null
    );
    assert.deepEqual(
      (await store.listSessions({ subject, now: 4_000, limit: 8 })).map(
        (record) => record.session_id
      ),
      [survivor.session_id, middle.session_id]
    );
    assert.deepEqual(
      (await store.listSessions({ subject: other, now: 4_000, limit: 8 })).map(
        (record) => record.session_id
      ),
      [foreign.session_id]
    );
  });

  test(`${name}: refresh rotates the digest and extends, never shortens`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    const rotated = await store.refreshSession({
      session_id: issued.session_id,
      token_digest: freshDigest(),
      now: 2_000,
      expires_at_ms: 120_000
    });
    assert.equal(rotated.token_digest === issued.token_digest, false);
    assert.equal(rotated.expires_at_ms, 120_000);
    assert.equal(rotated.last_used_at_ms, 2_000);
    assert.equal(
      await store.getSessionByTokenDigest({ token_digest: issued.token_digest, now: 3_000 }),
      null
    );
    assert.deepEqual(
      await store.getSessionByTokenDigest({ token_digest: rotated.token_digest, now: 3_000 }),
      rotated
    );
    // A refresh cannot shorten the stored expiry or move last-used back.
    const damped = await store.refreshSession({
      session_id: issued.session_id,
      token_digest: freshDigest(),
      now: 1_500,
      expires_at_ms: 2_500
    });
    assert.equal(damped.expires_at_ms, 120_000);
    assert.equal(damped.last_used_at_ms, 2_000);
  });

  test(`${name}: refresh rejects dead sessions and digest conflicts`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    const holder = await issueFor(store);
    const short = await issueFor(store, { expires_at_ms: 2_000 });
    assert.equal(
      await store.refreshSession({
        session_id: short.session_id,
        token_digest: freshDigest(),
        now: 5_000,
        expires_at_ms: 6_000
      }),
      null
    );
    assert.equal(
      await store.refreshSession({
        session_id: freshSessionId(),
        token_digest: freshDigest(),
        now: 1_500,
        expires_at_ms: 62_000
      }),
      null
    );
    await store.revokeSession({
      session_id: issued.session_id,
      now: 1_500,
      maxRevokedPerSubject: 4
    });
    assert.equal(
      await store.refreshSession({
        session_id: issued.session_id,
        token_digest: freshDigest(),
        now: 1_600,
        expires_at_ms: 62_000
      }),
      null
    );
    await assert.rejects(
      async () =>
        store.refreshSession({
          session_id: holder.session_id,
          token_digest: issued.token_digest,
          now: 1_700,
          expires_at_ms: 62_000
        }),
      StoreError
    );
  });

  test(`${name}: revoke marks the record terminally and bounds revoked history`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const first = await issueFor(store, { subject, issued_at_ms: 1_000, last_used_at_ms: 1_000 });
    const second = await issueFor(store, { subject, issued_at_ms: 2_000, last_used_at_ms: 2_000 });
    const third = await issueFor(store, { subject, issued_at_ms: 3_000, last_used_at_ms: 3_000 });
    const fourth = await issueFor(store, { subject, issued_at_ms: 4_000, last_used_at_ms: 4_000 });
    const live = await issueFor(store, { subject: freshSubject() });
    await store.revokeSession({ session_id: first.session_id, now: 5_000, maxRevokedPerSubject: 2 });
    await store.revokeSession({ session_id: second.session_id, now: 6_000, maxRevokedPerSubject: 2 });
    await store.revokeSession({ session_id: third.session_id, now: 7_000, maxRevokedPerSubject: 2 });
    const revoked = await store.revokeSession({
      session_id: fourth.session_id,
      now: 8_000,
      maxRevokedPerSubject: 2
    });
    assert.deepEqual(revoked, { ...fourth, revoked: true, revoked_at_ms: 8_000 });
    // The newest two pre-existing revoked records survive beside the new
    // one; the oldest (first) was evicted entirely.
    assert.equal(await store.getSession({ session_id: first.session_id, now: 9_000 }), null);
    assert.deepEqual(
      await store.getSession({ session_id: second.session_id, now: 9_000 }),
      { ...second, revoked: true, revoked_at_ms: 6_000 }
    );
    assert.deepEqual(
      await store.getSession({ session_id: fourth.session_id, now: 9_000 }),
      revoked
    );
    // A revoked record reads back but never revives: a second revoke and a
    // refresh both answer null, and other subjects are untouched.
    assert.equal(
      await store.revokeSession({
        session_id: fourth.session_id,
        now: 9_000,
        maxRevokedPerSubject: 2
      }),
      null
    );
    assert.equal(
      await store.refreshSession({
        session_id: fourth.session_id,
        token_digest: freshDigest(),
        now: 9_000,
        expires_at_ms: 62_000
      }),
      null
    );
    assert.equal(
      (await store.getSession({ session_id: live.session_id, now: 9_000 }))?.revoked,
      false
    );
  });

  test(`${name}: device binding is one-time on live sessions only`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    const bound = await store.bindDevice({
      session_id: issued.session_id,
      device_digest: freshDigest(),
      now: 2_000
    });
    assert.equal(bound.device_digest !== null, true);
    assert.equal(bound.last_used_at_ms, 2_000);
    assert.equal(
      await store.bindDevice({
        session_id: issued.session_id,
        device_digest: freshDigest(),
        now: 3_000
      }),
      null
    );
    const stale = await issueFor(store, { expires_at_ms: 2_500 });
    assert.equal(
      await store.bindDevice({
        session_id: stale.session_id,
        device_digest: freshDigest(),
        now: 5_000
      }),
      null
    );
    const revoked = await issueFor(store);
    await store.revokeSession({
      session_id: revoked.session_id,
      now: 1_500,
      maxRevokedPerSubject: 4
    });
    assert.equal(
      await store.bindDevice({
        session_id: revoked.session_id,
        device_digest: freshDigest(),
        now: 1_600
      }),
      null
    );
    assert.equal(
      await store.bindDevice({
        session_id: freshSessionId(),
        device_digest: freshDigest(),
        now: 1_600
      }),
      null
    );
  });

  test(`${name}: the expiry sweep evicts only dead unrevoked records`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const deadA = await issueFor(store, { subject, expires_at_ms: 2_000 });
    const deadB = await issueFor(store, { subject, expires_at_ms: 2_500 });
    const liveA = await issueFor(store, { subject });
    const revoked = await issueFor(store, { subject, expires_at_ms: 2_000 });
    await store.revokeSession({
      session_id: revoked.session_id,
      now: 1_500,
      maxRevokedPerSubject: 4
    });
    const { swept } = await store.sweepExpiredSessions({ now: 3_000 });
    assert.ok(swept >= 2);
    for (const record of [deadA, deadB]) {
      assert.equal(await store.getSession({ session_id: record.session_id, now: 3_000 }), null);
    }
    // Revoked history survives the sweep: expiry only claims unrevoked rows.
    assert.deepEqual(
      await store.getSession({ session_id: revoked.session_id, now: 3_000 }),
      { ...revoked, revoked: true, revoked_at_ms: 1_500 }
    );
    assert.deepEqual(
      (await store.listSessions({ subject, now: 3_000, limit: 8 })).map(
        (record) => record.session_id
      ),
      [liveA.session_id]
    );
  });

  test(`${name}: list returns live records newest first within the bound`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const first = await issueFor(store, { subject, last_used_at_ms: 1_000, issued_at_ms: 1_000 });
    const second = await issueFor(store, { subject, last_used_at_ms: 2_000, issued_at_ms: 2_000 });
    const third = await issueFor(store, { subject, last_used_at_ms: 3_000, issued_at_ms: 3_000 });
    await store.bindDevice({ session_id: first.session_id, device_digest: freshDigest(), now: 4_000 });
    assert.deepEqual(
      (await store.listSessions({ subject, now: 5_000, limit: 8 })).map(
        (record) => record.session_id
      ),
      [first.session_id, third.session_id, second.session_id]
    );
    assert.deepEqual(
      (await store.listSessions({ subject, now: 5_000, limit: 2 })).map(
        (record) => record.session_id
      ),
      [first.session_id, third.session_id]
    );
  });

  test(`${name}: concurrent issues serialize to the same subject bound`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const issued = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        issueFor(store, {
          subject,
          issued_at_ms: 1_000 + index * 100,
          last_used_at_ms: 1_000 + index * 100,
          maxPerSubject: 2
        })
      )
    );
    // Serialized in call order on every backend, the newest two issues are
    // always the last two dispatched — concurrency cannot grow the bound.
    const expected = [issued[4].session_id, issued[5].session_id].sort();
    const listed = await store.listSessions({ subject, now: 1_500, limit: 8 });
    assert.deepEqual(
      listed.map((record) => record.session_id).sort(),
      expected
    );
  });

  test(`${name}: a lifecycle operation before initialize fails closed`, async (t) => {
    const store = await makeRawStore();
    t.after(() => store.close());
    const command = issueCommand();
    for (const operation of [
      () => store.issueSession(command),
      () => store.getSession({ session_id: command.session_id, now: 1_000 }),
      () => store.getSessionByTokenDigest({ token_digest: command.token_digest, now: 1_000 }),
      () =>
        store.refreshSession({
          session_id: command.session_id,
          token_digest: freshDigest(),
          now: 1_000,
          expires_at_ms: 2_000
        }),
      () => store.revokeSession({ session_id: command.session_id, now: 1_000, maxRevokedPerSubject: 4 }),
      () =>
        store.bindDevice({
          session_id: command.session_id,
          device_digest: freshDigest(),
          now: 1_000
        }),
      () => store.sweepExpiredSessions({ now: 1_000 }),
      () => store.listSessions({ subject: command.subject, now: 1_000, limit: 8 })
    ]) {
      await assert.rejects(operation, StoreUnavailableError);
    }
  });

  test(`${name}: a closed store refuses every lifecycle operation`, async (t) => {
    const store = await makeStore();
    await store.close();
    const command = issueCommand();
    for (const operation of [
      () => store.issueSession(command),
      () => store.getSession({ session_id: command.session_id, now: 1_000 }),
      () => store.sweepExpiredSessions({ now: 1_000 })
    ]) {
      await assert.rejects(operation, StoreUnavailableError);
    }
    await store.initialize?.();
    assert.deepEqual(await store.getSession({ session_id: command.session_id, now: 1_000 }), null);
  });

  test(`${name}: malformed commands fail identically on every backend`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const malformed = [
      { session_id: "sess_not_hex_not_hex_not_x" },
      { session_id: `sess_${"0".repeat(23)}` },
      { session_id: "sess_00000000000000000000000g" },
      { session_id: 42 },
      { subject: "syn_cust_short" },
      { subject: "cust_" + "a".repeat(16) },
      { token_digest: "z".repeat(64) },
      { token_digest: "A".repeat(64) },
      { token_digest: 7 },
      { device_digest: "device" },
      { issued_at_ms: 0 },
      { issued_at_ms: -1 },
      { issued_at_ms: 1_000.5 },
      { expires_at_ms: 1_000 },
      { issued_at_ms: 2_000, expires_at_ms: 1_000 },
      { last_used_at_ms: 500 },
      { last_used_at_ms: Number.MAX_SAFE_INTEGER + 1 },
      { maxPerSubject: 0 },
      { maxPerSubject: 65 },
      { maxPerSubject: 2.5 }
    ];
    for (const overrides of malformed) {
      await assert.rejects(
        async () => store.issueSession(issueCommand(overrides)),
        StoreCommandError,
        `issue overridden with ${JSON.stringify(overrides)}`
      );
    }
    const issued = await issueFor(store);
    for (const [label, operation] of [
      [
        "get",
        () => store.getSession({ session_id: "bad", now: 1_000 })
      ],
      [
        "get by token",
        () => store.getSessionByTokenDigest({ token_digest: "bad", now: 1_000 })
      ],
      [
        "refresh",
        () =>
          store.refreshSession({
            session_id: issued.session_id,
            token_digest: "bad",
            now: 1_000,
            expires_at_ms: 2_000
          })
      ],
      [
        "refresh expiry",
        () =>
          store.refreshSession({
            session_id: issued.session_id,
            token_digest: freshDigest(),
            now: 5_000,
            expires_at_ms: 4_000
          })
      ],
      [
        "revoke bound",
        () =>
          store.revokeSession({
            session_id: issued.session_id,
            now: 1_000,
            maxRevokedPerSubject: 0
          })
      ],
      [
        "bind",
        () =>
          store.bindDevice({
            session_id: issued.session_id,
            device_digest: "short",
            now: 1_000
          })
      ],
      ["sweep", () => store.sweepExpiredSessions({ now: -1 })],
      [
        "list",
        () => store.listSessions({ subject: "cust_x", now: 1_000, limit: 8 })
      ],
      [
        "list limit",
        () => store.listSessions({ subject: issued.subject, now: 1_000, limit: 0 })
      ]
    ]) {
      await assert.rejects(operation, StoreCommandError, label);
    }
  });
}

let counter = 1;
