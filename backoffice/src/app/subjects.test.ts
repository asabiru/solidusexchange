import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can } from "../auth/access.js";
import { demoRepository, type SubjectTimelineKind } from "../data/demo.js";
import { isSubjectRef } from "../server/subjects.js";
import { hasMessage } from "./i18n.js";
import { navigation } from "./navigation.js";
import { operatorActivityKindKeyOf, operatorActivitySummaryKeyOf } from "./server-fields.js";

const timelineKinds = [
  "check",
  "support",
  "withdrawal",
  "kyc",
  "aml",
  "investigation",
  "fraud-alert",
  "audit"
] as const satisfies readonly SubjectTimelineKind[];

describe("subject timeline wiring", () => {
  it("exposes a subjects screen gated by the subjects:read capability", () => {
    const item = navigation.find((entry) => entry.id === "subjects");
    assert.ok(item);
    assert.equal(item.group, "customer-risk");
    assert.equal(item.capability, "subjects:read");
    assert.equal(item.implemented, true);
    for (const role of ["compliance-lead", "support-l1", "aml-investigator", "auditor"]) {
      assert.equal(can(role, "subjects:read"), true, role);
    }
    assert.equal(can("fraud-investigator", "subjects:read"), false);
  });

  it("covers every timeline kind with a localized badge label", () => {
    for (const kind of timelineKinds) {
      assert.equal(hasMessage(`subjects.kind.${kind}`), true, kind);
    }
    for (const key of [
      "screen.subjects",
      "subjects.description",
      "subjects.lookupTitle",
      "subjects.lookupHint",
      "subjects.refLabel",
      "subjects.refPlaceholder",
      "subjects.submit",
      "subjects.searching",
      "subjects.invalidRef",
      "subjects.notFound",
      "subjects.failed",
      "subjects.empty",
      "subjects.subject",
      "subjects.entriesLabel",
      "subjects.count",
      "subjects.readOnlyTitle",
      "subjects.readOnlyNote"
    ]) {
      assert.equal(hasMessage(key), true, key);
    }
  });

  it("aggregates every entity family into a frozen, newest-first feed", () => {
    const timeline = demoRepository.subjectTimeline("sim-alina-mironova", new Set(timelineKinds));
    assert.ok(timeline);
    assert.equal(timeline.subject, "sim-alina-mironova");
    assert.ok(Object.isFrozen(timeline));
    assert.ok(Object.isFrozen(timeline.entries));
    const kinds = new Set(timeline.entries.map((entry) => entry.kind));
    for (const kind of timelineKinds) assert.ok(kinds.has(kind), kind);
    for (const entry of timeline.entries) {
      assert.ok(Object.isFrozen(entry), entry.ref);
      assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(entry.ref.length > 0 && entry.summary.length > 0);
    }
    for (let index = 1; index < timeline.entries.length; index += 1) {
      assert.ok(timeline.entries[index - 1].at >= timeline.entries[index].at);
    }
    // Read-only shape: no command surface leaks into timeline entries.
    for (const entry of timeline.entries) {
      assert.deepEqual(
        Object.keys(entry).filter((key) => /release|refund|execute|command|action/i.test(key)),
        []
      );
    }
  });

  it("covers every operator activity kind and summary with a localized label", () => {
    const kinds = [
      "deposit", "withdrawal", "quote", "order", "payment", "card", "check", "kyc", "security",
      "kyc_transition", "flag_added"
    ] as const;
    for (const kind of kinds) {
      const key = operatorActivityKindKeyOf(kind);
      assert.ok(key !== undefined, kind);
      assert.equal(hasMessage(key), true, `${kind} -> ${key}`);
    }
    const summaries = [
      "awaiting_payment", "payment_received", "partial_payment", "duplicate_payment", "payment_reversed",
      "expired_no_payment", "draft", "screened", "pending_maker_approval", "pending_checker_approval",
      "unsigned_intent_ready", "broadcast", "confirmed", "rejected", "cancelled", "expired", "indicative",
      "open", "created", "processing", "completed", "failed", "reversed", "pending_activation", "active",
      "frozen", "blocked", "terminated", "awaiting_confirmation", "awaiting_recipient_kyc", "claimed",
      "submitted", "in_review", "approved", "needs_more_data", "timed_out", "unavailable", "login",
      "revoked", "structuring", "velocity", "geo_mismatch"
    ] as const;
    for (const summary of summaries) {
      const key = operatorActivitySummaryKeyOf(summary);
      assert.ok(key !== undefined, summary);
      assert.equal(hasMessage(key), true, `${summary} -> ${key}`);
    }
    assert.equal(operatorActivityKindKeyOf("unknown-kind"), undefined);
    assert.equal(operatorActivitySummaryKeyOf("free text"), undefined);
    assert.equal(hasMessage("customers.recentActivity"), true);
  });

  it("returns undefined for unmatched refs and stays silent about coverage", () => {
    assert.equal(demoRepository.subjectTimeline("sim-ghost-404", new Set(timelineKinds)), undefined);
    assert.equal(demoRepository.subjectTimeline("cust_missing_01", new Set(timelineKinds)), undefined);
  });

  it("validates the subject ref shape before lookup", () => {
    for (const ref of ["sim-alina-mironova", "cust_1234", "CUS-10482", "a".repeat(4), "a".repeat(64)]) {
      assert.equal(isSubjectRef(ref), true, ref);
    }
    for (const ref of ["abc", "a".repeat(65), "has space", "semi;colon", "dots.are.bad", ""]) {
      assert.equal(isSubjectRef(ref), false, ref);
    }
  });
});
