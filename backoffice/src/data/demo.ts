export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface Metric {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface QueueRow {
  queue: string;
  critical: number;
  total: number;
  oldest: string;
  sla: string;
  tone: Tone;
}

export interface CustomerRow {
  id: string;
  name: string;
  initials: string;
  country: string;
  kyc: string;
  risk: string;
  volume: string;
  nextAction: string;
  tone: Tone;
}

export interface ApprovalRow {
  id: string;
  action: string;
  maker: string;
  makerSubject: string;
  resource: string;
  exposure: string;
  evidence: string;
  evidenceItems: readonly EvidenceItem[];
  age: string;
  state: string;
  tone: Tone;
  requiredApprovals: number;
  completedApprovals: number;
  stepUpRequired: boolean;
}

export interface ApprovalSummary extends ApprovalRow {
  commandDigest: string;
}

export interface EvidenceItem {
  id: string;
  label: string;
  status: "ready" | "missing" | "expired";
  digest: string;
}

export interface AuditSourceEvent {
  eventId: string;
  occurredAt: string;
  actor: string;
  action: string;
  resource: string;
  outcome: "recorded" | "denied" | "reviewed";
  evidenceDigest: string;
}

export interface AuditEvent extends AuditSourceEvent {
  sequence: number;
  previousHash: string;
  hash: string;
  tone: Tone;
}

export interface ApprovalPreview {
  approvalId: string;
  generatedAt: string;
  command: {
    action: string;
    resource: string;
    exposure: string;
    digest: string;
  };
  evidence: {
    ready: number;
    total: number;
    digest: string;
    items: readonly EvidenceItem[];
  };
  policy: {
    makerSubject: string;
    reviewerSubject: string;
    independentApprover: boolean;
    requiredApprovals: number;
    completedApprovals: number;
    stepUpMfa: "required" | "not-required";
    commandClient: "absent";
    executable: false;
    blockers: readonly string[];
  };
  auditAnchor: {
    sequence: number;
    hash: string;
  };
}

export interface ReadonlyBackofficeRepository {
  metrics(): readonly Metric[];
  queues(): readonly QueueRow[];
  customers(): readonly CustomerRow[];
  approvals(): readonly ApprovalRow[];
  auditSource(): readonly AuditSourceEvent[];
}

const data = {
  metrics: [
    { label: "Открытые кейсы", value: "29", detail: "−6 с начала смены", tone: "info" },
    { label: "SLA под риском", value: "5", detail: "2 требуют решения в течение часа", tone: "warning" },
    { label: "Выводы на hold", value: "₽ 8.4M", detail: "4 операции · без автоподтверждения", tone: "danger" },
    { label: "Reconciliation", value: "99.98%", detail: "2 расхождения из 11 642 записей", tone: "success" }
  ],
  queues: [
    { queue: "High-risk withdrawals", critical: 2, total: 4, oldest: "42 мин", sla: "At risk", tone: "danger" },
    { queue: "AML alerts", critical: 1, total: 7, oldest: "1 ч 18 мин", sla: "Watch", tone: "warning" },
    { queue: "KYC review", critical: 0, total: 18, oldest: "2 ч 04 мин", sla: "On track", tone: "success" },
    { queue: "Ledger mismatch", critical: 1, total: 2, oldest: "26 мин", sla: "Watch", tone: "warning" }
  ],
  customers: [
    { id: "CUS-10482", name: "Алина Миронова", initials: "АМ", country: "RU", kyc: "Verified", risk: "High", volume: "3 218 440 ₽", nextAction: "Withdrawal review", tone: "danger" },
    { id: "CUS-10477", name: "Никита Серов", initials: "НС", country: "KG", kyc: "Need info", risk: "Medium", volume: "941 280 ₽", nextAction: "Source of funds", tone: "warning" },
    { id: "CUS-10475", name: "Дмитрий Панов", initials: "ДП", country: "RU", kyc: "Verified", risk: "Low", volume: "426 010 ₽", nextAction: "—", tone: "success" },
    { id: "CUS-10468", name: "София Романова", initials: "СР", country: "KG", kyc: "Verified", risk: "Medium", volume: "2 114 800 ₽", nextAction: "Restriction review", tone: "warning" }
  ],
  approvals: [
    {
      id: "APV-843921",
      action: "Withdrawal review",
      maker: "Payments orchestration",
      makerSubject: "service:payments-orchestration",
      resource: "withdrawal:WDL-991804",
      exposure: "2 450 000 ₽",
      evidence: "2 of 3",
      evidenceItems: [
        { id: "risk", label: "Risk decision", status: "ready", digest: "sha256:7a49c1ef12a8" },
        { id: "kyt", label: "KYT trace", status: "ready", digest: "sha256:96ff7d30da42" },
        { id: "sof", label: "Source of funds", status: "missing", digest: "sha256:000000000000" }
      ],
      age: "18 мин",
      state: "Evidence gap",
      tone: "danger",
      requiredApprovals: 2,
      completedApprovals: 0,
      stepUpRequired: true
    },
    {
      id: "APV-843918",
      action: "Ledger reversal",
      maker: "Мария Коваль",
      makerSubject: "dev:compliance-lead",
      resource: "ledger-entry:LED-221840",
      exposure: "184 200 ₽",
      evidence: "3 of 3",
      evidenceItems: [
        { id: "entry", label: "Original entry", status: "ready", digest: "sha256:20c7706f5e71" },
        { id: "recon", label: "Reconciliation mismatch", status: "ready", digest: "sha256:cb9e612cd507" },
        { id: "reason", label: "Reversal reason", status: "ready", digest: "sha256:0d7ab97844af" }
      ],
      age: "42 мин",
      state: "Maker conflict",
      tone: "warning",
      requiredApprovals: 3,
      completedApprovals: 2,
      stepUpRequired: true
    },
    {
      id: "APV-843910",
      action: "Policy publish",
      maker: "Product operator",
      makerSubject: "operator:product-17",
      resource: "policy:POL-2026-09",
      exposure: "11 206 users",
      evidence: "3 of 3",
      evidenceItems: [
        { id: "diff", label: "Policy diff", status: "ready", digest: "sha256:f95ad63e03d5" },
        { id: "legal", label: "Legal opinion", status: "ready", digest: "sha256:ebf1ddca59bd" },
        { id: "rollout", label: "Rollout plan", status: "ready", digest: "sha256:7498d6091a33" }
      ],
      age: "2 ч 14 мин",
      state: "Ready for preview",
      tone: "info",
      requiredApprovals: 2,
      completedApprovals: 1,
      stepUpRequired: true
    },
    {
      id: "APV-843904",
      action: "PII export",
      maker: "Support L2",
      makerSubject: "operator:support-l2-04",
      resource: "customer:CUS-10477",
      exposure: "1 customer",
      evidence: "2 of 2",
      evidenceItems: [
        { id: "ticket", label: "Support ticket", status: "ready", digest: "sha256:0380bca27e5f" },
        { id: "privacy", label: "Privacy basis", status: "ready", digest: "sha256:6962ac71d40c" }
      ],
      age: "3 ч 02 мин",
      state: "Second approver",
      tone: "neutral",
      requiredApprovals: 2,
      completedApprovals: 1,
      stepUpRequired: true
    }
  ],
  auditSource: [
    {
      eventId: "AUD-000148",
      occurredAt: "2026-09-28T12:46:10.000Z",
      actor: "service:payments-orchestration",
      action: "approval.requested",
      resource: "withdrawal:WDL-991804",
      outcome: "recorded",
      evidenceDigest: "sha256:f07fd061c671"
    },
    {
      eventId: "AUD-000149",
      occurredAt: "2026-09-28T12:53:31.000Z",
      actor: "operator:aml-08",
      action: "evidence.reviewed",
      resource: "withdrawal:WDL-991804",
      outcome: "reviewed",
      evidenceDigest: "sha256:96ff7d30da42"
    },
    {
      eventId: "AUD-000150",
      occurredAt: "2026-09-28T13:01:02.000Z",
      actor: "operator:support-l1-12",
      action: "approval.preview",
      resource: "customer:CUS-10477",
      outcome: "denied",
      evidenceDigest: "sha256:6962ac71d40c"
    },
    {
      eventId: "AUD-000151",
      occurredAt: "2026-09-28T13:14:44.000Z",
      actor: "operator:finance-03",
      action: "approval.evidence_attached",
      resource: "ledger-entry:LED-221840",
      outcome: "recorded",
      evidenceDigest: "sha256:0d7ab97844af"
    }
  ]
} as const;

export const demoRepository: ReadonlyBackofficeRepository = {
  metrics: () => data.metrics,
  queues: () => data.queues,
  customers: () => data.customers,
  approvals: () => data.approvals,
  auditSource: () => data.auditSource
};
