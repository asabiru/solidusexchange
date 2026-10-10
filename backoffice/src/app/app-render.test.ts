import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as E, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "./i18n-context.js";
import {
  AmlCaseDetail,
  ApprovalPreviewPanel,
  ApprovalsView,
  AuditView,
  CallbackList,
  CheckDetail,
  ChecksView,
  CustomersView,
  DashboardView,
  EvidenceList,
  FraudDetail,
  FraudView,
  InvestigationDetail,
  KycCaseDetail,
  KycView,
  LinkedRecords,
  ProviderEvidencePanel,
  ReportsView,
  SubjectsView,
  SupportView,
  TicketDetail,
  WithdrawalDetail,
  WithdrawalsView,
  WorkflowChecks
} from "./App.js";

/** Renders a component to a string without a DOM: a hostile payload that throws takes the whole screen down, which is the defect under test. */
function render(element: ReactElement): string {
  return renderToStaticMarkup(E(I18nProvider, null, element));
}

const hostile = (value: unknown): never => value as never;

describe("collection fields that are not arrays", () => {
  it("dashboard renders when metrics and queues are not arrays", () => {
    const html = render(E(DashboardView, { data: hostile({ metrics: "x", queues: {} }) }));
    assert.match(html, /metrics/i);
    assert.doesNotMatch(html, /NaN/);
  });

  it("customers renders when the list is an object and a row carries hostile fields", () => {
    assert.doesNotThrow(() =>
      render(E(CustomersView, { query: "", data: hostile({ customers: "not-an-array" }) }))
    );
    const html = render(
      E(CustomersView, {
        query: "",
        data: hostile({ customers: [{ id: {}, name: [], initials: 7, country: null, kyc: { deep: 1 }, tone: "constructor", risk: {}, riskScore: "high", volume: [], nextAction: { f: 1 } }] })
      })
    );
    assert.match(html, /—/);
    assert.doesNotMatch(html, /\[object Object\]/);
  });

  it("case lists render when cases and nested collections are malformed", () => {
    assert.doesNotThrow(() => render(E(KycView, { query: "", data: hostile({ cases: {}, providerEvidence: { cases: "x" } }) })));
    assert.doesNotThrow(() => render(E(FraudView, { query: "", data: hostile({ alerts: null }) })));
    assert.doesNotThrow(() => render(E(ChecksView, { query: "", data: hostile({ checks: "x", statuses: 5 }) })));
    assert.doesNotThrow(() => render(E(SupportView, { query: "", data: hostile({ tickets: {}, statuses: "x" }) })));
    assert.doesNotThrow(() => render(E(WithdrawalsView, { query: "", data: hostile({ intents: 4, statuses: null }) })));
  });

  it("detail panes render when nested lists are not arrays", () => {
    const detail = {
      id: "KYC-1",
      subject: "s",
      jurisdiction: "kg",
      tone: "warning",
      status: "review",
      riskScore: 42,
      stage: "doc",
      owner: "op",
      openedAt: "now",
      sla: "sla",
      auditEvidenceDigest: "deadbeef",
      evidenceItems: "not-an-array",
      checks: { nested: true },
      linkedApprovalId: null
    };
    const html = render(E(KycCaseDetail, { item: hostile(detail), providerEvidence: "" }));
    assert.match(html, /KYC-1/);

    const aml = { ...detail, source: "kyt", state: "open", exposure: "0", screenings: 7, riskFactors: { a: 1 } };
    const amlHtml = render(E(AmlCaseDetail, { item: hostile(aml), providerEvidence: "" }));
    assert.match(amlHtml, /KYC-1/);

    const investigation = {
      ...detail,
      category: "aml",
      priority: "high",
      summary: "sum",
      relatedAlertIds: "x",
      relatedCaseIds: 5,
      hypotheses: "x",
      timeline: {}
    };
    assert.doesNotThrow(() => render(E(InvestigationDetail, { item: hostile(investigation) })));

    const fraud = { ...detail, channel: "tg", scenario: "sc", score: "x", detectedAt: "y", controlMode: "alert", linkedInvestigationId: null, signals: "x" };
    assert.doesNotThrow(() => render(E(FraudDetail, { item: hostile(fraud) })));
  });

  it("shared list widgets degrade non-array props instead of crashing", () => {
    assert.doesNotThrow(() => render(E(EvidenceList, { items: hostile("x") })));
    assert.doesNotThrow(() => render(E(EvidenceList, { items: hostile([{ id: {}, label: [], digest: 3, status: {} }]) })));
    assert.doesNotThrow(() => render(E(WorkflowChecks, { checks: hostile({}) })));
    assert.doesNotThrow(() => render(E(CallbackList, { records: hostile("x") })));
    assert.doesNotThrow(() => render(E(LinkedRecords, { values: hostile(7) })));
    const html = render(E(LinkedRecords, { values: hostile([{ id: 1 }, "ok", null]) }));
    assert.match(html, /ok/);
  });
});

