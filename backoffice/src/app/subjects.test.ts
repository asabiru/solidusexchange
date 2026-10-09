import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can } from "../auth/access.js";
import { demoRepository, type SubjectTimelineKind } from "../data/demo.js";
import { isSubjectRef } from "../server/subjects.js";
import { hasMessage } from "./i18n.js";
import { navigation } from "./navigation.js";

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
    const timeline = demoRepository.subjectTimeline("sim-alina-mironova");
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

  it("returns undefined for unmatched refs and stays silent about coverage", () => {
    assert.equal(demoRepository.subjectTimeline("sim-ghost-404"), undefined);
    assert.equal(demoRepository.subjectTimeline("cust_missing_01"), undefined);
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
