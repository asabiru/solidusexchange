import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticOperatorSubjectsDirectory, validOperatorSubjectDetailView } from "../src/operator.mjs";

// Wave-64 adversarial audit of the composed operator subject-360 view: the
// #294 base detail, the #306 recent_activity page and the #312 kyc dossier
// were each audited in isolation; this suite probes the composed view for
// cross-block disagreements, impossible instants and derived-id collisions.
const directory = createSyntheticOperatorSubjectsDirectory();
const subjectsView = await directory.subjectsFor();
const details = await Promise.all(subjectsView.subjects.map((row) => directory.subjectFor(row.subject_id)));
const queues = {
  kyc: await directory.queueFor("kyc"),
  aml: await directory.queueFor("aml"),
  tickets: await directory.queueFor("tickets")
};

const SUBJECT_SIDE_KINDS = new Set(["kyc_transition"]);

test("every activity instant sits inside the account window", () => {
  for (const detail of details) {
    const subject = detail.subject;
    const registeredMs = Date.parse(subject.registered_at);
    const lastActiveMs = Date.parse(subject.last_active_at);
    for (const item of subject.recent_activity) {
      const occurredMs = Date.parse(item.occurred_at);
      // Nothing can happen on an account that does not exist yet.
      assert.ok(occurredMs >= registeredMs, `${subject.subject_id} ${item.activity_id} before registered_at`);
      // An operator-side event (flag raise, kyc decision) can legitimately
      // land after the subject's own last-active instant; a subject-side one
      // cannot — the feed items and the submission transition are theirs.
      const operatorSide = item.activity_id.startsWith("opact_") &&
        !(item.kind === "kyc_transition" && item.summary === "submitted");
      if (!operatorSide) {
        assert.ok(occurredMs <= lastActiveMs, `${subject.subject_id} ${item.activity_id} after last_active_at`);
      }
    }
  }
});

test("the dossier's attempt instants sit inside the account window too", () => {
  for (const detail of details) {
    const subject = detail.subject;
    if (subject.kyc === null) continue;
    const registeredMs = Date.parse(subject.registered_at);
    const lastActiveMs = Date.parse(subject.last_active_at);
    for (const attempt of subject.kyc.history) {
      const submittedMs = Date.parse(attempt.submitted_at);
      assert.ok(submittedMs >= registeredMs, `${subject.subject_id} attempt before registered_at`);
      assert.ok(submittedMs <= lastActiveMs, `${subject.subject_id} attempt after last_active_at`);
    }
  }
});

test("live sessions always sit on a device and never on a closed account", () => {
  for (const detail of details) {
    const subject = detail.subject;
    if (subject.sessions > 0) {
      assert.ok(subject.devices.length >= 1, `${subject.subject_id} has sessions on no device`);
      assert.notEqual(subject.account_status, "closed", `${subject.subject_id} closed with live sessions`);
    }
  }
});

test("cross-block instants agree: dossier, queue and transitions share the submission", () => {
  for (const detail of details) {
    const subject = detail.subject;
    const kycItem = queues.kyc.queue.items.find((item) => item.subject_id === subject.subject_id);
    const submittedTransition = subject.recent_activity.find(
      (item) => item.kind === "kyc_transition" && item.summary === "submitted"
    );
    if (subject.kyc !== null) {
      const newest = subject.kyc.history[0];
      if (kycItem !== undefined) {
        assert.equal(kycItem.submitted_at, newest.submitted_at, subject.subject_id);
      }
      if (submittedTransition !== undefined) {
        assert.equal(submittedTransition.occurred_at, newest.submitted_at, subject.subject_id);
      }
      const approvedTransition = subject.recent_activity.find(
        (item) => item.kind === "kyc_transition" && item.summary === "approved"
      );
      if (approvedTransition !== undefined) {
        assert.equal(approvedTransition.occurred_at, newest.decided_at, subject.subject_id);
      }
    } else {
      assert.equal(submittedTransition, undefined, subject.subject_id);
    }
  }
});

test("no derived id collides across subjects or blocks", () => {
  const seen = new Map();
  const claim = (id, where) => {
    assert.ok(!seen.has(id), `${id} claimed by ${seen.get(id)} and ${where}`);
    seen.set(id, where);
  };
  for (const detail of details) {
    const subject = detail.subject;
    claim(subject.contact_hash, `${subject.subject_id} contact`);
    for (const device of subject.devices) claim(device, `${subject.subject_id} device`);
    for (const item of subject.recent_activity) claim(item.activity_id, `${subject.subject_id} activity`);
    if (subject.kyc !== null) {
      for (const attempt of subject.kyc.history) claim(attempt.session_id, `${subject.subject_id} kyc`);
    }
  }
  for (const kind of Object.keys(queues)) {
    for (const item of queues[kind].queue.items) {
      claim(item.queue_id, `${kind} queue ${item.subject_id}`);
      if (item.evidence_refs !== undefined) {
        for (const ref of item.evidence_refs) claim(ref, `${kind} evidence ${item.subject_id}`);
      }
    }
  }
});

test("the served universe still validates verbatim after the coherence fixes", () => {
  for (const detail of details) {
    assert.equal(validOperatorSubjectDetailView(detail), true, detail.subject.subject_id);
  }
});
