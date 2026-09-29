import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoRepository } from "../data/demo.js";
import { AuditIntegrityError, MemoryAuditStore } from "./audit-store.js";
import { verifyAuditChain } from "./controls.js";

describe("audit store", () => {
  it("returns a verified synthetic snapshot with retention metadata", async () => {
    const store = new MemoryAuditStore(demoRepository.auditSource(), 30);
    const snapshot = await store.snapshot();
    assert.equal(snapshot.status.backend, "synthetic-memory");
    assert.equal(snapshot.status.durable, false);
    assert.equal(snapshot.status.retentionDays, 30);
    assert.equal(snapshot.status.verified, true);
    assert.equal(snapshot.status.length, snapshot.events.length);
    assert.equal(snapshot.status.headHash, snapshot.events.at(-1)?.hash);
  });

  it("appends without breaking the chain", async () => {
    const store = new MemoryAuditStore(demoRepository.auditSource(), 30);
    const before = await store.snapshot();
    const appended = await store.append({
      eventId: "AUD-000154",
      occurredAt: "2026-09-29T10:30:00.000Z",
      actor: "service:test",
      action: "audit.tested",
      resource: "audit-store:synthetic",
      outcome: "recorded",
      evidenceDigest: "sha256:9c04304c88dd"
    }, before.status.headHash);
    const snapshot = await store.snapshot();
    assert.equal(appended.sequence, 7);
    assert.equal(snapshot.status.length, 7);
    assert.equal(verifyAuditChain(snapshot.events), true);
  });

  it("rejects stale heads and duplicate event IDs", async () => {
    const store = new MemoryAuditStore(demoRepository.auditSource(), 30);
    const existing = demoRepository.auditSource()[0];
    await assert.rejects(
      store.append(existing, "f".repeat(64)),
      AuditIntegrityError
    );
    const snapshot = await store.snapshot();
    await assert.rejects(
      store.append(existing, snapshot.status.headHash),
      AuditIntegrityError
    );
  });
});