describe("scalar and nested-object fields", () => {
  it("approvals detail renders nothing extra when the list is empty", () => {
    const html = render(E(ApprovalsView, { capabilities: hostile("x"), data: hostile({ approvals: [] }) }));
    assert.match(html, /approval/i);
  });

  it("approval preview renders when nested policy/command/evidence/auditAnchor are malformed", () => {
    const preview = {
      command: null,
      policy: { independentApprover: "yes", stepUpMfa: {}, blockers: "not-a-list" },
      evidence: 5,
      auditAnchor: { sequence: {}, hash: [] }
    };
    const html = render(E(ApprovalPreviewPanel, { preview: hostile(preview) }));
    assert.match(html, /—/);
  });

  it("audit summary and table render when chain fields and events are hostile", () => {
    const data = {
      chain: { verified: "yes", length: "many", headHash: {}, durable: "x", retentionDays: NaN },
      events: { not: "array" }
    };
    const html = render(E(AuditView, { data: hostile(data), mayExport: false }));
    assert.match(html, /audit/i);
    assert.doesNotMatch(html, /NaN/);

    const hostileEvents = {
      chain: { verified: true, length: 1, headHash: "abcdef0123456789abcdef", durable: false, retentionDays: 30 },
      events: [{ eventId: {}, sequence: "x", action: [], occurredAt: {}, actor: 1, resource: {}, tone: "constructor", outcome: [], evidenceDigest: {}, previousHash: 5, hash: null }]
    };
    const eventHtml = render(E(AuditView, { data: hostile(hostileEvents), mayExport: false }));
    assert.doesNotMatch(eventHtml, /\[object Object\]/);
    assert.doesNotMatch(eventHtml, /data-tone="constructor"/);
  });

  it("provider evidence panel renders when cases, verification, outage and callbacks are malformed", () => {
    const feed = {
      cases: [
        {
          id: "EV-1",
          domain: "kyc",
          label: "l",
          scenario: "s",
          providerStatus: "p",
          projectedStatus: "q",
          tone: "bogus-tone",
          sequence: {},
          verification: "x",
          reasonCodes: "y",
          requestedItems: 5,
          linkedCaseId: {},
          source: "sumsub",
          environment: "test",
          providerReference: {},
          applicantRef: "a",
          level: "basic",
          result: "r",
          deadline: {},
          timedOut: "yes",
          outage: "down",
          receivedCallbacks: "z",
          rejectedCallbacks: 1
        }
      ]
    };
    const html = render(E(ProviderEvidencePanel, { title: "t", feed: hostile(feed) }));
    assert.match(html, /EV-1/);
    assert.doesNotMatch(html, /data-tone="bogus-tone"/);
  });

  it("reports render when status/period/sections/tables are malformed", () => {
    const list = render(E(ReportsView, { data: hostile({ reports: "x", status: 5, environment: {}, period: null }) }));
    assert.match(list, /report/i);
  });

  it("subject timeline lookup renders with a capability-normalized session", () => {
    const session = { operator: { capabilities: ["checks:read"] } };
    const html = render(E(SubjectsView, { session: hostile(session), onOpen: () => {} }));
    assert.match(html, /subject/i);
  });
});

