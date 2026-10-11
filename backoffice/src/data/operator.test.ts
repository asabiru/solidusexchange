import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseOperatorQueueView,
  parseOperatorSubjectsView,
  parseOperatorSubjectView
} from "./operator.js";

const subjectA = {
  subjectId: "syn_cust_alpha001",
  displayName: "Aibek Ermatov",
  kycStatus: "verified",
  flags: 2,
  registeredAt: "2026-01-15T09:00:00.000Z",
  lastActiveAt: "2026-10-10T08:30:00.000Z",
  posting: "none"
} as const;

const subjectB = {
  subjectId: "syn_cust_bravo002",
  displayName: "Bermet Ashymova",
  kycStatus: "pending",
  flags: 0,
  registeredAt: "2026-03-02T11:00:00.000Z",
  lastActiveAt: "2026-10-09T17:45:00.000Z",
  posting: "none"
} as const;

const subjectsPayload = { mode: "test", subjects: [subjectA, subjectB] } as const;

const subjectDetailPayload = {
  mode: "test",
  subject: {
    ...subjectA,
    accountStatus: "active",
    contactHash: "cth_5f4dcc3b5aa765d61d8327deb882cf99",
    sessions: 3,
    devices: ["dev_00112233aabbccdd", "dev_0123456789abcdef"],
    limits: { maxSessions: 8, maxDevices: 4 }
  }
} as const;

const queueItem = {
  queueId: "qky_0123456789abcdef01234567",
  subjectId: "syn_cust_alpha001",
  displayName: "Aibek Ermatov",
  submittedAt: "2026-10-08T10:00:00.000Z",
  slaDueAt: "2026-10-12T10:00:00.000Z",
  state: "pending",
  priority: "high",
  assignee: null,
  ageMs: 120000
} as const;

const queuePayload = {
  mode: "test",
  queue: {
    kind: "kyc",
    items: [queueItem],
    summary: { count: 1, byState: { pending: 1, inReview: 0, escalated: 0 } },
    posting: "none"
  }
} as const;

describe("operator subjects adapter", () => {
  it("maps every signed field onto the view model", () => {
    const parsed = parseOperatorSubjectsView(subjectsPayload);
    assert.ok(parsed !== undefined);
    assert.equal(parsed.mode, "test");
    assert.equal(parsed.subjects.length, 2);
    const row = parsed.subjects[0];
    assert.equal(row.subjectId, subjectA.subjectId);
    assert.equal(row.displayName, subjectA.displayName);
    assert.equal(row.kycStatus, "verified");
    assert.equal(row.flags, 2);
    assert.equal(row.registeredAt, subjectA.registeredAt);
    assert.equal(row.lastActiveAt, subjectA.lastActiveAt);
    assert.equal(row.posting, "none");
  });

  it("rejects a payload with a forged extra key", () => {
    assert.equal(parseOperatorSubjectsView({ ...subjectsPayload, adminNote: "x" }), undefined);
    const forged = { ...subjectA, balance: "1000" };
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [forged] }), undefined);
  });

  it("rejects non-test mode, wrong refs, unknown enums and incoherent timestamps", () => {
    assert.equal(parseOperatorSubjectsView({ mode: "prod", subjects: [subjectA] }), undefined);
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [{ ...subjectA, subjectId: "cus_001" }] }), undefined);
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [{ ...subjectA, kycStatus: "gold" }] }), undefined);
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [{ ...subjectA, displayName: "aibek" }] }), undefined);
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [{ ...subjectA, lastActiveAt: "2025-01-01T00:00:00.000Z" }] }), undefined);
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [{ ...subjectA, posting: "pending" }] }), undefined);
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [subjectA, { ...subjectB, subjectId: subjectA.subjectId }] }), undefined);
  });

  it("rejects null upstream-only fields so the demo fallback takes over", () => {
    const nullish = { ...subjectA, subjectId: null, kycStatus: null };
    assert.equal(parseOperatorSubjectsView({ mode: "test", subjects: [nullish] }), undefined);
  });
});

