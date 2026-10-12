import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryAuthSessionStore,
  createStoredAuthSessionDirectory,
  digestAuthSessionToken,
  mintAuthSessionId,
  mintAuthSessionToken
} from "../src/auth-session-store.mjs";
import { registerAuthSessionStoreContract } from "./auth-session-store-contract.mjs";

registerAuthSessionStoreContract({
  name: "memory",
  async makeStore() {
    const store = createMemoryAuthSessionStore();
    await store.initialize?.();
    return store;
  },
  async makeRawStore() {
    return createMemoryAuthSessionStore();
  }
});

test("the memory backend declares its kind", async (t) => {
  const store = createMemoryAuthSessionStore();
  t.after(() => store.close());
  assert.equal(store.kind, "memory");
});

test("minted ids and digests carry the store grammars", () => {
  assert.match(mintAuthSessionId(), /^sess_[0-9a-f]{24}$/u);
  assert.match(mintAuthSessionToken(), /^sat_[0-9a-f]{48}$/u);
  const token = mintAuthSessionToken();
  const digest = digestAuthSessionToken(token);
  assert.match(digest, /^[0-9a-f]{64}$/u);
  assert.notEqual(digest, token);
  // The digest is deterministic and namespaced: a raw token can never be
  // reconstructed or replayed from what the store persists.
  assert.equal(digestAuthSessionToken(token), digest);
  assert.notEqual(digestAuthSessionToken(`${token}x`), digest);
});

test("the stored directory issues and resolves sessions without persisting tokens", async (t) => {
  const store = createMemoryAuthSessionStore();
  t.after(() => store.close());
  await store.initialize?.();
  const directory = createStoredAuthSessionDirectory({ store, clock: () => 10_000 });
  const { session, token } = await directory.issue({ subject: "syn_cust_aaaa0000" });
  assert.match(session.session_id, /^sess_[0-9a-f]{24}$/u);
  assert.match(session.token_digest, /^[0-9a-f]{64}$/u);
  // The record persists only digests: the minted bearer token is returned
  // to the caller and never touches the store.
  assert.equal(session.token_digest, digestAuthSessionToken(token));
  assert.notEqual(session.token_digest, token);
  assert.equal("token" in session, false);
  assert.deepEqual(await directory.getByTokenDigest(digestAuthSessionToken(token), 10_000), session);
  assert.deepEqual(await directory.getById(session.session_id, 10_000), session);
  assert.deepEqual(
    (await directory.listFor("syn_cust_aaaa0000", 10_000)).map((record) => record.session_id),
    [session.session_id]
  );
});

test("the stored directory rotates, binds and revokes through the seam", async (t) => {
  const store = createMemoryAuthSessionStore();
  t.after(() => store.close());
  await store.initialize?.();
  const directory = createStoredAuthSessionDirectory({ store, clock: () => 10_000 });
  const { session, token } = await directory.issue({ subject: "syn_cust_bbbb0000" });
  const rotated = await directory.refresh(session.session_id, 12_000);
  assert.equal(rotated.session.token_digest, digestAuthSessionToken(rotated.token));
  assert.notEqual(rotated.token, token);
  assert.equal(await directory.getByTokenDigest(digestAuthSessionToken(token), 12_000), null);
  const bound = await directory.bindDevice(session.session_id, "d".repeat(64), 13_000);
  assert.equal(bound.device_digest, "d".repeat(64));
  const revoked = await directory.revoke(session.session_id, 14_000);
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.revoked_at_ms, 14_000);
  assert.equal(await directory.refresh(session.session_id, 15_000), null);
  assert.equal(await directory.bindDevice(session.session_id, "e".repeat(64), 15_000), null);
});

test("the stored directory sweeps and bounds through the seam", async (t) => {
  const store = createMemoryAuthSessionStore();
  t.after(() => store.close());
  await store.initialize?.();
  let now = 1_000;
  const directory = createStoredAuthSessionDirectory({
    store,
    clock: () => now,
    ttlMs: 1_000,
    maxPerSubject: 2,
    listLimit: 8
  });
  const first = await directory.issue({ subject: "syn_cust_cccc0000" });
  now = 1_100;
  const second = await directory.issue({ subject: "syn_cust_cccc0000" });
  now = 1_200;
  const third = await directory.issue({ subject: "syn_cust_cccc0000" });
  // maxPerSubject=2 evicted the oldest active before the third landed.
  assert.deepEqual(
    (await directory.listFor("syn_cust_cccc0000")).map((record) => record.session_id).sort(),
    [third.session.session_id, second.session.session_id].sort()
  );
  now = 1_500;
  assert.equal(await directory.getById(first.session.session_id), null);
  now = 3_000;
  assert.deepEqual(await directory.sweep(), { swept: 2 });
  assert.deepEqual(await directory.listFor("syn_cust_cccc0000"), []);
  const { session } = await directory.issue({ subject: "syn_cust_cccc0000" });
  assert.equal((await directory.sweep(3_000)).swept, 0);
  assert.equal(session.revoked, false);
});

test("the stored directory rejects an absent store and non-positive bounds", () => {
  assert.throws(() => createStoredAuthSessionDirectory({}), /store is required/iu);
  for (const bounds of [
    { ttlMs: 0 },
    { maxPerSubject: 0 },
    { maxRevokedPerSubject: -1 },
    { listLimit: 1.5 }
  ]) {
    assert.throws(
      () =>
        createStoredAuthSessionDirectory({
          store: createMemoryAuthSessionStore(),
          ...bounds
        }),
      /positive integer/u,
      JSON.stringify(bounds)
    );
  }
});