describe("enum and label fabrication", () => {
  it("check detail renders the raw foreign status instead of a fabricated message key", () => {
    const item = {
      id: "C-1",
      kind: "send",
      channel: "chat",
      tone: "danger",
      status: "garbage-status",
      sender: "a",
      senderCustomerId: "a1",
      recipient: "b",
      recipientCustomerId: "b1",
      amount: "10",
      asset: "TON",
      fee: "0",
      createdAt: "t",
      expiresAt: "t",
      auditEvidenceDigest: "d",
      monitoring: "x",
      timeline: 3,
      evidenceItems: {}
    };
    const html = render(E(CheckDetail, { item: hostile(item) }));
    assert.match(html, /garbage-status/);
    assert.doesNotMatch(html, /checks\.status\.garbage-status/);
  });

  it("ticket detail renders raw foreign channel/priority/status instead of fabricated keys", () => {
    const item = {
      id: "T-1",
      channel: "constructor",
      subject: "s",
      tone: "danger",
      status: "open",
      customer: "c",
      customerId: "c1",
      topic: "t",
      priority: "vip",
      createdAt: "t",
      updatedAt: "t",
      auditEvidenceDigest: "d",
      messages: [{ id: "m1", author: "toString", occurredAt: "t", body: "hi" }],
      internalNotes: "x"
    };
    const html = render(E(TicketDetail, { item: hostile(item) }));
    assert.match(html, /vip/);
    assert.doesNotMatch(html, /support\.priority\.vip|support\.channel\.|support\.author\.toString/);
  });

  it("withdrawal detail renders raw foreign role/decision instead of fabricated keys", () => {
    const item = {
      id: "W-1",
      intentId: "wi-1",
      tone: "warning",
      status: "draft",
      customer: "c",
      customerId: "c1",
      subject: "s",
      amount: "1",
      asset: "TON",
      destination: "EQ...",
      destinationReference: "r",
      network: "ton",
      policyVersion: "v1",
      runtimeBoundary: "b",
      idempotencyKey: "k",
      correlationId: "c",
      intentDigest: "d",
      policyDigest: "d",
      createdAt: "t",
      updatedAt: "t",
      expiresAt: "t",
      auditEvidenceDigest: "d",
      screening: "x",
      requiredApprovals: "two",
      approvalSteps: [{ id: "s1", role: "owner", decision: "maybe", decidedAt: {}, subjectReference: "r", stepUpGrantId: 0, evidenceDigest: "d" }],
      timeline: {},
      evidenceItems: "x"
    };
    const html = render(E(WithdrawalDetail, { item: hostile(item) }));
    assert.match(html, /owner/);
    assert.match(html, /maybe/);
    assert.doesNotMatch(html, /withdrawals\.role\.owner|withdrawals\.decision\.maybe/);
  });

  it("filter selects only offer whitelisted statuses", () => {
    const data = {
      checks: [],
      statuses: ["created", "constructor", "__proto__", "settled", 5, {}]
    };
    const html = render(E(ChecksView, { query: "", data: hostile(data) }));
    assert.match(html, /value="created"/);
    assert.doesNotMatch(html, /value="constructor"|value="__proto__"|value="settled"|value="5"/);

    const supportData = { tickets: [], statuses: ["open", "hasOwnProperty", "closed"] };
    const supportHtml = render(E(SupportView, { query: "", data: hostile(supportData) }));
    assert.match(supportHtml, /value="open"/);
    assert.doesNotMatch(supportHtml, /value="hasOwnProperty"|value="closed"/);

    const withdrawalData = { intents: [], statuses: ["draft", "toString", "executed"] };
    const withdrawalHtml = render(E(WithdrawalsView, { query: "", data: hostile(withdrawalData) }));
    assert.match(withdrawalHtml, /value="draft"/);
    assert.doesNotMatch(withdrawalHtml, /value="toString"|value="executed"/);
  });

  it("well-formed rows still localize: statuses, roles and decisions", () => {
    const check = render(E(ChecksView, { query: "", data: hostile({ checks: [], statuses: ["created", "claimed"] }) }));
    assert.match(check, /value="created"|value="claimed"/);

    const withdrawal = {
      id: "W-2",
      intentId: "wi-2",
      tone: "info",
      status: "pending-approval",
      customer: "c",
      customerId: "c1",
      subject: "s",
      amount: "1",
      asset: "TON",
      destination: "EQ...",
      destinationReference: "r",
      network: "ton",
      policyVersion: "v1",
      runtimeBoundary: "b",
      idempotencyKey: "k",
      correlationId: "c",
      intentDigest: "d",
      policyDigest: "d",
      createdAt: "t",
      updatedAt: "t",
      expiresAt: "t",
      auditEvidenceDigest: "d",
      screening: [],
      requiredApprovals: 2,
      approvalSteps: [{ id: "s1", role: "custody_maker", decision: "approved", decidedAt: "t", subjectReference: "r", stepUpGrantId: null, evidenceDigest: "d" }],
      timeline: [],
      evidenceItems: []
    };
    const html = render(E(WithdrawalDetail, { item: hostile(withdrawal) }));
    assert.doesNotMatch(html, /withdrawals\.role\.custody_maker|withdrawals\.decision\.approved/);
  });
});