describe("operator subject detail adapter", () => {
  it("maps the extended detail fields", () => {
    const parsed = parseOperatorSubjectView(subjectDetailPayload);
    assert.ok(parsed !== undefined);
    const subject = parsed.subject;
    assert.equal(subject.accountStatus, "active");
    assert.equal(subject.contactHash, "cth_5f4dcc3b5aa765d61d8327deb882cf99");
    assert.equal(subject.sessions, 3);
    assert.deepEqual([...subject.devices], ["dev_00112233aabbccdd", "dev_0123456789abcdef"]);
    assert.equal(subject.limits.maxSessions, 8);
    assert.equal(subject.limits.maxDevices, 4);
  });

  it("rejects forged envelopes and invalid detail axes", () => {
    assert.equal(parseOperatorSubjectView({ ...subjectDetailPayload, extra: true }), undefined);
    const cases: Record<string, unknown> = {
      accountStatus: "suspended",
      contactHash: "aibek@example.dev",
      sessions: 17,
      devices: ["not-a-device"],
      limits: { maxSessions: 8 }
    };
    for (const [key, value] of Object.entries(cases)) {
      assert.equal(parseOperatorSubjectView({ mode: "test", subject: { ...subjectDetailPayload.subject, [key]: value } }), undefined, key);
    }
    assert.equal(
      parseOperatorSubjectView({ mode: "test", subject: { ...subjectDetailPayload.subject, sessions: 9 } }),
      undefined,
      "sessions beyond the limits echo"
    );
    assert.equal(
      parseOperatorSubjectView({ mode: "test", subject: { ...subjectDetailPayload.subject, devices: ["dev_0123456789abcdef", "dev_0123456789abcdef"] } }),
      undefined,
      "duplicated device ref"
    );
  });
});

describe("operator queue adapter", () => {
  it("maps queue items and the summary", () => {
    const parsed = parseOperatorQueueView(queuePayload);
    assert.ok(parsed !== undefined);
    assert.equal(parsed.queue.kind, "kyc");
    assert.equal(parsed.queue.posting, "none");
    assert.equal(parsed.queue.summary.count, 1);
    assert.deepEqual({ ...parsed.queue.summary.byState }, { pending: 1, inReview: 0, escalated: 0 });
    const item = parsed.queue.items[0];
    assert.equal(item.queueId, queueItem.queueId);
    assert.equal(item.state, "pending");
    assert.equal(item.priority, "high");
    assert.equal(item.assignee, null);
    assert.equal(item.ageMs, 120000);
  });

  it("accepts an assigned operator ref", () => {
    const assigned = { ...queueItem, assignee: { subject: "syn_oper_alice001" }, state: "in_review" };
    const payload = {
      mode: "test",
      queue: {
        kind: "kyc",
        items: [assigned],
        summary: { count: 1, byState: { pending: 0, inReview: 1, escalated: 0 } },
        posting: "none"
      }
    };
    const parsed = parseOperatorQueueView(payload);
    assert.ok(parsed !== undefined);
    assert.deepEqual(parsed.queue.items[0].assignee, { subject: "syn_oper_alice001" });
  });

  it("rejects summary tallies that do not match the items", () => {
    const payload = {
      mode: "test",
      queue: {
        ...queuePayload.queue,
        summary: { count: 2, byState: { pending: 1, inReview: 0, escalated: 0 } }
      }
    };
    assert.equal(parseOperatorQueueView(payload), undefined);
  });

  it("rejects malformed items and envelope drift", () => {
    const cases: Record<string, unknown> = {
      queueId: "q_1",
      subjectId: "syn_oper_alice001",
      state: "done",
      priority: "critical",
      slaDueAt: "2026-10-08T10:00:00.000Z",
      ageMs: -1,
      assignee: { subject: "syn_cust_alpha001" }
    };
    for (const [key, value] of Object.entries(cases)) {
      const item = { ...queueItem, [key]: value };
      assert.equal(
        parseOperatorQueueView({
          mode: "test",
          queue: { kind: "kyc", items: [item], summary: { count: 1, byState: { pending: 1, inReview: 0, escalated: 0 } }, posting: "none" }
        }),
        undefined,
        key
      );
    }
    assert.equal(parseOperatorQueueView({ mode: "test", queue: { ...queuePayload.queue, kind: "aml" } }), undefined);
    assert.equal(parseOperatorQueueView({ mode: "test", queue: { ...queuePayload.queue, posting: "pending" } }), undefined);
  });
});
