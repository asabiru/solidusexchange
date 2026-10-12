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
    limits: { maxSessions: 8, maxDevices: 4 },
    recentActivity: [
      {
        activityId: `opact_${"c".repeat(24)}`,
        kind: "flag_added",
        occurredAt: "2026-10-10T12:00:00.000Z",
        summary: "velocity",
        money: null
      },
      {
        activityId: `act_${"d".repeat(24)}`,
        kind: "deposit",
        occurredAt: "2026-10-09T08:00:00.000Z",
        summary: "payment_received",
        money: { amount: "1250.00", asset: "RUB" }
      }
    ],
    kyc: {
      status: "approved",
      level: "enhanced",
      sessionId: `kys_${"a".repeat(24)}`,
      history: [
        {
          sessionId: `kys_${"a".repeat(24)}`,
          state: "approved",
          submittedAt: "2026-09-15T10:00:00.000Z",
          decidedAt: "2026-09-20T10:00:00.000Z",
          rejectionReason: null
        },
        {
          sessionId: `kys_${"b".repeat(24)}`,
          state: "rejected",
          submittedAt: "2026-09-10T08:00:00.000Z",
          decidedAt: "2026-09-12T09:00:00.000Z",
          rejectionReason: "SIM_DATA_MISMATCH"
        }
      ]
    }
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
    const parsed = parseOperatorSubjectView(subjectDetailPayload, subjectDetailPayload.subject.subjectId);
    assert.ok(parsed !== undefined);
    const subject = parsed.subject;
    assert.equal(subject.accountStatus, "active");
    assert.equal(subject.contactHash, "cth_5f4dcc3b5aa765d61d8327deb882cf99");
    assert.equal(subject.sessions, 3);
    assert.deepEqual([...subject.devices], ["dev_00112233aabbccdd", "dev_0123456789abcdef"]);
    assert.equal(subject.limits.maxSessions, 8);
    assert.equal(subject.limits.maxDevices, 4);
    assert.equal(subject.recentActivity.length, 2);
    const first = subject.recentActivity[0];
    assert.equal(first.kind, "flag_added");
    assert.equal(first.money, null);
    const second = subject.recentActivity[1];
    assert.equal(second.activityId, `act_${"d".repeat(24)}`);
    assert.equal(second.summary, "payment_received");
    assert.deepEqual(second.money, { amount: "1250.00", asset: "RUB" });
    // The kyc dossier parses through with the header echoing history[0].
    const kyc = subject.kyc;
    assert.ok(kyc !== null);
    assert.equal(kyc.status, "approved");
    assert.equal(kyc.level, "enhanced");
    assert.equal(kyc.sessionId, kyc.history[0].sessionId);
    assert.equal(kyc.history[0].state, kyc.status);
    assert.equal(kyc.history[1].rejectionReason, "SIM_DATA_MISMATCH");
  });

  it("accepts a null kyc dossier and degrades a malformed one to the no-dossier state", () => {
    const subjectId = subjectDetailPayload.subject.subjectId;
    // A null block is the contract's no-dossier marker.
    const absent = parseOperatorSubjectView(
      { mode: "test", subject: { ...subjectDetailPayload.subject, kyc: null } },
      subjectId
    );
    assert.ok(absent !== undefined);
    assert.equal(absent.subject.kyc, null);
    // A malformed block degrades like the sibling reads: the rest of the
    // detail still parses instead of failing the whole view closed.
    const kyc = subjectDetailPayload.subject.kyc;
    const drifts: readonly unknown[] = [
      "dossier",
      [],
      {},
      { ...kyc, status: "approved", level: "premium" },
      { ...kyc, status: "unavailable" },
      { ...kyc, status: "rejected" }, // roster is verified: only approved coheres
      { ...kyc, session_id: `kys_${"0".repeat(24)}` },
      { ...kyc, sessionId: "kys_nothex" },
      { ...kyc, history: [] },
      { ...kyc, history: [...kyc.history].reverse() },
      { ...kyc, history: kyc.history.map((attempt) => ({ ...attempt, sessionId: `kys_${"0".repeat(24)}` })) },
      { ...kyc, history: [{ ...kyc.history[0], decidedAt: null }, ...kyc.history.slice(1)] },
      { ...kyc, history: [{ ...kyc.history[0], state: "in_review" }, ...kyc.history.slice(1)] },
      { ...kyc, history: [{ ...kyc.history[0], rejectionReason: "SIM_DATA_MISMATCH" }, ...kyc.history.slice(1)] },
      { ...kyc, history: [kyc.history[0], { ...kyc.history[1], state: "approved" }] },
      { ...kyc, history: [kyc.history[0], { ...kyc.history[1], decidedAt: "2027-01-01T00:00:00.000Z" }] }
    ];
    for (const value of drifts) {
      const parsed = parseOperatorSubjectView(
        { mode: "test", subject: { ...subjectDetailPayload.subject, kyc: value } },
        subjectId
      );
      assert.ok(parsed !== undefined, JSON.stringify(value).slice(0, 96));
      assert.equal(parsed.subject.kyc, null, JSON.stringify(value).slice(0, 96));
    }
    // But a missing kyc key breaks the pinned detail shape like any other.
    const { kyc: _dropped, ...without } = subjectDetailPayload.subject;
    assert.equal(parseOperatorSubjectView({ mode: "test", subject: without }, subjectId), undefined);
  });

  it("rejects forged envelopes and invalid detail axes", () => {
    assert.equal(parseOperatorSubjectView({ ...subjectDetailPayload, extra: true }, subjectDetailPayload.subject.subjectId), undefined);
    const cases: Record<string, unknown> = {
      accountStatus: "suspended",
      contactHash: "aibek@example.dev",
      sessions: 17,
      devices: ["not-a-device"],
      limits: { maxSessions: 8 },
      recentActivity: []
    };
    for (const [key, value] of Object.entries(cases)) {
      assert.equal(parseOperatorSubjectView({ mode: "test", subject: { ...subjectDetailPayload.subject, [key]: value } }, subjectDetailPayload.subject.subjectId), undefined, key);
    }
    assert.equal(
      parseOperatorSubjectView({ mode: "test", subject: { ...subjectDetailPayload.subject, sessions: 9 } }, subjectDetailPayload.subject.subjectId),
      undefined,
      "sessions beyond the limits echo"
    );
    assert.equal(
      parseOperatorSubjectView({ mode: "test", subject: { ...subjectDetailPayload.subject, devices: ["dev_0123456789abcdef", "dev_0123456789abcdef"] } }, subjectDetailPayload.subject.subjectId),
      undefined,
      "duplicated device ref"
    );
  });

  it("rejects malformed recent_activity items", () => {
    const [first, second] = subjectDetailPayload.subject.recentActivity;
    const subjectId = subjectDetailPayload.subject.subjectId;
    const drifts: readonly unknown[] = [
      "not-an-array",
      [{ ...first, activityId: `act_${"c".repeat(24)}` }],
      [{ ...first, kind: "deposit" }],
      [{ ...first, summary: "free text" }],
      [{ ...first, summary: "approved" }],
      [{ ...second, summary: "approved" }],
      [{ ...first, occurredAt: "yesterday" }],
      [{ ...first, money: { amount: "1.00", asset: "RUB" } }],
      [{ ...second, money: null }],
      [{ ...second, money: { amount: "1250.0", asset: "RUB" } }],
      [{ ...second, money: { amount: "1250.00", asset: "XXX" } }],
      [{ ...second, money: { amount: "0.00", asset: "RUB" } }],
      [second, first],
      [first, { ...second, activityId: first.activityId }],
      Array.from({ length: 9 }, (_value, index) => ({
        ...first,
        activityId: `opact_${"0".repeat(23)}${index}`,
        occurredAt: `2026-10-${String(20 - index).padStart(2, "0")}T00:00:00.000Z`
      }))
    ];
    for (const recentActivity of drifts) {
      assert.equal(
        parseOperatorSubjectView({ mode: "test", subject: { ...subjectDetailPayload.subject, recentActivity } }, subjectId),
        undefined,
        JSON.stringify(recentActivity).slice(0, 96)
      );
    }
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
    assert.equal(parseOperatorQueueView({ mode: "test", queue: { ...queuePayload.queue, kind: "fraud" } }), undefined);
    assert.equal(parseOperatorQueueView({ mode: "test", queue: { ...queuePayload.queue, posting: "pending" } }), undefined);
  });

  it("maps the aml projection with its own item shape", () => {
    const amlItem = {
      queueId: "qml_0123456789abcdef01234567",
      subjectId: "syn_cust_alpha001",
      alertType: "structuring",
      evidenceRefs: ["evd_0123456789abcdef01234567", "evd_89abcdef0123456701234567"],
      slaDueAt: "2026-10-12T10:00:00.000Z",
      state: "in_review",
      priority: "high",
      assignee: { subject: "syn_oper_alice001" },
      ageMs: 120000
    };
    const parsed = parseOperatorQueueView({
      mode: "test",
      queue: {
        kind: "aml",
        items: [amlItem],
        summary: { count: 1, byState: { pending: 0, inReview: 1, escalated: 0 } },
        posting: "none"
      }
    });
    assert.ok(parsed !== undefined);
    assert.equal(parsed.queue.kind, "aml");
    if (parsed.queue.kind !== "aml") return;
    const item = parsed.queue.items[0];
    assert.equal(item.alertType, "structuring");
    assert.deepEqual([...item.evidenceRefs], [...amlItem.evidenceRefs]);
    assert.equal(item.slaDueAt, amlItem.slaDueAt);
    assert.equal(item.assignee?.subject, "syn_oper_alice001");
  });

  it("maps the tickets projection with its own item shape and state vocabulary", () => {
    const ticketItem = {
      queueId: "qtick_0123456789abcdef01234567",
      subjectId: "syn_cust_alpha001",
      category: "operation_problem",
      openedAt: "2026-10-09T10:00:00.000Z",
      state: "waiting",
      priority: "normal",
      assignee: { subject: "syn_oper_alice001" },
      ageMs: 120000
    };
    const parsed = parseOperatorQueueView({
      mode: "test",
      queue: {
        kind: "tickets",
        items: [ticketItem],
        summary: { count: 1, byState: { open: 0, waiting: 1, escalated: 0 } },
        posting: "none"
      }
    });
    assert.ok(parsed !== undefined);
    if (parsed.queue.kind !== "tickets") return;
    const item = parsed.queue.items[0];
    assert.equal(item.category, "operation_problem");
    assert.equal(item.openedAt, ticketItem.openedAt);
    assert.equal(item.state, "waiting");
  });

  it("rejects per-kind item and state drift", () => {
    const amlItem = {
      queueId: "qml_0123456789abcdef01234567",
      subjectId: "syn_cust_alpha001",
      alertType: "structuring",
      evidenceRefs: ["evd_0123456789abcdef01234567"],
      slaDueAt: "2026-10-12T10:00:00.000Z",
      state: "pending",
      priority: "high",
      assignee: null,
      ageMs: 120000
    };
    const amlQueue = (item: unknown, byState: unknown = { pending: 1, inReview: 0, escalated: 0 }) => ({
      mode: "test",
      queue: { kind: "aml", items: [item], summary: { count: 1, byState }, posting: "none" }
    });
    const ticketItem = {
      queueId: "qtick_0123456789abcdef01234567",
      subjectId: "syn_cust_alpha001",
      category: "complaint",
      openedAt: "2026-10-09T10:00:00.000Z",
      state: "open",
      priority: "normal",
      assignee: null,
      ageMs: 120000
    };
    const ticketQueue = (item: unknown, byState: unknown = { open: 1, waiting: 0, escalated: 0 }) => ({
      mode: "test",
      queue: { kind: "tickets", items: [item], summary: { count: 1, byState }, posting: "none" }
    });
    const cases: [unknown, string][] = [
      [amlQueue({ ...amlItem, alertType: "sanctions" }), "aml alert type"],
      [amlQueue({ ...amlItem, evidenceRefs: ["evd_short"] }), "aml evidence ref grammar"],
      [amlQueue({ ...amlItem, evidenceRefs: [] }), "aml empty evidence"],
      [amlQueue({ ...amlItem, evidenceRefs: ["evd_0123456789abcdef01234567", "evd_0123456789abcdef01234567"] }), "aml duplicate evidence"],
      [amlQueue({ ...amlItem, queueId: "qky_0123456789abcdef01234567" }), "aml wrong ref family"],
      [amlQueue({ ...amlItem, state: "open" }), "aml state outside kyc vocabulary"],
      [amlQueue(amlItem, { open: 1, waiting: 0, escalated: 0 }), "aml summary in ticket vocabulary"],
      [amlQueue({ ...amlItem, displayName: "Aibek Ermatov" }), "aml extra key"],
      [ticketQueue({ ...ticketItem, category: "appeal" }), "ticket category"],
      [ticketQueue({ ...ticketItem, state: "pending" }), "ticket state outside vocabulary"],
      [ticketQueue({ ...ticketItem, queueId: "tck_0123456789abcdef01234567" }), "ticket wrong ref family"],
      [ticketQueue(ticketItem, { pending: 1, inReview: 0, escalated: 0 }), "ticket summary in kyc vocabulary"],
      [ticketQueue({ ...ticketItem, slaDueAt: "2026-10-12T10:00:00.000Z" }), "ticket extra key"]
    ];
    for (const [payload, label] of cases) {
      assert.equal(parseOperatorQueueView(payload), undefined, label);
    }
  });
});