describe("NaN and numeric abuse", () => {
  it("queue chart emits finite coordinates for hostile counts", () => {
    const data = {
      metrics: [{ label: "m", value: "1", detail: "d", tone: "info" }],
      queues: [
        { queue: "kyc", total: NaN, critical: Infinity, oldest: "t", sla: "x", tone: "danger" },
        { queue: "aml", total: "lots", critical: -3, oldest: "t", sla: "x", tone: "warning" },
        { queue: "wd", total: 5, critical: 1, oldest: "t", sla: "x", tone: "info" }
      ]
    };
    const html = render(E(DashboardView, { data: hostile(data) }));
    assert.doesNotMatch(html, /NaN|Infinity/);
  });

  it("count fields degrade instead of rendering NaN", () => {
    const preview = {
      command: { digest: "abcdef0123456789abcdef" },
      policy: { independentApprover: true, stepUpMfa: "verified", blockers: ["policy.evidence-incomplete"] },
      evidence: { ready: NaN, total: "many" },
      auditAnchor: { sequence: {}, hash: "deadbeefdeadbeef" }
    };
    const html = render(E(ApprovalPreviewPanel, { preview: hostile(preview) }));
    assert.doesNotMatch(html, /NaN/);
    assert.match(html, /—/);
  });
});

describe("fail-closed regressions", () => {
  it("empty approvals payload no longer crashes the detail pane", () => {
    const before = { approvals: [] };
    assert.doesNotThrow(() => render(E(ApprovalsView, { capabilities: hostile([]), data: hostile(before) })));
  });

  it("a malformed row degrades in place while sibling rows keep rendering", () => {
    const data = {
      customers: [
        { id: "C-1", name: "Ann", initials: "AN", country: "KG", segment: "retail", kyc: "Verified", tone: "success", risk: "low", riskScore: 10, volume: "0", nextAction: "ok", kycCaseId: "K1", kind: "person", openAmlCases: 0, restriction: "none", lastReviewedAt: "t", riskReason: "r" },
        { id: {}, name: [], initials: 1, country: null, segment: {}, kyc: {}, tone: "constructor", risk: [], riskScore: {}, volume: {}, nextAction: null, kycCaseId: {}, kind: {}, openAmlCases: {}, restriction: {}, lastReviewedAt: {}, riskReason: {} }
      ]
    };
    const html = render(E(CustomersView, { query: "", data: hostile(data) }));
    assert.match(html, /Ann/);
    assert.match(html, /—/);
    assert.doesNotMatch(html, /\[object Object\]|data-tone="constructor"/);
  });
});
