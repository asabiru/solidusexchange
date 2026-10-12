import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerSessionStoreContract } from "./session-store-contract.js";
import {
  type SessionIssueCommand,
  type SessionStore,
  createCustomerSessionDirectory,
  createMemorySessionStore,
  digestSessionToken,
  mintSessionId,
  mintSessionToken
} from "./session-store.js";

registerSessionStoreContract({
  name: "memory session store",
  makeStore: async () => {
    const store = createMemorySessionStore();
    await store.initialize?.();
    return store;
  },
  makeRawStore: async () => createMemorySessionStore()
});

describe("customer session directory", () => {
  const directoryWith = async (overrides: Partial<{
    store: SessionStore;
    clock: () => number;
    ttlMs: number;
  }> = {}) => {
    const store = overrides.store ?? createMemorySessionStore();
    await store.initialize?.();
    return {
      store,
      directory: createCustomerSessionDirectory({
        store,
        clock: overrides.clock ?? (() => 10_000),
        ttlMs: overrides.ttlMs ?? 60_000
      })
    };
  };

  it("mints grammar-pinned ids and digests, never raw token material", async () => {
    const seen: SessionIssueCommand[] = [];
    const probe: SessionStore = {
      kind: "memory",
      async initialize() {},
      async issueSession(command) {
        seen.push(command);
        return {
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
          revoked_at_ms: null
        };
      },
      async getSession() { return null; },
      async getSessionByTokenDigest() { return null; },
      async touchSession() { return null; },
      async verifySessionKyc() { return null; },
      async revokeSession() { return null; },
      async deleteSessionByTokenDigest() { return null; },
      async sweepExpiredSessions() { return { swept: 0 }; },
      async listSessions() { return Object.freeze([]); },
      async listRevokedSessions() { return Object.freeze([]); },
      async countSessions() { return 0; },
      async close() {}
    };
    const { directory } = await directoryWith({ store: probe });
    const { session, token } = await directory.issue({
      subject: "dev-0123456789abcdef",
      source: "dev-synthetic",
      kyc: "verified",
      now: 10_000
    });
    assert.match(session.session_id, /^sess_[0-9a-f]{24}$/);
    assert.match(token, /^smt_[0-9a-f]{64}$/);
    assert.equal(seen.length, 1);
    // Only the digest ever reaches the store — the raw token, the session id
    // in raw form and the subject never appear inside it.
    assert.equal(seen[0]?.token_digest, digestSessionToken(token));
    assert.ok(!seen[0]?.token_digest.includes(token));
    assert.equal(seen[0]?.expires_at_ms, 10_000 + 60_000);
    assert.equal(mintSessionId().length, 29);
    assert.equal(mintSessionToken().length, 68);
  });

  it("issues, resolves and drops sessions through the token digest", async () => {
    const { directory } = await directoryWith();
    const { session, token } = await directory.issue({
      subject: "dev-0123456789abcdef",
      source: "dev-synthetic",
      kyc: "kyc-gated"
    });
    const resolved = await directory.resolve(token);
    assert.deepEqual(resolved, session);
    // Garbage cookie values are a miss, never a store rejection.
    for (const garbage of ["", "forged", "smt_", "SMT_" + "0".repeat(64), token + "x"]) {
      assert.equal(await directory.resolve(garbage), null);
    }
    const dropped = await directory.dropByToken(token);
    assert.deepEqual(dropped, session);
    assert.equal(await directory.resolve(token), null);
    assert.equal(await directory.dropByToken("forged"), null);
  });

  it("promotes KYC, moves last-used forward and revokes terminally", async () => {
    const { directory } = await directoryWith();
    const { session, token } = await directory.issue({
      subject: "dev-0123456789abcdef",
      source: "telegram",
      kyc: "kyc-gated"
    });
    assert.equal((await directory.resolve(token))?.kyc, "kyc-gated");
    assert.equal((await directory.verifyKyc(session.session_id))?.kyc, "verified");
    assert.equal((await directory.resolve(token))?.kyc, "verified");
    assert.equal((await directory.touch(session.session_id, 30_000))?.last_used_at_ms, 30_000);
    assert.equal((await directory.touch(session.session_id, 20_000))?.last_used_at_ms, 30_000);
    const revoked = await directory.revokeByToken(token);
    assert.equal(revoked?.revoked, true);
    assert.equal(await directory.resolve(token), null);
    assert.equal(await directory.revoke(session.session_id), null);
    assert.equal(
      (await directory.listRevoked("dev-0123456789abcdef")).map((entry) => entry.session_id).join(),
      session.session_id
    );
  });

  it("bounds live sessions per subject and expires by ttl", async () => {
    let now = 10_000;
    const { directory } = await directoryWith({
      clock: () => now,
      ttlMs: 5_000
    });
    const subject = "dev-0123456789abcdef";
    const tokens: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      now += 100;
      const { token } = await directory.issue({ subject, source: "telegram", kyc: "kyc-gated" });
      tokens.push(token);
    }
    // The per-subject bound is 5: the two oldest sessions were evicted.
    assert.equal((await directory.listFor(subject)).length, 5);
    assert.equal(await directory.resolve(tokens[0] ?? ""), null);
    assert.equal(await directory.resolve(tokens[1] ?? ""), null);
    now += 10_000;
    assert.equal(await directory.countLive(), 0);
    for (const token of tokens) assert.equal(await directory.resolve(token), null);
  });

  it("rejects a missing store and malformed directory bounds", async () => {
    assert.throws(
      () => createCustomerSessionDirectory({ store: undefined as unknown as SessionStore }),
      /required/
    );
    const store = createMemorySessionStore();
    await store.initialize();
    for (const overrides of [{ ttlMs: 0 }, { ttlMs: 1.5 }, { maxPerSubject: 0 }, { listLimit: -1 }]) {
      assert.throws(
        () => createCustomerSessionDirectory({ store, ...overrides }),
        /positive integer|positive/
      );
    }
    await store.close();
  });
});
