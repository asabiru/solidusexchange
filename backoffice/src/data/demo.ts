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
  kind: "individual" | "business";
  country: string;
  segment: string;
  kyc: string;
  risk: string;
  riskScore: number;
  riskReason: string;
  volume: string;
  nextAction: string;
  restriction: string;
  kycCaseId: string;
  openAmlCases: number;
  lastReviewedAt: string;
  tone: Tone;
}

export interface WorkflowCheck {
  id: string;
  label: string;
  status: "clear" | "match" | "review" | "unavailable";
  detail: string;
  tone: Tone;
}

export interface KycCase {
  id: string;
  customerId: string;
  subject: string;
  type: "KYC" | "KYB";
  status: "verified" | "need-info" | "review";
  stage: string;
  jurisdiction: string;
  owner: string;
  openedAt: string;
  sla: string;
  riskScore: number;
  riskRating: string;
  tone: Tone;
  evidenceItems: readonly EvidenceItem[];
  checks: readonly WorkflowCheck[];
  uboSummary?: string;
  linkedApprovalId?: string;
  auditEvidenceDigest: string;
}

export interface AmlCase {
  id: string;
  customerId: string;
  subject: string;
  source: "KYT" | "Sanctions" | "PEP" | "Behavior";
  severity: string;
  state: "open" | "review" | "escalated";
  owner: string;
  openedAt: string;
  sla: string;
  exposure: string;
  tone: Tone;
  screenings: readonly WorkflowCheck[];
  riskFactors: readonly string[];
  evidenceItems: readonly EvidenceItem[];
  linkedApprovalId?: string;
  auditEvidenceDigest: string;
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
    stepUpMfa: "required" | "verified" | "not-required";
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
  kycCases(): readonly KycCase[];
  amlCases(): readonly AmlCase[];
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
    {
      id: "CUS-10482",
      name: "Алина Миронова",
      initials: "АМ",
      kind: "individual",
      country: "RU",
      segment: "Private",
      kyc: "Verified",
      risk: "High",
      riskScore: 82,
      riskReason: "KYT exposure and rapid withdrawal velocity",
      volume: "3 218 440 ₽",
      nextAction: "Withdrawal review",
      restriction: "Withdrawal hold",
      kycCaseId: "KYC-220184",
      openAmlCases: 1,
      lastReviewedAt: "2026-09-28T12:53:31.000Z",
      tone: "danger"
    },
    {
      id: "CUS-10477",
      name: "Никита Серов",
      initials: "НС",
      kind: "individual",
      country: "KG",
      segment: "Private",
      kyc: "Need info",
      risk: "Medium",
      riskScore: 61,
      riskReason: "PEP name similarity and missing source of funds",
      volume: "941 280 ₽",
      nextAction: "Source of funds",
      restriction: "Enhanced due diligence",
      kycCaseId: "KYC-220177",
      openAmlCases: 1,
      lastReviewedAt: "2026-09-28T11:34:18.000Z",
      tone: "warning"
    },
    {
      id: "CUS-10475",
      name: "Дмитрий Панов",
      initials: "ДП",
      kind: "individual",
      country: "RU",
      segment: "Private",
      kyc: "Verified",
      risk: "Low",
      riskScore: 18,
      riskReason: "No material risk indicators",
      volume: "426 010 ₽",
      nextAction: "—",
      restriction: "None",
      kycCaseId: "KYC-220171",
      openAmlCases: 0,
      lastReviewedAt: "2026-09-27T16:05:44.000Z",
      tone: "success"
    },
    {
      id: "CUS-10468",
      name: "София Романова",
      initials: "СР",
      kind: "individual",
      country: "KG",
      segment: "Private",
      kyc: "Verified",
      risk: "Medium",
      riskScore: 57,
      riskReason: "Sanctions false-positive requires disposition",
      volume: "2 114 800 ₽",
      nextAction: "Restriction review",
      restriction: "Enhanced monitoring",
      kycCaseId: "KYC-220168",
      openAmlCases: 1,
      lastReviewedAt: "2026-09-28T10:24:11.000Z",
      tone: "warning"
    },
    {
      id: "ORG-20018",
      name: "Aurora Trade LLC",
      initials: "AT",
      kind: "business",
      country: "KG",
      segment: "Business",
      kyc: "Review",
      risk: "High",
      riskScore: 76,
      riskReason: "UBO evidence gap and cross-border activity",
      volume: "8 904 500 ₽",
      nextAction: "UBO verification",
      restriction: "Onboarding hold",
      kycCaseId: "KYB-220165",
      openAmlCases: 0,
      lastReviewedAt: "2026-09-28T09:41:03.000Z",
      tone: "danger"
    }
  ],
  kycCases: [
    {
      id: "KYC-220184",
      customerId: "CUS-10482",
      subject: "Алина Миронова",
      type: "KYC",
      status: "verified",
      stage: "Periodic review",
      jurisdiction: "RU",
      owner: "Compliance queue",
      openedAt: "2026-09-28T08:12:04.000Z",
      sla: "3 ч 18 мин",
      riskScore: 82,
      riskRating: "High",
      tone: "danger",
      evidenceItems: [
        { id: "identity", label: "Identity package", status: "ready", digest: "sha256:42ab11993cf1" },
        { id: "address", label: "Address evidence", status: "ready", digest: "sha256:630ff46f8329" },
        { id: "risk", label: "Risk assessment", status: "ready", digest: "sha256:7a49c1ef12a8" }
      ],
      checks: [
        { id: "document", label: "Document authenticity", status: "clear", detail: "Synthetic verification passed", tone: "success" },
        { id: "liveness", label: "Liveness", status: "clear", detail: "Synthetic verification passed", tone: "success" },
        { id: "residency", label: "Residence consistency", status: "review", detail: "Cross-border activity noted", tone: "warning" }
      ],
      linkedApprovalId: "APV-843899",
      auditEvidenceDigest: "sha256:42ab11993cf1"
    },
    {
      id: "KYC-220177",
      customerId: "CUS-10477",
      subject: "Никита Серов",
      type: "KYC",
      status: "need-info",
      stage: "Enhanced due diligence",
      jurisdiction: "KG",
      owner: "Compliance queue",
      openedAt: "2026-09-28T07:35:21.000Z",
      sla: "1 ч 07 мин",
      riskScore: 61,
      riskRating: "Medium",
      tone: "warning",
      evidenceItems: [
        { id: "identity", label: "Identity package", status: "ready", digest: "sha256:598dd8b186ec" },
        { id: "address", label: "Address evidence", status: "ready", digest: "sha256:1398dd80e2be" },
        { id: "sof", label: "Source of funds", status: "missing", digest: "sha256:000000000000" }
      ],
      checks: [
        { id: "document", label: "Document authenticity", status: "clear", detail: "Synthetic verification passed", tone: "success" },
        { id: "liveness", label: "Liveness", status: "clear", detail: "Synthetic verification passed", tone: "success" },
        { id: "sof", label: "Source of funds", status: "unavailable", detail: "Evidence not supplied", tone: "danger" }
      ],
      auditEvidenceDigest: "sha256:598dd8b186ec"
    },
    {
      id: "KYB-220165",
      customerId: "ORG-20018",
      subject: "Aurora Trade LLC",
      type: "KYB",
      status: "review",
      stage: "UBO verification",
      jurisdiction: "KG",
      owner: "KYB queue",
      openedAt: "2026-09-28T06:44:57.000Z",
      sla: "At risk",
      riskScore: 76,
      riskRating: "High",
      tone: "danger",
      evidenceItems: [
        { id: "registry", label: "Company registry extract", status: "ready", digest: "sha256:930017ab7cc2" },
        { id: "structure", label: "Ownership structure", status: "ready", digest: "sha256:0485e6be29e1" },
        { id: "ubo", label: "UBO identity evidence", status: "missing", digest: "sha256:000000000000" }
      ],
      checks: [
        { id: "registry", label: "Registry status", status: "clear", detail: "Active synthetic entity", tone: "success" },
        { id: "ubo", label: "UBO completeness", status: "review", detail: "One controller lacks evidence", tone: "danger" },
        { id: "activity", label: "Business activity", status: "review", detail: "Cross-border profile requires EDD", tone: "warning" }
      ],
      uboSummary: "2 declared controllers · 1 evidence gap",
      linkedApprovalId: "APV-843896",
      auditEvidenceDigest: "sha256:930017ab7cc2"
    }
  ],
  amlCases: [
    {
      id: "AML-78041",
      customerId: "CUS-10482",
      subject: "Алина Миронова",
      source: "KYT",
      severity: "High",
      state: "escalated",
      owner: "AML investigations",
      openedAt: "2026-09-28T12:31:19.000Z",
      sla: "42 мин",
      exposure: "2 450 000 ₽",
      tone: "danger",
      screenings: [
        { id: "kyt", label: "KYT trace", status: "match", detail: "Indirect high-risk exposure", tone: "danger" },
        { id: "sanctions", label: "Sanctions", status: "clear", detail: "No synthetic match", tone: "success" },
        { id: "pep", label: "PEP", status: "clear", detail: "No synthetic match", tone: "success" }
      ],
      riskFactors: ["Rapid withdrawal velocity", "Indirect high-risk wallet exposure"],
      evidenceItems: [
        { id: "kyt", label: "KYT trace", status: "ready", digest: "sha256:96ff7d30da42" },
        { id: "timeline", label: "Transaction timeline", status: "ready", digest: "sha256:91b688091631" },
        { id: "sof", label: "Source of funds", status: "missing", digest: "sha256:000000000000" }
      ],
      linkedApprovalId: "APV-843921",
      auditEvidenceDigest: "sha256:96ff7d30da42"
    },
    {
      id: "AML-78038",
      customerId: "CUS-10477",
      subject: "Никита Серов",
      source: "PEP",
      severity: "Medium",
      state: "review",
      owner: "AML investigations",
      openedAt: "2026-09-28T10:22:41.000Z",
      sla: "2 ч 11 мин",
      exposure: "941 280 ₽",
      tone: "warning",
      screenings: [
        { id: "pep", label: "PEP", status: "review", detail: "Name similarity requires disposition", tone: "warning" },
        { id: "sanctions", label: "Sanctions", status: "clear", detail: "No synthetic match", tone: "success" },
        { id: "kyt", label: "KYT trace", status: "clear", detail: "No material exposure", tone: "success" }
      ],
      riskFactors: ["PEP name similarity", "Source of funds missing"],
      evidenceItems: [
        { id: "screening", label: "Screening result", status: "ready", digest: "sha256:2a6958ccfc47" },
        { id: "identity", label: "Identity package", status: "ready", digest: "sha256:598dd8b186ec" },
        { id: "sof", label: "Source of funds", status: "missing", digest: "sha256:000000000000" }
      ],
      auditEvidenceDigest: "sha256:2a6958ccfc47"
    },
    {
      id: "AML-78031",
      customerId: "CUS-10468",
      subject: "София Романова",
      source: "Sanctions",
      severity: "Medium",
      state: "open",
      owner: "AML investigations",
      openedAt: "2026-09-28T09:08:12.000Z",
      sla: "3 ч 36 мин",
      exposure: "2 114 800 ₽",
      tone: "warning",
      screenings: [
        { id: "sanctions", label: "Sanctions", status: "review", detail: "Potential false positive", tone: "warning" },
        { id: "pep", label: "PEP", status: "clear", detail: "No synthetic match", tone: "success" },
        { id: "kyt", label: "KYT trace", status: "clear", detail: "No material exposure", tone: "success" }
      ],
      riskFactors: ["Sanctions name similarity", "Cross-border transaction pattern"],
      evidenceItems: [
        { id: "screening", label: "Screening result", status: "ready", digest: "sha256:b4f8cc3dab50" },
        { id: "identity", label: "Identity package", status: "ready", digest: "sha256:0f918b998c0e" },
        { id: "disposition", label: "Analyst disposition", status: "missing", digest: "sha256:000000000000" }
      ],
      linkedApprovalId: "APV-843897",
      auditEvidenceDigest: "sha256:b4f8cc3dab50"
    }
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
    },
    {
      id: "APV-843899",
      action: "High-risk KYC retention",
      maker: "Compliance queue",
      makerSubject: "service:compliance-workflow",
      resource: "kyc-case:KYC-220184",
      exposure: "1 customer",
      evidence: "3 of 3",
      evidenceItems: [
        { id: "identity", label: "Identity package", status: "ready", digest: "sha256:42ab11993cf1" },
        { id: "risk", label: "Risk assessment", status: "ready", digest: "sha256:7a49c1ef12a8" },
        { id: "edd", label: "EDD rationale", status: "ready", digest: "sha256:6c0813f5e42e" }
      ],
      age: "54 мин",
      state: "Second approver",
      tone: "warning",
      requiredApprovals: 2,
      completedApprovals: 1,
      stepUpRequired: true
    },
    {
      id: "APV-843897",
      action: "AML false-positive disposition",
      maker: "AML investigations",
      makerSubject: "service:aml-workflow",
      resource: "aml-case:AML-78031",
      exposure: "2 114 800 ₽",
      evidence: "2 of 3",
      evidenceItems: [
        { id: "screening", label: "Screening result", status: "ready", digest: "sha256:b4f8cc3dab50" },
        { id: "identity", label: "Identity package", status: "ready", digest: "sha256:0f918b998c0e" },
        { id: "disposition", label: "Analyst disposition", status: "missing", digest: "sha256:000000000000" }
      ],
      age: "1 ч 14 мин",
      state: "Evidence gap",
      tone: "danger",
      requiredApprovals: 2,
      completedApprovals: 0,
      stepUpRequired: true
    },
    {
      id: "APV-843896",
      action: "KYB onboarding decision",
      maker: "KYB queue",
      makerSubject: "service:kyb-workflow",
      resource: "kyb-case:KYB-220165",
      exposure: "1 business",
      evidence: "2 of 3",
      evidenceItems: [
        { id: "registry", label: "Company registry extract", status: "ready", digest: "sha256:930017ab7cc2" },
        { id: "structure", label: "Ownership structure", status: "ready", digest: "sha256:0485e6be29e1" },
        { id: "ubo", label: "UBO identity evidence", status: "missing", digest: "sha256:000000000000" }
      ],
      age: "2 ч 06 мин",
      state: "Evidence gap",
      tone: "danger",
      requiredApprovals: 2,
      completedApprovals: 0,
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
    },
    {
      eventId: "AUD-000152",
      occurredAt: "2026-09-28T13:22:16.000Z",
      actor: "service:compliance-workflow",
      action: "kyc.risk_assessed",
      resource: "kyc-case:KYC-220184",
      outcome: "recorded",
      evidenceDigest: "sha256:7a49c1ef12a8"
    },
    {
      eventId: "AUD-000153",
      occurredAt: "2026-09-28T13:29:08.000Z",
      actor: "operator:aml-08",
      action: "aml.screening_reviewed",
      resource: "aml-case:AML-78031",
      outcome: "reviewed",
      evidenceDigest: "sha256:b4f8cc3dab50"
    }
  ]
} as const;

export const demoRepository: ReadonlyBackofficeRepository = {
  metrics: () => data.metrics,
  queues: () => data.queues,
  customers: () => data.customers,
  kycCases: () => data.kycCases,
  amlCases: () => data.amlCases,
  approvals: () => data.approvals,
  auditSource: () => data.auditSource
};
