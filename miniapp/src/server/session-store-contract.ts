import assert from "node:assert/strict";
import test from "node:test";

import {
  type CustomerSessionRecord,
  type SessionIssueCommand,
  type SessionStore,
  SessionStoreCommandError,
  SessionStoreError,
  SessionStoreUnavailableError
} from "./session-store.js";

// Shared session-store contract: the same suite runs against the memory and
// PostgreSQL backends so both honor identical lifecycle semantics — issue,
// lookup, last-used touch, KYC promotion, revoke, by-token drop, expiry
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
  freshSubject = () => `dev-${(counter++).toString(16).padStart(16, "0")}`
}: SessionStoreContractOptions) {
  const freshSessionId = () => `sess_${(counter++).toString(16).padStart(24, "0")}`;
  const freshDigest = () => (counter++).toString(16).padStart(64, "0");

  const issueCommand = (overrides: Partial<SessionIssueCommand> = {}): SessionIssueCommand => ({
    session_id: freshSessionId(),
    subject: freshSubject(),
    source: "telegram",
    kyc: "kyc-gated",
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
  ): Promise<CustomerSessionRecord> => store.issueSession(issueCommand(overrides));

  test(`${name}: issue lands a live record read back by id and token digest`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const command = issueCommand();
    const issued = await store.issueSession(command);
    assert.deepEqual(issued, {
      session_id: command.session_id,
      subject: command.subject,
      source: command.source,
      kyc: command.kyc,
      token_digest: command.token_digest,
      device_digest: null,
      issued_at_ms: command.issued_at_ms,
      expires_at_ms: command.expires_at_ms,
      last_used_at_ms: command.last_used_at_ms,
      revoked: false,
      revoked_at_ms: null
    });
    assert.deepEqual(await store.getSession({ session_id: command.session_id, now: 1_500 }), issued);
    assert.deepEqual(
      await store.getSessionByTokenDigest({ token_digest: command.token_digest, now: 1_500 }),
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

  test(`${name}: touch moves last-used forward on live sessions only`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    assert.deepEqual(
      await store.touchSession({ session_id: issued.session_id, now: 2_000 }),
      { ...issued, last_used_at_ms: 2_000 }
    );
    // Never backwards — the same Math.max/GREATEST the memory map applied.
    assert.deepEqual(
      await store.touchSession({ session_id: issued.session_id, now: 1_500 }),
      { ...issued, last_used_at_ms: 2_000 }
    );
    // Expired records read as absent and are evicted.
    const stale = await issueFor(store, { expires_at_ms: 2_500 });
    assert.equal(
      await store.touchSession({ session_id: stale.session_id, now: 5_000 }),
      null
    );
    assert.equal(
      await store.getSession({ session_id: stale.session_id, now: 5_000 }),
      null
    );
    // Revoked records read as absent to touch.
    const revoked = await issueFor(store);
    await store.revokeSession({
      session_id: revoked.session_id,
      now: 1_500,
      maxRevokedPerSubject: 4
    });
    assert.equal(
      await store.touchSession({ session_id: revoked.session_id, now: 1_600 }),
      null
    );
    assert.equal(
      await store.touchSession({ session_id: freshSessionId(), now: 1_600 }),
      null
    );
  });

  test(`${name}: verifyKyc promotes gated records one-way on live sessions only`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    assert.deepEqual(
      await store.verifySessionKyc({ session_id: issued.session_id, now: 2_000 }),
      { ...issued, kyc: "verified" }
    );
    // Already verified reads back unchanged — a no-op, not an error.
    assert.deepEqual(
      await store.verifySessionKyc({ session_id: issued.session_id, now: 2_500 }),
      { ...issued, kyc: "verified" }
    );
    assert.equal(
      (await store.getSession({ session_id: issued.session_id, now: 3_000 }))?.kyc,
      "verified"
    );
    const stale = await issueFor(store, { expires_at_ms: 2_500 });
    assert.equal(
      await store.verifySessionKyc({ session_id: stale.session_id, now: 5_000 }),
      null
    );
    const revoked = await issueFor(store);
    await store.revokeSession({
      session_id: revoked.session_id,
      now: 1_500,
      maxRevokedPerSubject: 4
    });
    assert.equal(
      await store.verifySessionKyc({ session_id: revoked.session_id, now: 1_600 }),
      null
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
    // The newest two revoked records survive including the new one; the two
    // oldest (first, second) were evicted entirely.
    assert.equal(await store.getSession({ session_id: first.session_id, now: 9_000 }), null);
    assert.equal(await store.getSession({ session_id: second.session_id, now: 9_000 }), null);
    assert.deepEqual(
      await store.getSession({ session_id: third.session_id, now: 9_000 }),
      { ...third, revoked: true, revoked_at_ms: 7_000 }
    );
    assert.deepEqual(
      await store.getSession({ session_id: fourth.session_id, now: 9_000 }),
      revoked
    );
    assert.deepEqual(
      (await store.listRevokedSessions({ subject, now: 9_000, limit: 8 })).map(
        (record) => record.session_id
      ),
      [fourth.session_id, third.session_id]
    );
    // A revoked record reads back but never revives: a second revoke and a
    // touch both answer null, and other subjects are untouched.
    assert.equal(
      await store.revokeSession({
        session_id: fourth.session_id,
        now: 9_000,
        maxRevokedPerSubject: 2
      }),
      null
    );
    assert.equal(
      await store.touchSession({ session_id: fourth.session_id, now: 9_000 }),
      null
    );
    assert.equal(
      (await store.getSession({ session_id: live.session_id, now: 9_000 }))?.revoked,
      false
    );
  });

  test(`${name}: deleteSessionByTokenDigest drops the record outright`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const issued = await issueFor(store);
    const foreign = await issueFor(store);
    assert.deepEqual(
      await store.deleteSessionByTokenDigest({ token_digest: issued.token_digest }),
      issued
    );
    // Gone entirely — no tombstone, no lookup path answers it again.
    assert.equal(await store.getSession({ session_id: issued.session_id, now: 1_500 }), null);
    assert.equal(
      await store.getSessionByTokenDigest({ token_digest: issued.token_digest, now: 1_500 }),
      null
    );
    assert.equal(
      await store.deleteSessionByTokenDigest({ token_digest: issued.token_digest }),
      null
    );
    assert.equal(
      await store.deleteSessionByTokenDigest({ token_digest: freshDigest() }),
      null
    );
    assert.deepEqual(
      await store.getSession({ session_id: foreign.session_id, now: 1_500 }),
      foreign
    );
    // The freed digest can be re-issued.
    const reissued = await issueFor(store, { token_digest: issued.token_digest });
    assert.equal(reissued.token_digest, issued.token_digest);
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
    await store.touchSession({ session_id: first.session_id, now: 4_000 });
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
      () => store.touchSession({ session_id: command.session_id, now: 1_000 }),
      () => store.verifySessionKyc({ session_id: command.session_id, now: 1_000 }),
      () => store.revokeSession({ session_id: command.session_id, now: 1_000, maxRevokedPerSubject: 4 }),
      () => store.deleteSessionByTokenDigest({ token_digest: command.token_digest }),
      () => store.sweepExpiredSessions({ now: 1_000 }),
      () => store.listSessions({ subject: command.subject, now: 1_000, limit: 8 }),
      () => store.listRevokedSessions({ subject: command.subject, now: 1_000, limit: 8 }),
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
      { subject: "syn_oper_0000000000000000" },
      { source: "root" as SessionIssueCommand["source"] },
      { kyc: "root" as SessionIssueCommand["kyc"] },
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
        "touch",
        () => store.touchSession({ session_id: "bad", now: 1_000 })
      ],
      [
        "verifyKyc",
        () => store.verifySessionKyc({ session_id: issued.session_id, now: -1 })
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
        "delete",
        () => store.deleteSessionByTokenDigest({ token_digest: "short" })
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
      [
        "list revoked",
        () => store.listRevokedSessions({ subject: "bad subject", now: 1_000, limit: 8 })
      ],
      ["count", () => store.countSessions({ now: -1 })]
    ] as const) {
      await assert.rejects(operation, SessionStoreCommandError, label);
    }
  });
}
