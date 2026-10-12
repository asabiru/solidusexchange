import assert from "node:assert/strict";
import test from "node:test";

import {
  type OperatorSessionRecord,
  type SessionIssueCommand,
  type SessionStore,
  SessionStoreCommandError,
  SessionStoreError,
  SessionStoreUnavailableError
} from "./session-store.js";

// Shared session-store contract: the same suite runs against the memory and
// PostgreSQL backends so both honor identical lifecycle semantics — issue,
// lookup, refresh rotation, revoke, device binding + displacement, expiry
// sweep, live counts and the per-subject bounds. Each case builds its store
// through `makeStore` and closes it through `t.after`, so a backend may
// hold real connections (the PostgreSQL pool) without leaking.
// `makeRawStore` builds a backend in the not-yet-initialized state so the
// contract can pin identical lifecycle rejection on every implementation.
// `freshSubject` isolates every case on its own subject so the suite runs
// identically against a shared database table.

export interface SessionStoreContractOptions {
  name: string;
  makeStore: () => Promise<SessionStore>;
  makeRawStore: () => Promise<SessionStore>;
  freshSubject?: () => string;
}

// Seeded per process run so contract re-runs against a persistent test
// database cannot collide with rows an earlier run left behind.
let counter = Date.now() * 256;

export function registerSessionStoreContract({
  name,
  makeStore,
  makeRawStore,
  freshSubject = () => `syn_oper_${(counter++).toString(16).padStart(16, "0")}`
}: SessionStoreContractOptions) {
  const freshSessionId = () => `sess_${(counter++).toString(16).padStart(24, "0")}`;
  const freshDigest = () => (counter++).toString(16).padStart(64, "0");

  const issueCommand = (overrides: Partial<SessionIssueCommand> = {}): SessionIssueCommand => ({
    session_id: freshSessionId(),
    subject: freshSubject(),
    email: "operator@dev.solidchange.invalid",
    name: "Contract Operator",
    role: "compliance-lead",
    token_digest: freshDigest(),
    device_digest: null,
    issued_at_ms: 1_000,
    expires_at_ms: 61_000,
    last_used_at_ms: 1_000,
    maxPerSubject: 4,
    ...overrides
  });

  const issueFor = async (
    store: SessionStore,
    overrides: Partial<SessionIssueCommand> = {}
  ): Promise<OperatorSessionRecord> => store.issueSession(issueCommand(overrides));

  test(`${name}: issue lands a live record read back by id and token digest`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const command = issueCommand();
    const issued = await store.issueSession(command);
    assert.deepEqual(issued, {
      session_id: command.session_id,
      subject: command.subject,
      email: command.email,
      name: command.name,
      role: command.role,
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
        SessionStoreError,
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
      SessionStoreError
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

  test(`${name}: a device-bound issue displaces the device's other live sessions`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const device = freshDigest();
    const displaced = await issueFor(store, { device_digest: device });
    const foreign = await issueFor(store, { device_digest: freshDigest() });
    const unbound = await issueFor(store);
    const fresh = await issueFor(store, { device_digest: device });
    // The new login on the same device ended the device's earlier live
    // session; unrelated sessions — on other devices or unbound — survive.
    assert.equal(await store.getSession({ session_id: displaced.session_id, now: 1_500 }), null);
    assert.deepEqual(
      await store.getSession({ session_id: fresh.session_id, now: 1_500 }),
      fresh
    );
    assert.equal(
      (await store.getSession({ session_id: foreign.session_id, now: 1_500 }))?.session_id,
      foreign.session_id
    );
    assert.equal(
      (await store.getSession({ session_id: unbound.session_id, now: 1_500 }))?.session_id,
      unbound.session_id
    );
    // Displacement is terminal history, not revocation bookkeeping: a
    // revoked record keeps the digest it was bound with and is never
    // displaced.
    const archived = await issueFor(store, { device_digest: freshDigest() });
    await store.revokeSession({
      session_id: archived.session_id,
      now: 1_600,
      maxRevokedPerSubject: 4
    });
    await issueFor(store, { device_digest: archived.device_digest });
    assert.deepEqual(
      await store.getSession({ session_id: archived.session_id, now: 1_700 }),
      { ...archived, revoked: true, revoked_at_ms: 1_600 }
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
    assert.equal(rotated?.token_digest === issued.token_digest, false);
    assert.equal(rotated?.expires_at_ms, 120_000);
    assert.equal(rotated?.last_used_at_ms, 2_000);
    assert.equal(
      await store.getSessionByTokenDigest({ token_digest: issued.token_digest, now: 3_000 }),
      null
    );
    assert.deepEqual(
      await store.getSessionByTokenDigest({ token_digest: rotated?.token_digest ?? "", now: 3_000 }),
      rotated
    );
    // A refresh cannot shorten the stored expiry or move last-used back.
    const damped = await store.refreshSession({
      session_id: issued.session_id,
      token_digest: freshDigest(),
      now: 1_500,
      expires_at_ms: 2_500
    });
    assert.equal(damped?.expires_at_ms, 120_000);
    assert.equal(damped?.last_used_at_ms, 2_000);
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
      SessionStoreError
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
    assert.equal(bound?.device_digest !== null && bound?.device_digest !== undefined, true);
    assert.equal(bound?.last_used_at_ms, 2_000);
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

  test(`${name}: count reflects live sessions across subjects`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const baseline = await store.countSessions({ now: 1_500 });
    const first = await issueFor(store, { subject });
    const second = await issueFor(store, { subject });
    const dead = await issueFor(store, { subject: freshSubject(), expires_at_ms: 2_000 });
    const revoked = await issueFor(store, { subject: freshSubject() });
    await store.revokeSession({
      session_id: revoked.session_id,
      now: 1_500,
      maxRevokedPerSubject: 4
    });
    assert.equal(
      await store.countSessions({ now: 1_500 }),
      baseline + 3,
      "expired and revoked records are not live"
    );
    assert.equal(await store.countSessions({ now: 3_000 }), baseline + 2);
    await store.sweepExpiredSessions({ now: 3_000 });
    assert.equal(
      await store.getSession({ session_id: dead.session_id, now: 3_000 }),
      null
    );
    for (const record of [first, second]) {
      assert.equal(
        (await store.getSession({ session_id: record.session_id, now: 3_000 }))?.session_id,
        record.session_id
      );
    }
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
    t.after(() => store.close().catch(() => undefined));
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
      () => store.listSessions({ subject: command.subject, now: 1_000, limit: 8 }),
      () => store.countSessions({ now: 1_000 })
    ]) {
      await assert.rejects(operation, SessionStoreUnavailableError);
    }
  });

  test(`${name}: a closed store refuses every lifecycle operation`, async () => {
    const store = await makeStore();
    await store.close();
    const command = issueCommand();
    for (const operation of [
      () => store.issueSession(command),
      () => store.getSession({ session_id: command.session_id, now: 1_000 }),
      () => store.sweepExpiredSessions({ now: 1_000 }),
      () => store.countSessions({ now: 1_000 })
    ]) {
      await assert.rejects(operation, SessionStoreUnavailableError);
    }
    await store.initialize();
    assert.deepEqual(await store.getSession({ session_id: command.session_id, now: 1_000 }), null);
  });

  test(`${name}: malformed commands fail identically on every backend`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const malformed: Partial<SessionIssueCommand>[] = [
      { session_id: "sess_not_hex_not_hex_not_x" },
      { session_id: `sess_${"0".repeat(23)}` },
      { session_id: "sess_00000000000000000000000g" },
      { session_id: 42 as unknown as string },
      { subject: "" },
      { subject: "sub ject" },
      { subject: "sub/ject" },
      { subject: "x".repeat(129) },
      { subject: "оператор" },
      { email: "x".repeat(321) },
      { email: "mail\u0000drop@dev.invalid" },
      { name: "x".repeat(201) },
      { name: "Имя \uD800" },
      { role: "root" as SessionIssueCommand["role"] },
      { token_digest: "z".repeat(64) },
      { token_digest: "A".repeat(64) },
      { token_digest: 7 as unknown as string },
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
        SessionStoreCommandError,
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
        () => store.listSessions({ subject: "bad subject", now: 1_000, limit: 8 })
      ],
      [
        "list limit",
        () => store.listSessions({ subject: issued.subject, now: 1_000, limit: 0 })
      ],
      ["count", () => store.countSessions({ now: -1 })]
    ] as const) {
      await assert.rejects(operation, SessionStoreCommandError, label);
    }
  });

  // Wave-62 audit pins: each case asserts a behavior the memory and
  // PostgreSQL backends must share bit-for-bit. A case that diverges on
  // either backend fails the shared contract on exactly that backend.

  test(`${name}: a failed revoke leaves the subject's revoked history untouched`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const issued: OperatorSessionRecord[] = [];
    for (let index = 0; index < 5; index += 1) {
      issued.push(await issueFor(store, {
        subject,
        issued_at_ms: 1_000 + index * 100,
        last_used_at_ms: 1_000 + index * 100,
        maxPerSubject: 8
      }));
    }
    // Revoke five sessions with a generous bound so all five tombstones
    // stay; then re-revoke the newest one with a tighter bound. The second
    // revoke is a no-op: on the memory backend it changes nothing, so the
    // postgres backend must not trim revoked history either.
    for (const [index, record] of issued.entries()) {
      await store.revokeSession({
        session_id: record.session_id,
        now: 5_000 + index,
        maxRevokedPerSubject: 4
      });
    }
    const repeat = await store.revokeSession({
      session_id: issued[4].session_id,
      now: 6_000,
      maxRevokedPerSubject: 2
    });
    assert.equal(repeat, null);
    for (const [index, record] of issued.entries()) {
      assert.deepEqual(
        await store.getSession({ session_id: record.session_id, now: 9_000 }),
        { ...record, revoked: true, revoked_at_ms: 5_000 + index },
        `revoked record ${index + 1} must survive the failed revoke`
      );
    }
  });

  test(`${name}: a failed revoke on an expired record touches nothing`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const first = await issueFor(store, { subject, issued_at_ms: 1_000, last_used_at_ms: 1_000 });
    const second = await issueFor(store, { subject, issued_at_ms: 2_000, last_used_at_ms: 2_000 });
    const third = await issueFor(store, { subject, issued_at_ms: 3_000, last_used_at_ms: 3_000 });
    const dead = await issueFor(store, { subject, expires_at_ms: 2_500 });
    await store.revokeSession({ session_id: first.session_id, now: 4_000, maxRevokedPerSubject: 2 });
    await store.revokeSession({ session_id: second.session_id, now: 5_000, maxRevokedPerSubject: 2 });
    await store.revokeSession({ session_id: third.session_id, now: 6_000, maxRevokedPerSubject: 2 });
    // Revoking the expired record must answer null and evict only that
    // record — never a revoked one.
    assert.equal(
      await store.revokeSession({ session_id: dead.session_id, now: 7_000, maxRevokedPerSubject: 2 }),
      null
    );
    assert.equal(await store.getSession({ session_id: dead.session_id, now: 7_000 }), null);
    for (const record of [first, second, third]) {
      assert.equal(
        (await store.getSession({ session_id: record.session_id, now: 7_000 }))?.revoked,
        true,
        "a revoked record must survive the failed revoke"
      );
    }
  });

  test(`${name}: eviction ordering ties break on the session id`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    // Live bound: identical issued_at_ms — the lexicographically largest
    // session id is the evicted record on every backend.
    const alpha = await issueFor(store, {
      subject, session_id: "sess_a00000000000000000000001", issued_at_ms: 1_000, last_used_at_ms: 1_000, maxPerSubject: 2
    });
    const beta = await issueFor(store, {
      subject, session_id: "sess_b00000000000000000000002", issued_at_ms: 1_000, last_used_at_ms: 1_000, maxPerSubject: 2
    });
    const gamma = await issueFor(store, {
      subject, session_id: "sess_c00000000000000000000003", issued_at_ms: 1_000, last_used_at_ms: 1_000, maxPerSubject: 2
    });
    assert.equal(await store.getSession({ session_id: beta.session_id, now: 2_000 }), null);
    for (const record of [alpha, gamma]) {
      assert.equal(
        (await store.getSession({ session_id: record.session_id, now: 2_000 }))?.session_id,
        record.session_id
      );
    }
    // Revoked bound: identical revoked_at_ms — the same tie-break picks
    // the evicted tombstone deterministically.
    const subject2 = freshSubject();
    const stones: OperatorSessionRecord[] = [];
    for (const suffix of ["d", "e", "f"]) {
      stones.push(await issueFor(store, { subject: subject2, session_id: `sess_${suffix}00000000000000000000004` }));
    }
    for (const record of stones) {
      await store.revokeSession({ session_id: record.session_id, now: 5_000, maxRevokedPerSubject: 2 });
    }
    const last = await issueFor(store, { subject: subject2, session_id: "sess_100000000000000000000005" });
    await store.revokeSession({ session_id: last.session_id, now: 5_000, maxRevokedPerSubject: 2 });
    // Pre-update snapshot: the doomed tombstone is the largest id among the
    // three tied revoked records (sess_f...), keeping the two smallest.
    assert.equal(await store.getSession({ session_id: stones[2].session_id, now: 9_000 }), null);
    for (const record of [stones[0], stones[1], last]) {
      assert.equal(
        (await store.getSession({ session_id: record.session_id, now: 9_000 }))?.session_id,
        record.session_id
      );
    }
  });

  test(`${name}: a bound of one keeps only the newest record`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const subject = freshSubject();
    const first = await issueFor(store, { subject, maxPerSubject: 1 });
    const second = await issueFor(store, { subject, maxPerSubject: 1 });
    assert.equal(await store.getSession({ session_id: first.session_id, now: 2_000 }), null);
    assert.equal(
      (await store.getSession({ session_id: second.session_id, now: 2_000 }))?.session_id,
      second.session_id
    );
    // The revoked bound keeps the bound plus the record being revoked:
    // with maxRevokedPerSubject=1 the third revoke evicts the oldest
    // tombstone, not an arbitrary one.
    const subject2 = freshSubject();
    const stones: OperatorSessionRecord[] = [];
    for (let index = 0; index < 3; index += 1) {
      stones.push(await issueFor(store, { subject: subject2 }));
    }
    for (const [index, record] of stones.entries()) {
      await store.revokeSession({
        session_id: record.session_id,
        now: 3_000 + index,
        maxRevokedPerSubject: 1
      });
    }
    assert.equal(await store.getSession({ session_id: stones[0].session_id, now: 9_000 }), null);
    for (const record of stones.slice(1)) {
      assert.equal(
        (await store.getSession({ session_id: record.session_id, now: 9_000 }))?.revoked,
        true
      );
    }
  });

  test(`${name}: a digest freed by rotation is reclaimable, a live one is not`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    const rotatedDigest = freshDigest();
    await store.refreshSession({
      session_id: issued.session_id,
      token_digest: rotatedDigest,
      now: 2_000,
      expires_at_ms: 62_000
    });
    // The rotated-away digest no longer names a record: another session
    // may claim it.
    const reclaimed = await issueFor(store, { token_digest: issued.token_digest });
    assert.equal(reclaimed.token_digest, issued.token_digest);
    // The live digest is still a conflict.
    await assert.rejects(
      async () => store.issueSession(issueCommand({ token_digest: rotatedDigest })),
      SessionStoreError
    );
    // A refresh may also present the session's own current digest: the row
    // is its own holder, so no other record conflicts.
    const self = await store.refreshSession({
      session_id: issued.session_id,
      token_digest: rotatedDigest,
      now: 3_000,
      expires_at_ms: 63_000
    });
    assert.equal(self?.token_digest, rotatedDigest);
  });

  test(`${name}: concurrent rotations on one session serialize`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    const first = freshDigest();
    const second = freshDigest();
    const [rotatedA, rotatedB] = await Promise.all([
      store.refreshSession({
        session_id: issued.session_id,
        token_digest: first,
        now: 2_000,
        expires_at_ms: 62_000
      }),
      store.refreshSession({
        session_id: issued.session_id,
        token_digest: second,
        now: 3_000,
        expires_at_ms: 70_000
      })
    ]);
    // Both rotations succeed in call order: the second sees the first's
    // committed row, so last_used and expiry only move forward.
    assert.equal(rotatedA?.token_digest, first);
    assert.equal(rotatedB?.token_digest, second);
    assert.equal(rotatedB?.last_used_at_ms, 3_000);
    assert.equal(rotatedB?.expires_at_ms, 70_000);
    assert.equal(
      await store.getSessionByTokenDigest({ token_digest: first, now: 4_000 }),
      null,
      "the superseded digest is dead"
    );
    assert.equal(
      (await store.getSessionByTokenDigest({ token_digest: second, now: 4_000 }))?.session_id,
      issued.session_id
    );
  });

  test(`${name}: boundary expiry values hold on every backend`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    // expires = issued + 1: live for exactly one millisecond.
    const edge = await issueFor(store, { issued_at_ms: 1_000, last_used_at_ms: 1_000, expires_at_ms: 1_001 });
    assert.equal(
      (await store.getSession({ session_id: edge.session_id, now: 1_000 }))?.session_id,
      edge.session_id
    );
    assert.equal(await store.getSession({ session_id: edge.session_id, now: 1_001 }), null);
    // expires at the exact read instant counts as dead.
    const exact = await issueFor(store, { issued_at_ms: 2_000, last_used_at_ms: 2_000, expires_at_ms: 5_000 });
    assert.equal(await store.getSession({ session_id: exact.session_id, now: 5_000 }), null);
    // The largest representable timestamp stores and reads back intact.
    const far = await issueFor(store, { expires_at_ms: Number.MAX_SAFE_INTEGER });
    assert.equal(
      (await store.getSession({ session_id: far.session_id, now: Number.MAX_SAFE_INTEGER - 1 }))?.session_id,
      far.session_id
    );
    // last_used past expiry does not kill a record: only the expiry
    // instant matters, identically on both backends.
    const forwardUsed = await issueFor(store, {
      issued_at_ms: 1_000,
      last_used_at_ms: 9_000,
      expires_at_ms: 2_000
    });
    assert.equal(
      (await store.getSession({ session_id: forwardUsed.session_id, now: 1_500 }))?.session_id,
      forwardUsed.session_id
    );
    assert.equal(await store.getSession({ session_id: forwardUsed.session_id, now: 2_000 }), null);
    // Revoked records never expire out of reads: tombstones stay readable
    // past any expiry instant.
    const revoked = await issueFor(store, { expires_at_ms: 2_000 });
    await store.revokeSession({
      session_id: revoked.session_id,
      now: 1_500,
      maxRevokedPerSubject: 4
    });
    assert.deepEqual(
      await store.getSession({ session_id: revoked.session_id, now: Number.MAX_SAFE_INTEGER }),
      { ...revoked, revoked: true, revoked_at_ms: 1_500 }
    );
  });
}
