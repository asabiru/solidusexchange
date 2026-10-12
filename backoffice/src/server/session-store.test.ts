import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerSessionStoreContract } from "./session-store-contract.js";
import {
  type SessionIssueCommand,
  type SessionStore,
  createMemorySessionStore,
  createOperatorSessionDirectory,
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

describe("operator session directory", () => {
  const directoryWith = async (overrides: Partial<{
    store: SessionStore;
    clock: () => number;
    ttlMs: number;
  }> = {}) => {
    const store = overrides.store ?? createMemorySessionStore();
    await store.initialize?.();
    return {
      store,
      directory: createOperatorSessionDirectory({
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
        };
      },
      async getSession() {
        return null;
      },
      async getSessionByTokenDigest() {
        return null;
      },
      async refreshSession() {
        return null;
      },
      async revokeSession() {
        return null;
      },
      async bindDevice() {
        return null;
      },
      async sweepExpiredSessions() {
        return { swept: 0 };
      },
      async listSessions() {
        return Object.freeze([]);
      },
      async countSessions() {
        return 0;
      },
      async close() {}
    };
    const { directory } = await directoryWith({ store: probe });
    const { session, token } = await directory.issue({
      subject: "dev:compliance-lead",
      email: "lead@dev.solidchange.invalid",
      name: "Мария Коваль",
      role: "compliance-lead"
    });
    assert.match(session.id, /^sess_[0-9a-f]{24}$/u);
    assert.match(token, /^sbt_[0-9a-f]{64}$/u);
    assert.equal(seen.length, 1);
    // The store only ever receives the namespaced digest of the bearer —
    // raw tokens and raw device ids never reach it.
    assert.equal(seen[0].token_digest, digestSessionToken(token));
    assert.equal(seen[0].token_digest.includes(token), false);
    assert.equal(token.includes(seen[0].token_digest), false);
    assert.equal(seen[0].device_digest, null);
    assert.equal(seen[0].expires_at_ms - seen[0].issued_at_ms, 60_000);
  });

  it("resolve and revokeByToken treat garbage cookie material as absent", async () => {
    const { directory } = await directoryWith();
    for (const garbage of [
      "",
      "opaque_garbage",
      "sbt_uppercase",
      "a".repeat(512),
      "sbt_" + "f".repeat(64) + "extra"
    ]) {
      assert.equal(await directory.resolve(garbage), null);
      assert.equal(await directory.revokeByToken(garbage), null);
    }
  });

  it("issues, resolves, rotates and revokes around the minted bearer", async () => {
    const { directory } = await directoryWith();
    const { session, token } = await directory.issue({
      subject: "dev:auditor",
      email: "",
      name: "",
      role: "auditor",
      deviceDigest: "0".repeat(64)
    });
    const resolved = await directory.resolve(token);
    assert.equal(resolved?.id, session.id);
    assert.equal(resolved?.deviceDigest, "0".repeat(64));
    const rotated = await directory.refresh(session.id);
    assert.ok(rotated !== null);
    assert.notEqual(rotated.token, token);
    // Refresh is a rotation: the old bearer is dead immediately.
    assert.equal(await directory.resolve(token), null);
    assert.equal((await directory.resolve(rotated.token))?.id, session.id);
    await directory.revokeByToken(rotated.token);
    assert.equal(await directory.resolve(rotated.token), null);
    assert.equal(await directory.refresh(session.id), null);
  });

  it("expires sessions on the injected clock", async () => {
    let now = 10_000;
    const { directory } = await directoryWith({ clock: () => now });
    const { token } = await directory.issue({
      subject: "dev:support-l1",
      email: "l1@dev.solidchange.invalid",
      name: "Support One",
      role: "support-l1"
    });
    now = 70_001;
    assert.equal(await directory.resolve(token), null);
    assert.equal(await directory.countLive(), 0);
  });

  it("pins id and token entropy to the crypto generators", () => {
    assert.match(mintSessionId(), /^sess_[0-9a-f]{24}$/u);
    assert.match(mintSessionToken(), /^sbt_[0-9a-f]{64}$/u);
    assert.match(digestSessionToken("sbt_" + "0".repeat(64)), /^[0-9a-f]{64}$/u);
  });
});
