import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createKycCallbackInbox } from "../src/index.mjs";

/**
 * Regression tests for the wave-47 notification/delivery audit: the callback
 * inbox must let consumers retire a dead subject together with the dedup
 * records it produced, so per-resource state cannot outlive the resource that
 * created it (reset/evicted applications otherwise leak forever).
 */

const SUBJECT = "kycref_00000000000000000000000000000001";
const EVENT = {
  event_id: "kycevt_00000000000000000000000000000001",
  provider_reference: SUBJECT,
  applicant_ref: "sim-applicant-1",
  level: "basic",
  sequence: 1,
  status: "in_review",
};

describe("callback inbox discard", () => {
  test("a discarded subject is fully forgotten: state, buffer and dedup records", () => {
    const inbox = createKycCallbackInbox();
    inbox.openSubject(SUBJECT, { deadline: 10_000 });
    assert.equal(inbox.accept(EVENT, { receivedAt: 100 }).action, "applied");
    assert.equal(
      inbox.accept(
        { ...EVENT, sequence: 3, event_id: "kycevt_00000000000000000000000000000003" },
        { receivedAt: 100 },
      ).action,
      "buffered",
    );
    assert.equal(inbox.get(SUBJECT).buffered, 1);

    assert.equal(inbox.discard(SUBJECT), true);
    assert.equal(inbox.get(SUBJECT), undefined);
    // The dedup record went with the subject: a replayed event is unknown,
    // not "duplicate"...
    assert.deepEqual(inbox.accept(EVENT, { receivedAt: 100 }), {
      action: "unknown_subject",
      status: null,
      appliedStatuses: [],
    });
    // ...and reopening the id starts fresh instead of reviving stale state.
    inbox.openSubject(SUBJECT, { deadline: 10_000 });
    assert.equal(inbox.accept(EVENT, { receivedAt: 100 }).action, "applied");
    assert.equal(inbox.get(SUBJECT).status, "in_review");
    assert.equal(inbox.discard(SUBJECT), true);
    assert.equal(inbox.discard(SUBJECT), false);
    assert.equal(inbox.discard("kycref_unknown"), false);
  });

  test("discarding one subject leaves other subjects and their dedup records intact", () => {
    const inbox = createKycCallbackInbox();
    const other = "kycref_00000000000000000000000000000002";
    inbox.openSubject(SUBJECT, { deadline: 10_000 });
    inbox.openSubject(other, { deadline: 10_000 });
    const otherEvent = {
      ...EVENT,
      event_id: "kycevt_00000000000000000000000000000002",
      provider_reference: other,
    };
    assert.equal(inbox.accept(EVENT, { receivedAt: 100 }).action, "applied");
    assert.equal(inbox.accept(otherEvent, { receivedAt: 100 }).action, "applied");

    assert.equal(inbox.discard(SUBJECT), true);
    assert.equal(inbox.accept(otherEvent, { receivedAt: 100 }).action, "duplicate");
    assert.equal(inbox.get(other).status, "in_review");
    assert.equal(inbox.get(SUBJECT), undefined);
  });
});
