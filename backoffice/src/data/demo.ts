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

export interface InvestigationTimelineEvent {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  outcome: string;
  evidenceDigest: string;
}

export interface InvestigationCase {
  id: string;
  customerId: string;
  subject: string;
  category: "account-takeover" | "transaction-pattern" | "identity-link";
  priority: "Critical" | "High" | "Medium";
  state: "triage" | "investigating" | "escalated";
  owner: string;
  openedAt: string;
  sla: string;
  exposure: string;
  summary: string;
  tone: Tone;
  relatedAlertIds: readonly string[];
  relatedCaseIds: readonly string[];
  hypotheses: readonly string[];
  timeline: readonly InvestigationTimelineEvent[];
  evidenceItems: readonly EvidenceItem[];
  linkedApprovalId?: string;
  auditEvidenceDigest: string;
}

export interface FraudAlert {
  id: string;
  customerId: string;
  subject: string;
  scenario: "Account takeover" | "Withdrawal velocity" | "Payment anomaly";
  channel: "Web" | "Telegram Mini App" | "API";
  score: number;
  severity: "Critical" | "High" | "Medium";
  state: "new" | "triage" | "investigating";
  detectedAt: string;
  sla: string;
  exposure: string;
  controlMode: "monitor-only";
  tone: Tone;
  signals: readonly WorkflowCheck[];
  evidenceItems: readonly EvidenceItem[];
  linkedInvestigationId?: string;
  linkedApprovalId?: string;
  auditEvidenceDigest: string;
}

export type CheckStatus = "created" | "waiting-recipient-kyc" | "claimed" | "cancelled" | "expired";

export interface CheckTimelineEvent {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  outcome: string;
  evidenceDigest: string;
}

export interface ChatCheck {
  id: string;
  kind: "personal";
  channel: "Telegram chat";
  status: CheckStatus;
  senderCustomerId: string;
  sender: string;
  recipient: string;
  recipientCustomerId?: string;
  amount: string;
  asset: string;
  fee: string;
  comment?: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  monitoring: readonly WorkflowCheck[];
  timeline: readonly CheckTimelineEvent[];
  evidenceItems: readonly EvidenceItem[];
  tone: Tone;
  auditEvidenceDigest: string;
}

export type SupportTicketStatus = "open" | "pending-customer" | "escalated" | "resolved";

export type SupportTicketChannel = "miniapp" | "telegram";

export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export interface SupportTicketMessage {
  id: string;
  occurredAt: string;
  author: "customer" | "operator" | "system";
  body: string;
}

export interface SupportTicketNote {
  id: string;
  occurredAt: string;
  author: string;
  body: string;
}

// Synthetic customer-support ticket, read-only. Tickets carry conversation
// history and linked entity references for operator context; replying,
// assigning or closing stays outside this console.
export interface SupportTicket {
  id: string;
  subject: string;
  customerId: string;
  customer: string;
  topic: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  channel: SupportTicketChannel;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  linkedCheckId?: string;
  linkedKycCaseId?: string;
  linkedScreeningId?: string;
  disputedAmount?: string;
  asset?: string;
  messages: readonly SupportTicketMessage[];
  internalNotes: readonly SupportTicketNote[];
  tone: Tone;
  auditEvidenceDigest: string;
}

export type WithdrawalIntentStatus =
  | "draft"
  | "pending-approval"
  | "screened"
  | "broadcast"
  | "confirmed"
  | "rejected"
  | "cancelled";

export type WithdrawalApprovalRole = "custody_maker" | "custody_checker";

export type WithdrawalApprovalDecision = "pending" | "approved" | "rejected";

export interface WithdrawalApprovalStep {
  id: string;
  role: WithdrawalApprovalRole;
  subjectReference: string;
  decision: WithdrawalApprovalDecision;
  decidedAt?: string;
  stepUpGrantId?: string;
  evidenceDigest?: string;
}

export interface WithdrawalTimelineEvent {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  outcome: string;
  evidenceDigest: string;
}

// Synthetic custody withdrawal intent, read-only. Rows mirror the
// packages/custody-core unsigned-intent vocabulary (command references,
// maker-checker approval roles, policy digests) so operators can inspect the
// lifecycle; approving, broadcasting or cancelling stays outside this console.
export interface WithdrawalIntent {
  id: string;
  intentId: string;
  withdrawalId: string;
  subject: string;
  customerId: string;
  customer: string;
  asset: string;
  amount: string;
  network: string;
  destination: string;
  destinationReference: string;
  status: WithdrawalIntentStatus;
  screening: readonly WorkflowCheck[];
  approvalSteps: readonly WithdrawalApprovalStep[];
  requiredApprovals: number;
  policyVersion: string;
  runtimeBoundary: "dev-dry-run";
  executionAuthority: false;
  productionSigningEnabled: false;
  keyMaterialPresent: false;
  intentDigest: string;
  policyDigest: string;
  approvalEvidenceDigest?: string;
  idempotencyKey: string;
  correlationId: string;
  linkedKytCaseId?: string;
  linkedApprovalId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  resolvedAt?: string;
  timeline: readonly WithdrawalTimelineEvent[];
  evidenceItems: readonly EvidenceItem[];
  tone: Tone;
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

export type SubjectTimelineKind =
  | "check"
  | "support"
  | "withdrawal"
  | "kyc"
  | "aml"
  | "investigation"
  | "fraud-alert"
  | "audit";

// One unified activity row for the cross-entity subject feed: the entity
// reference, its kind and a short neutral summary — never a command surface.
export interface SubjectTimelineEntry {
  at: string;
  kind: SubjectTimelineKind;
  ref: string;
  summary: string;
}

export interface SubjectTimeline {
  subject: string;
  entries: readonly SubjectTimelineEntry[];
}

export interface ReadonlyBackofficeRepository {
  metrics(): readonly Metric[];
  queues(): readonly QueueRow[];
  customers(): readonly CustomerRow[];
  chatChecks(): readonly ChatCheck[];
  supportTickets(): readonly SupportTicket[];
  withdrawalIntents(): readonly WithdrawalIntent[];
  kycCases(): readonly KycCase[];
  amlCases(): readonly AmlCase[];
  investigationCases(): readonly InvestigationCase[];
  fraudAlerts(): readonly FraudAlert[];
  approvals(): readonly ApprovalRow[];
  auditSource(): readonly AuditSourceEvent[];
  subjectTimeline(ref: string): SubjectTimeline | undefined;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// Resolves a synthetic subject or customer reference (`sim-*`, `cust_*`,
// `CUS-*`/`ORG-*`) to the customer ids it names, then aggregates every entity
// row bound to those ids into one frozen, reverse-chronological feed. Returns
// undefined when nothing matches, without revealing which collections were
// searched. Read-only: no writes, no money movement, no status changes.
function buildSubjectTimeline(ref: string): SubjectTimeline | undefined {
  const allChecks: readonly ChatCheck[] = data.chatChecks;
  const allTickets: readonly SupportTicket[] = data.supportTickets;
  const allIntents: readonly WithdrawalIntent[] = data.withdrawalIntents;
  const allKyc: readonly KycCase[] = data.kycCases;
  const allAml: readonly AmlCase[] = data.amlCases;
  const allInvestigations: readonly InvestigationCase[] = data.investigationCases;
  const allAlerts: readonly FraudAlert[] = data.fraudAlerts;
  const allAudit: readonly AuditSourceEvent[] = data.auditSource;

  const customerIds = new Set<string>([ref]);
  for (const row of [...allTickets, ...allIntents, ...allKyc, ...allAml, ...allInvestigations, ...allAlerts]) {
    if (row.subject === ref) customerIds.add(row.customerId);
  }
  const byCustomer = (row: { subject: string; customerId: string }): boolean =>
    row.subject === ref || customerIds.has(row.customerId);

  const checks = allChecks.filter(
    (check) =>
      customerIds.has(check.senderCustomerId)
      || (check.recipientCustomerId !== undefined && customerIds.has(check.recipientCustomerId))
  );
  const tickets = allTickets.filter(byCustomer);
  const intents = allIntents.filter(byCustomer);
  const kycCases = allKyc.filter(byCustomer);
  const amlCases = allAml.filter(byCustomer);
  const investigations = allInvestigations.filter(byCustomer);
  const alerts = allAlerts.filter(byCustomer);

  const touched = new Set<string>([ref, ...customerIds]);
  for (const id of [
    ...checks.map((row) => row.id),
    ...tickets.map((row) => row.id),
    ...intents.map((row) => row.id),
    ...kycCases.map((row) => row.id),
    ...amlCases.map((row) => row.id),
    ...investigations.map((row) => row.id),
    ...alerts.map((row) => row.id)
  ]) {
    touched.add(id);
  }
  const audit = allAudit.filter((event) =>
    touched.has(event.resource.split(":").pop() ?? "")
    || touched.has(event.actor.split(":").pop() ?? "")
  );

  const entries: SubjectTimelineEntry[] = [
    ...checks.map((check) => ({
      at: check.resolvedAt ?? check.createdAt,
      kind: "check" as const,
      ref: check.id,
      summary: `${check.status} · ${check.amount} ${check.asset} · ${check.sender} → ${check.recipient}`
    })),
    ...tickets.map((ticket) => ({
      at: ticket.updatedAt,
      kind: "support" as const,
      ref: ticket.id,
      summary: `${ticket.status} · ${ticket.topic}`
    })),
    ...intents.map((intent) => ({
      at: intent.updatedAt,
      kind: "withdrawal" as const,
      ref: intent.id,
      summary: `${intent.status} · ${intent.amount} ${intent.asset} · ${intent.network}`
    })),
    ...kycCases.map((item) => ({
      at: item.openedAt,
      kind: "kyc" as const,
      ref: item.id,
      summary: `${item.type} ${item.status} · ${item.stage}`
    })),
    ...amlCases.map((item) => ({
      at: item.openedAt,
      kind: "aml" as const,
      ref: item.id,
      summary: `${item.source} ${item.severity} · ${item.state}`
    })),
    ...investigations.map((item) => ({
      at: item.openedAt,
      kind: "investigation" as const,
      ref: item.id,
      summary: `${item.category} ${item.priority} · ${item.state}`
    })),
    ...alerts.map((alert) => ({
      at: alert.detectedAt,
      kind: "fraud-alert" as const,
      ref: alert.id,
      summary: `${alert.scenario} ${alert.severity} · ${alert.state}`
    })),
    ...audit.map((event) => ({
      at: event.occurredAt,
      kind: "audit" as const,
      ref: event.eventId,
      summary: `${event.action} · ${event.outcome}`
    }))
  ];
  if (!entries.length) return undefined;
  entries.sort((a, b) =>
    b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref)
  );
  return deepFreeze({ subject: ref, entries });
}

const data = deepFreeze({
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
  chatChecks: [
    {
      id: "CHK-771312",
      kind: "personal",
      channel: "Telegram chat",
      status: "created",
      senderCustomerId: "CUS-10482",
      sender: "Алина Миронова",
      recipient: "@berlin_life",
      amount: "25.000000",
      asset: "USDT",
      fee: "0.050000",
      comment: "Долг за ужин",
      createdAt: "2026-09-28T13:41:22.000Z",
      expiresAt: "2026-10-01T13:41:22.000Z",
      monitoring: [
        { id: "velocity", label: "Check velocity", status: "clear", detail: "2 checks in 24h, under threshold", tone: "success" },
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Sender screened at creation", tone: "success" }
      ],
      timeline: [
        { id: "T1", occurredAt: "2026-09-28T13:41:22.000Z", actor: "customer:CUS-10482", action: "check.created", outcome: "recorded", evidenceDigest: "sha256:5f31aa0e7214" }
      ],
      evidenceItems: [
        { id: "creation", label: "Creation record", status: "ready", digest: "sha256:5f31aa0e7214" },
        { id: "hold", label: "Funds hold receipt", status: "ready", digest: "sha256:18b92cd4a05e" }
      ],
      tone: "info",
      auditEvidenceDigest: "sha256:5f31aa0e7214"
    },
    {
      id: "CHK-771298",
      kind: "personal",
      channel: "Telegram chat",
      status: "waiting-recipient-kyc",
      senderCustomerId: "CUS-10477",
      sender: "Никита Серов",
      recipient: "София Романова",
      recipientCustomerId: "CUS-10468",
      amount: "120.000000",
      asset: "USDT",
      fee: "0.240000",
      createdAt: "2026-09-28T11:58:07.000Z",
      expiresAt: "2026-10-01T11:58:07.000Z",
      monitoring: [
        { id: "kyc", label: "Recipient KYC", status: "review", detail: "Recipient level insufficient — claim held", tone: "warning" },
        { id: "velocity", label: "Check velocity", status: "clear", detail: "Within sender baseline", tone: "success" },
        { id: "structuring", label: "Structuring screen", status: "clear", detail: "No split-payment pattern", tone: "success" }
      ],
      timeline: [
        { id: "T1", occurredAt: "2026-09-28T11:58:07.000Z", actor: "customer:CUS-10477", action: "check.created", outcome: "recorded", evidenceDigest: "sha256:7cc42e91b301" },
        { id: "T2", occurredAt: "2026-09-28T12:36:49.000Z", actor: "service:check-engine", action: "check.claim_held", outcome: "recorded", evidenceDigest: "sha256:e5149c08af62" }
      ],
      evidenceItems: [
        { id: "creation", label: "Creation record", status: "ready", digest: "sha256:7cc42e91b301" },
        { id: "kyc-hold", label: "KYC hold notice", status: "ready", digest: "sha256:e5149c08af62" }
      ],
      tone: "warning",
      auditEvidenceDigest: "sha256:e5149c08af62"
    },
    {
      id: "CHK-771277",
      kind: "personal",
      channel: "Telegram chat",
      status: "claimed",
      senderCustomerId: "CUS-10468",
      sender: "София Романова",
      recipient: "Алина Миронова",
      recipientCustomerId: "CUS-10482",
      amount: "8.750000000",
      asset: "TON",
      fee: "0.015000000",
      comment: "За билеты",
      createdAt: "2026-09-27T19:12:44.000Z",
      expiresAt: "2026-09-30T19:12:44.000Z",
      resolvedAt: "2026-09-28T08:05:31.000Z",
      monitoring: [
        { id: "velocity", label: "Check velocity", status: "clear", detail: "Within sender baseline", tone: "success" },
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Both parties screened", tone: "success" },
        { id: "circular", label: "Circular sending", status: "clear", detail: "No return-path correlation", tone: "success" }
      ],
      timeline: [
        { id: "T1", occurredAt: "2026-09-27T19:12:44.000Z", actor: "customer:CUS-10468", action: "check.created", outcome: "recorded", evidenceDigest: "sha256:2d47a9fe8166" },
        { id: "T2", occurredAt: "2026-09-28T08:05:31.000Z", actor: "customer:CUS-10482", action: "check.claimed", outcome: "recorded", evidenceDigest: "sha256:96be0c374ad0" }
      ],
      evidenceItems: [
        { id: "creation", label: "Creation record", status: "ready", digest: "sha256:2d47a9fe8166" },
        { id: "claim", label: "Claim receipt", status: "ready", digest: "sha256:96be0c374ad0" }
      ],
      tone: "success",
      auditEvidenceDigest: "sha256:96be0c374ad0"
    },
    {
      id: "CHK-771260",
      kind: "personal",
      channel: "Telegram chat",
      status: "cancelled",
      senderCustomerId: "CUS-10482",
      sender: "Алина Миронова",
      recipient: "@tourmate_anna",
      amount: "430.000000",
      asset: "USDT",
      fee: "0.860000",
      comment: "Аренда студии",
      createdAt: "2026-09-28T09:26:18.000Z",
      expiresAt: "2026-10-01T09:26:18.000Z",
      resolvedAt: "2026-09-28T10:02:55.000Z",
      monitoring: [
        { id: "velocity", label: "Check velocity", status: "review", detail: "3 creates in 24h, near threshold", tone: "warning" },
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Sender screened at creation", tone: "success" }
      ],
      timeline: [
        { id: "T1", occurredAt: "2026-09-28T09:26:18.000Z", actor: "customer:CUS-10482", action: "check.created", outcome: "recorded", evidenceDigest: "sha256:3ab7f0e59c44" },
        { id: "T2", occurredAt: "2026-09-28T10:02:55.000Z", actor: "customer:CUS-10482", action: "check.cancelled", outcome: "recorded", evidenceDigest: "sha256:71e3d5bc8a10" }
      ],
      evidenceItems: [
        { id: "creation", label: "Creation record", status: "ready", digest: "sha256:3ab7f0e59c44" },
        { id: "release", label: "Hold release receipt", status: "ready", digest: "sha256:71e3d5bc8a10" }
      ],
      tone: "neutral",
      auditEvidenceDigest: "sha256:71e3d5bc8a10"
    },
    {
      id: "CHK-771204",
      kind: "personal",
      channel: "Telegram chat",
      status: "expired",
      senderCustomerId: "CUS-10477",
      sender: "Никита Серов",
      recipient: "@kite_school",
      amount: "65.500000",
      asset: "USDT",
      fee: "0.131000",
      createdAt: "2026-09-25T14:33:51.000Z",
      expiresAt: "2026-09-28T14:33:51.000Z",
      resolvedAt: "2026-09-28T14:33:51.000Z",
      monitoring: [
        { id: "velocity", label: "Check velocity", status: "clear", detail: "Within sender baseline", tone: "success" },
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Sender screened at creation", tone: "success" }
      ],
      timeline: [
        { id: "T1", occurredAt: "2026-09-25T14:33:51.000Z", actor: "customer:CUS-10477", action: "check.created", outcome: "recorded", evidenceDigest: "sha256:0e6ba3d17f98" },
        { id: "T2", occurredAt: "2026-09-27T20:14:02.000Z", actor: "customer:@kite_school", action: "check.claim_denied", outcome: "denied", evidenceDigest: "sha256:b4d8720fe551" },
        { id: "T3", occurredAt: "2026-09-28T14:33:51.000Z", actor: "service:check-engine", action: "check.expired", outcome: "recorded", evidenceDigest: "sha256:d9aa51b60734" }
      ],
      evidenceItems: [
        { id: "creation", label: "Creation record", status: "ready", digest: "sha256:0e6ba3d17f98" },
        { id: "expiry", label: "Expiry and return receipt", status: "ready", digest: "sha256:d9aa51b60734" }
      ],
      tone: "warning",
      auditEvidenceDigest: "sha256:d9aa51b60734"
    }
  ],
  supportTickets: [
    {
      id: "SUP-384120",
      subject: "sim-alina-mironova",
      customerId: "CUS-10482",
      customer: "Алина Миронова",
      topic: "Получатель не может принять чек",
      priority: "high",
      status: "escalated",
      channel: "telegram",
      createdAt: "2026-09-28T12:41:09.000Z",
      updatedAt: "2026-09-28T13:35:47.000Z",
      linkedCheckId: "CHK-771298",
      linkedKycCaseId: "KYC-220177",
      disputedAmount: "120.000000",
      asset: "USDT",
      messages: [
        { id: "M1", occurredAt: "2026-09-28T12:41:09.000Z", author: "customer", body: "Отправила чек подруге — у неё ошибка «получатель не прошёл проверку». Деньги вернутся?" },
        { id: "M2", occurredAt: "2026-09-28T12:52:36.000Z", author: "operator", body: "Чек в статусе ожидания: получателю нужно завершить идентификацию. Средства удержаны и не списаны окончательно." },
        { id: "M3", occurredAt: "2026-09-28T13:35:47.000Z", author: "system", body: "Эскалация в очередь комплаенс: связанный кейс KYC-220177 ждёт документы о происхождении средств." }
      ],
      internalNotes: [
        { id: "N1", occurredAt: "2026-09-28T13:36:12.000Z", author: "operator:support-l1-12", body: "Связано с чеком CHK-771298 и кейсом KYC-220177. Сумма в споре — строковое значение, движения нет." }
      ],
      tone: "warning",
      auditEvidenceDigest: "sha256:9c41de72ab55"
    },
    {
      id: "SUP-384087",
      subject: "sim-nikita-serov",
      customerId: "CUS-10477",
      customer: "Никита Серов",
      topic: "Запрос статуса усиленной проверки",
      priority: "normal",
      status: "pending-customer",
      channel: "miniapp",
      createdAt: "2026-09-28T08:14:52.000Z",
      updatedAt: "2026-09-28T11:02:18.000Z",
      linkedKycCaseId: "KYC-220177",
      messages: [
        { id: "M1", occurredAt: "2026-09-28T08:14:52.000Z", author: "customer", body: "Приложение просит документы о доходах. Сколько ещё ждать решения?" },
        { id: "M2", occurredAt: "2026-09-28T09:03:40.000Z", author: "operator", body: "Проверка идёт по кейсу KYC-220177: нужен документ о происхождении средств. Ориентир — 1 рабочий день после загрузки." },
        { id: "M3", occurredAt: "2026-09-28T11:02:18.000Z", author: "system", body: "Ожидается ответ клиента: напоминание отправлено в Mini App." }
      ],
      internalNotes: [
        { id: "N1", occurredAt: "2026-09-28T09:05:02.000Z", author: "operator:support-l1-07", body: "Клиенту объяснили EDD-статус; доступ ограничений не снимался." }
      ],
      tone: "info",
      auditEvidenceDigest: "sha256:4fb21ac90e38"
    },
    {
      id: "SUP-384055",
      subject: "sim-sofia-romanova",
      customerId: "CUS-10468",
      customer: "София Романова",
      topic: "Вопрос о санкционном совпадении",
      priority: "urgent",
      status: "open",
      channel: "telegram",
      createdAt: "2026-09-28T13:48:21.000Z",
      updatedAt: "2026-09-28T13:48:21.000Z",
      linkedScreeningId: "AML-78031",
      messages: [
        { id: "M1", occurredAt: "2026-09-28T13:48:21.000Z", author: "customer", body: "В банке сказали, что перевод задержали из-за «совпадения в списках». Это ошибка?" }
      ],
      internalNotes: [
        { id: "N1", occurredAt: "2026-09-28T13:49:03.000Z", author: "service:intake-router", body: "Автосвязка: открытый кейс скрининга AML-78031, диспозиция аналитика ещё не вынесена." }
      ],
      tone: "danger",
      auditEvidenceDigest: "sha256:6d2e78f14a09"
    },
    {
      id: "SUP-383991",
      subject: "sim-dmitry-panov",
      customerId: "CUS-10475",
      customer: "Дмитрий Панов",
      topic: "Не пришёл код подтверждения в Mini App",
      priority: "normal",
      status: "resolved",
      channel: "miniapp",
      createdAt: "2026-09-27T16:44:30.000Z",
      updatedAt: "2026-09-28T09:17:55.000Z",
      resolvedAt: "2026-09-28T09:17:55.000Z",
      messages: [
        { id: "M1", occurredAt: "2026-09-27T16:44:30.000Z", author: "customer", body: "Не приходит код подтверждения уже час. Приложение переустанавливал." },
        { id: "M2", occurredAt: "2026-09-27T17:02:11.000Z", author: "operator", body: "Проверили доставку: коды уходят, но оператор фильтрует короткие номера. Попробуйте авторизацию через Telegram." },
        { id: "M3", occurredAt: "2026-09-28T09:17:55.000Z", author: "customer", body: "Зашёл через Telegram — всё работает, спасибо." },
        { id: "M4", occurredAt: "2026-09-28T09:17:55.000Z", author: "system", body: "Обращение закрыто клиентом: подтверждён вход через альтернативный канал." }
      ],
      internalNotes: [
        { id: "N1", occurredAt: "2026-09-27T17:05:48.000Z", author: "operator:support-l1-03", body: "Операторская фильтрация коротких кодов — известная синтетическая проблема канала." }
      ],
      tone: "success",
      auditEvidenceDigest: "sha256:1e8a45c9b276"
    },
    {
      id: "SUP-383964",
      subject: "sim-aurora-trade",
      customerId: "ORG-20018",
      customer: "Aurora Trade LLC",
      topic: "Документы бенефициара для KYB",
      priority: "high",
      status: "pending-customer",
      channel: "telegram",
      createdAt: "2026-09-28T07:29:14.000Z",
      updatedAt: "2026-09-28T10:55:31.000Z",
      linkedKycCaseId: "KYB-220165",
      messages: [
        { id: "M1", occurredAt: "2026-09-28T07:29:14.000Z", author: "customer", body: "Нужен список документов по бенефициарным владельцам — регистрация остановилась." },
        { id: "M2", occurredAt: "2026-09-28T08:12:47.000Z", author: "operator", body: "По кейсу KYB-220165 нужны выписка из реестра и подтверждение структуры владения. Загрузите в досье компании." },
        { id: "M3", occurredAt: "2026-09-28T10:55:31.000Z", author: "system", body: "Ожидается ответ клиента: чек-лист документов отправлен." }
      ],
      internalNotes: [
        { id: "N1", occurredAt: "2026-09-28T08:15:20.000Z", author: "operator:support-l1-09", body: "Онбординг на паузе до завершения проверки UBO; решения оператор не принимает." }
      ],
      tone: "warning",
      auditEvidenceDigest: "sha256:83f0d6a51b92"
    }
  ],
  withdrawalIntents: [
    {
      id: "WDR-991804",
      intentId: "custody_intent_991804",
      withdrawalId: "withdrawal_991804",
      subject: "sim-alina-mironova",
      customerId: "CUS-10482",
      customer: "Алина Миронова",
      asset: "USDT",
      amount: "2450.000000",
      network: "TON_TESTNET",
      destination: "EQDkR9u5xT2mB8wP4nS7vH3fL6jK1cA0dG4yN9iQ5oE7rU2tVz",
      destinationReference: "destination_ref_alina_ton_main",
      status: "pending-approval",
      screening: [
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Customer and destination screened at creation", tone: "success" },
        { id: "kyt", label: "KYT destination trace", status: "review", detail: "Indirect high-risk wallet exposure — case AML-78041", tone: "warning" },
        { id: "velocity", label: "Withdrawal velocity", status: "review", detail: "3 withdrawal intents in 24h, above baseline", tone: "warning" }
      ],
      approvalSteps: [
        { id: "approval_991804_maker", role: "custody_maker", subjectReference: "operator_ref_maria_koval", decision: "approved", decidedAt: "2026-09-28T12:58:11.000Z", stepUpGrantId: "step_up_grant_991804_mk", evidenceDigest: "sha256:96ff7d30da42" },
        { id: "approval_991804_checker", role: "custody_checker", subjectReference: "operator_ref_pending", decision: "pending" }
      ],
      requiredApprovals: 2,
      policyVersion: "custody-dev-v1",
      runtimeBoundary: "dev-dry-run",
      executionAuthority: false,
      productionSigningEnabled: false,
      keyMaterialPresent: false,
      intentDigest: "sha256:a17e95c2b340",
      policyDigest: "sha256:4b2d91f0c7e8",
      approvalEvidenceDigest: "sha256:63c1ae27f09b",
      idempotencyKey: "custody_idempotency_991804",
      correlationId: "7a2f1c9e-4b35-4d68-9a71-2c8e5f01b3d4",
      linkedKytCaseId: "AML-78041",
      linkedApprovalId: "APV-843921",
      createdAt: "2026-09-28T12:44:37.000Z",
      updatedAt: "2026-09-28T12:58:11.000Z",
      expiresAt: "2026-09-28T12:49:37.000Z",
      timeline: [
        { id: "T1", occurredAt: "2026-09-28T12:44:37.000Z", actor: "service:custody-orchestrator", action: "withdrawal.intent_drafted", outcome: "recorded", evidenceDigest: "sha256:f07fd061c671" },
        { id: "T2", occurredAt: "2026-09-28T12:53:31.000Z", actor: "operator_ref_maria_koval", action: "approval.decision_recorded", outcome: "reviewed", evidenceDigest: "sha256:96ff7d30da42" },
        { id: "T3", occurredAt: "2026-09-28T12:58:11.000Z", actor: "service:custody-orchestrator", action: "withdrawal.pending_approval", outcome: "recorded", evidenceDigest: "sha256:63c1ae27f09b" }
      ],
      evidenceItems: [
        { id: "command", label: "Intent command record", status: "ready", digest: "sha256:f07fd061c671" },
        { id: "kyt", label: "KYT trace", status: "ready", digest: "sha256:96ff7d30da42" },
        { id: "sof", label: "Source of funds", status: "missing", digest: "sha256:000000000000" }
      ],
      tone: "danger",
      auditEvidenceDigest: "sha256:f07fd061c671"
    },
    {
      id: "WDR-991817",
      intentId: "custody_intent_991817",
      withdrawalId: "withdrawal_991817",
      subject: "sim-nikita-serov",
      customerId: "CUS-10477",
      customer: "Никита Серов",
      asset: "TON",
      amount: "85.250000000",
      network: "TON_TESTNET",
      destination: "UQCmH4wP8rT5nB2kS9vF6jL3dG1xY0eA7iQ4oU8cM5zE2rN6tH",
      destinationReference: "destination_ref_nikita_ton",
      status: "screened",
      screening: [
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Customer and destination screened", tone: "success" },
        { id: "kyt", label: "KYT destination trace", status: "clear", detail: "No high-risk exposure on testnet path", tone: "success" },
        { id: "edd", label: "Enhanced due diligence", status: "review", detail: "Customer EDD open on KYC-220177", tone: "warning" }
      ],
      approvalSteps: [
        { id: "approval_991817_maker", role: "custody_maker", subjectReference: "operator_ref_pending", decision: "pending" },
        { id: "approval_991817_checker", role: "custody_checker", subjectReference: "operator_ref_pending", decision: "pending" }
      ],
      requiredApprovals: 2,
      policyVersion: "custody-dev-v1",
      runtimeBoundary: "dev-dry-run",
      executionAuthority: false,
      productionSigningEnabled: false,
      keyMaterialPresent: false,
      intentDigest: "sha256:7d04c8be1a63",
      policyDigest: "sha256:4b2d91f0c7e8",
      idempotencyKey: "custody_idempotency_991817",
      correlationId: "3b8d4e21-7c46-4f59-b2a8-9d1e6f03c7b5",
      linkedKytCaseId: "AML-78038",
      createdAt: "2026-09-28T13:12:05.000Z",
      updatedAt: "2026-09-28T13:22:48.000Z",
      expiresAt: "2026-09-28T13:17:05.000Z",
      timeline: [
        { id: "T1", occurredAt: "2026-09-28T13:12:05.000Z", actor: "service:custody-orchestrator", action: "withdrawal.intent_drafted", outcome: "recorded", evidenceDigest: "sha256:5ce29d81b4f6" },
        { id: "T2", occurredAt: "2026-09-28T13:22:48.000Z", actor: "service:kyt-simulator", action: "withdrawal.screened", outcome: "recorded", evidenceDigest: "sha256:7d04c8be1a63" }
      ],
      evidenceItems: [
        { id: "command", label: "Intent command record", status: "ready", digest: "sha256:5ce29d81b4f6" },
        { id: "kyt", label: "KYT trace", status: "ready", digest: "sha256:7d04c8be1a63" },
        { id: "quorum", label: "Maker-checker quorum", status: "missing", digest: "sha256:000000000000" }
      ],
      tone: "warning",
      auditEvidenceDigest: "sha256:7d04c8be1a63"
    },
    {
      id: "WDR-991822",
      intentId: "custody_intent_991822",
      withdrawalId: "withdrawal_991822",
      subject: "sim-dmitry-panov",
      customerId: "CUS-10475",
      customer: "Дмитрий Панов",
      asset: "USDT",
      amount: "310.500000",
      network: "TRON_TESTNET",
      destination: "0x7F3aE9d41cB28e51b6C4F0a2D9e8B5f1A3c7D2E4",
      destinationReference: "destination_ref_dmitry_tron",
      status: "broadcast",
      screening: [
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Customer and destination screened", tone: "success" },
        { id: "kyt", label: "KYT destination trace", status: "clear", detail: "Clean testnet destination", tone: "success" },
        { id: "velocity", label: "Withdrawal velocity", status: "clear", detail: "Within customer baseline", tone: "success" }
      ],
      approvalSteps: [
        { id: "approval_991822_maker", role: "custody_maker", subjectReference: "operator_ref_maria_koval", decision: "approved", decidedAt: "2026-09-28T11:41:16.000Z", stepUpGrantId: "step_up_grant_991822_mk", evidenceDigest: "sha256:2b7f9c40d1e5" },
        { id: "approval_991822_checker", role: "custody_checker", subjectReference: "operator_ref_elena_sokolova", decision: "approved", decidedAt: "2026-09-28T11:44:52.000Z", stepUpGrantId: "step_up_grant_991822_es", evidenceDigest: "sha256:8a13e6d5b904" }
      ],
      requiredApprovals: 2,
      policyVersion: "custody-dev-v1",
      runtimeBoundary: "dev-dry-run",
      executionAuthority: false,
      productionSigningEnabled: false,
      keyMaterialPresent: false,
      intentDigest: "sha256:19f2e7a4c8b1",
      policyDigest: "sha256:4b2d91f0c7e8",
      approvalEvidenceDigest: "sha256:c48d05f1a7e2",
      idempotencyKey: "custody_idempotency_991822",
      correlationId: "9e5c2a71-3d84-4b16-8f47-1a6c0e52d9b8",
      createdAt: "2026-09-28T11:38:44.000Z",
      updatedAt: "2026-09-28T11:52:09.000Z",
      expiresAt: "2026-09-28T11:43:44.000Z",
      timeline: [
        { id: "T1", occurredAt: "2026-09-28T11:38:44.000Z", actor: "service:custody-orchestrator", action: "withdrawal.intent_drafted", outcome: "recorded", evidenceDigest: "sha256:0f53a7c1e8d9" },
        { id: "T2", occurredAt: "2026-09-28T11:41:16.000Z", actor: "operator_ref_maria_koval", action: "approval.decision_recorded", outcome: "reviewed", evidenceDigest: "sha256:2b7f9c40d1e5" },
        { id: "T3", occurredAt: "2026-09-28T11:44:52.000Z", actor: "operator_ref_elena_sokolova", action: "approval.decision_recorded", outcome: "reviewed", evidenceDigest: "sha256:8a13e6d5b904" },
        { id: "T4", occurredAt: "2026-09-28T11:52:09.000Z", actor: "service:custody-orchestrator", action: "withdrawal.broadcast", outcome: "recorded", evidenceDigest: "sha256:c48d05f1a7e2" }
      ],
      evidenceItems: [
        { id: "command", label: "Intent command record", status: "ready", digest: "sha256:0f53a7c1e8d9" },
        { id: "quorum", label: "Maker-checker quorum", status: "ready", digest: "sha256:c48d05f1a7e2" },
        { id: "broadcast", label: "Broadcast receipt", status: "ready", digest: "sha256:c48d05f1a7e2" }
      ],
      tone: "info",
      auditEvidenceDigest: "sha256:c48d05f1a7e2"
    },
    {
      id: "WDR-991805",
      intentId: "custody_intent_991805",
      withdrawalId: "withdrawal_991805",
      subject: "sim-sofia-romanova",
      customerId: "CUS-10468",
      customer: "София Романова",
      asset: "TON",
      amount: "42.000000000",
      network: "TON_TESTNET",
      destination: "EQBjK7nM3wR9vP5sT2yF8hL4dA6cE0iG1uX5oQ7zN9eB3tV8",
      destinationReference: "destination_ref_sofia_ton",
      status: "confirmed",
      screening: [
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Customer and destination screened", tone: "success" },
        { id: "kyt", label: "KYT destination trace", status: "clear", detail: "Clean testnet destination", tone: "success" },
        { id: "velocity", label: "Withdrawal velocity", status: "clear", detail: "Within customer baseline", tone: "success" }
      ],
      approvalSteps: [
        { id: "approval_991805_maker", role: "custody_maker", subjectReference: "operator_ref_maria_koval", decision: "approved", decidedAt: "2026-09-27T15:02:31.000Z", stepUpGrantId: "step_up_grant_991805_mk", evidenceDigest: "sha256:31e8b7c5f2a0" },
        { id: "approval_991805_checker", role: "custody_checker", subjectReference: "operator_ref_anton_bely", decision: "approved", decidedAt: "2026-09-27T15:05:47.000Z", stepUpGrantId: "step_up_grant_991805_ab", evidenceDigest: "sha256:66d4a1e08c39" }
      ],
      requiredApprovals: 2,
      policyVersion: "custody-dev-v1",
      runtimeBoundary: "dev-dry-run",
      executionAuthority: false,
      productionSigningEnabled: false,
      keyMaterialPresent: false,
      intentDigest: "sha256:85c3f7e1a9d4",
      policyDigest: "sha256:4b2d91f0c7e8",
      approvalEvidenceDigest: "sha256:b2e17c95a308",
      idempotencyKey: "custody_idempotency_991805",
      correlationId: "1c7e4b90-5f23-4a58-9d36-8e0b2c47a5f1",
      createdAt: "2026-09-27T14:58:12.000Z",
      updatedAt: "2026-09-27T15:21:36.000Z",
      expiresAt: "2026-09-27T15:03:12.000Z",
      resolvedAt: "2026-09-27T15:21:36.000Z",
      timeline: [
        { id: "T1", occurredAt: "2026-09-27T14:58:12.000Z", actor: "service:custody-orchestrator", action: "withdrawal.intent_drafted", outcome: "recorded", evidenceDigest: "sha256:4f68d2a91e05" },
        { id: "T2", occurredAt: "2026-09-27T15:02:31.000Z", actor: "operator_ref_maria_koval", action: "approval.decision_recorded", outcome: "reviewed", evidenceDigest: "sha256:31e8b7c5f2a0" },
        { id: "T3", occurredAt: "2026-09-27T15:05:47.000Z", actor: "operator_ref_anton_bely", action: "approval.decision_recorded", outcome: "reviewed", evidenceDigest: "sha256:66d4a1e08c39" },
        { id: "T4", occurredAt: "2026-09-27T15:14:20.000Z", actor: "service:custody-orchestrator", action: "withdrawal.broadcast", outcome: "recorded", evidenceDigest: "sha256:9c01d7e6f4a2" },
        { id: "T5", occurredAt: "2026-09-27T15:21:36.000Z", actor: "service:custody-orchestrator", action: "withdrawal.confirmed", outcome: "recorded", evidenceDigest: "sha256:b2e17c95a308" }
      ],
      evidenceItems: [
        { id: "command", label: "Intent command record", status: "ready", digest: "sha256:4f68d2a91e05" },
        { id: "quorum", label: "Maker-checker quorum", status: "ready", digest: "sha256:b2e17c95a308" },
        { id: "confirmation", label: "Confirmation receipt", status: "ready", digest: "sha256:b2e17c95a308" }
      ],
      tone: "success",
      auditEvidenceDigest: "sha256:b2e17c95a308"
    },
    {
      id: "WDR-991799",
      intentId: "custody_intent_991799",
      withdrawalId: "withdrawal_991799",
      subject: "sim-aurora-trade",
      customerId: "ORG-20018",
      customer: "Aurora Trade LLC",
      asset: "USDT",
      amount: "12000.000000",
      network: "TRON_TESTNET",
      destination: "0xB4e2F8aC15d7093E6cA1bD48e7F20C5d9A3E61fB",
      destinationReference: "destination_ref_aurora_tron",
      status: "draft",
      screening: [
        { id: "sanctions", label: "Sanctions screening", status: "review", detail: "Entity screening scheduled at submission", tone: "warning" },
        { id: "kyb", label: "KYB status", status: "review", detail: "UBO review open on KYB-220165", tone: "warning" }
      ],
      approvalSteps: [
        { id: "approval_991799_maker", role: "custody_maker", subjectReference: "operator_ref_pending", decision: "pending" },
        { id: "approval_991799_checker", role: "custody_checker", subjectReference: "operator_ref_pending", decision: "pending" }
      ],
      requiredApprovals: 2,
      policyVersion: "custody-dev-v1",
      runtimeBoundary: "dev-dry-run",
      executionAuthority: false,
      productionSigningEnabled: false,
      keyMaterialPresent: false,
      intentDigest: "sha256:d51f8a2c7e94",
      policyDigest: "sha256:4b2d91f0c7e8",
      idempotencyKey: "custody_idempotency_991799",
      correlationId: "6f0a3d85-2c91-4e47-a5b8-7d9f1e04c6a3",
      createdAt: "2026-09-28T13:40:22.000Z",
      updatedAt: "2026-09-28T13:40:22.000Z",
      expiresAt: "2026-09-28T13:45:22.000Z",
      timeline: [
        { id: "T1", occurredAt: "2026-09-28T13:40:22.000Z", actor: "service:custody-orchestrator", action: "withdrawal.intent_drafted", outcome: "recorded", evidenceDigest: "sha256:d51f8a2c7e94" }
      ],
      evidenceItems: [
        { id: "command", label: "Intent command record", status: "ready", digest: "sha256:d51f8a2c7e94" },
        { id: "quorum", label: "Maker-checker quorum", status: "missing", digest: "sha256:000000000000" }
      ],
      tone: "neutral",
      auditEvidenceDigest: "sha256:d51f8a2c7e94"
    },
    {
      id: "WDR-991788",
      intentId: "custody_intent_991788",
      withdrawalId: "withdrawal_991788",
      subject: "sim-nikita-serov",
      customerId: "CUS-10477",
      customer: "Никита Серов",
      asset: "USDT",
      amount: "500.000000",
      network: "TON_TESTNET",
      destination: "UQAzP3xR8kT1nB5wS7vF2jL9dG4yH0eA6iQ8oU4cM2zE5rN9tL",
      destinationReference: "destination_ref_nikita_ton_alt",
      status: "rejected",
      screening: [
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Customer and destination screened", tone: "success" },
        { id: "kyt", label: "KYT destination trace", status: "match", detail: "Destination matches case AML-78038 cluster", tone: "danger" }
      ],
      approvalSteps: [
        { id: "approval_991788_maker", role: "custody_maker", subjectReference: "operator_ref_maria_koval", decision: "approved", decidedAt: "2026-09-27T09:14:08.000Z", stepUpGrantId: "step_up_grant_991788_mk", evidenceDigest: "sha256:12f7c4a9d6b0" },
        { id: "approval_991788_checker", role: "custody_checker", subjectReference: "operator_ref_roman_yudin", decision: "rejected", decidedAt: "2026-09-27T09:26:41.000Z", stepUpGrantId: "step_up_grant_991788_ry", evidenceDigest: "sha256:5d92e0b7f3c1" }
      ],
      requiredApprovals: 2,
      policyVersion: "custody-dev-v1",
      runtimeBoundary: "dev-dry-run",
      executionAuthority: false,
      productionSigningEnabled: false,
      keyMaterialPresent: false,
      intentDigest: "sha256:71b9e5c3d0f6",
      policyDigest: "sha256:4b2d91f0c7e8",
      approvalEvidenceDigest: "sha256:5d92e0b7f3c1",
      idempotencyKey: "custody_idempotency_991788",
      correlationId: "4d9b2e67-8a15-4c03-b7f2-5e6a9c10d3f8",
      linkedKytCaseId: "AML-78038",
      createdAt: "2026-09-27T09:08:55.000Z",
      updatedAt: "2026-09-27T09:26:41.000Z",
      expiresAt: "2026-09-27T09:13:55.000Z",
      resolvedAt: "2026-09-27T09:26:41.000Z",
      timeline: [
        { id: "T1", occurredAt: "2026-09-27T09:08:55.000Z", actor: "service:custody-orchestrator", action: "withdrawal.intent_drafted", outcome: "recorded", evidenceDigest: "sha256:71b9e5c3d0f6" },
        { id: "T2", occurredAt: "2026-09-27T09:14:08.000Z", actor: "operator_ref_maria_koval", action: "approval.decision_recorded", outcome: "reviewed", evidenceDigest: "sha256:12f7c4a9d6b0" },
        { id: "T3", occurredAt: "2026-09-27T09:26:41.000Z", actor: "operator_ref_roman_yudin", action: "withdrawal.rejected", outcome: "denied", evidenceDigest: "sha256:5d92e0b7f3c1" }
      ],
      evidenceItems: [
        { id: "command", label: "Intent command record", status: "ready", digest: "sha256:71b9e5c3d0f6" },
        { id: "kyt", label: "KYT trace", status: "ready", digest: "sha256:5d92e0b7f3c1" },
        { id: "rejection", label: "Rejection record", status: "ready", digest: "sha256:5d92e0b7f3c1" }
      ],
      tone: "danger",
      auditEvidenceDigest: "sha256:5d92e0b7f3c1"
    },
    {
      id: "WDR-991760",
      intentId: "custody_intent_991760",
      withdrawalId: "withdrawal_991760",
      subject: "sim-alina-mironova",
      customerId: "CUS-10482",
      customer: "Алина Миронова",
      asset: "TON",
      amount: "15.000000000",
      network: "TON_TESTNET",
      destination: "UQDwK5nB2mR7vT9sP4yF6hL1dA8cE3iG0uX2oQ9zN5eB7tV4",
      destinationReference: "destination_ref_alina_ton_test",
      status: "cancelled",
      screening: [
        { id: "sanctions", label: "Sanctions screening", status: "clear", detail: "Screened at creation", tone: "success" }
      ],
      approvalSteps: [
        { id: "approval_991760_maker", role: "custody_maker", subjectReference: "operator_ref_pending", decision: "pending" },
        { id: "approval_991760_checker", role: "custody_checker", subjectReference: "operator_ref_pending", decision: "pending" }
      ],
      requiredApprovals: 2,
      policyVersion: "custody-dev-v1",
      runtimeBoundary: "dev-dry-run",
      executionAuthority: false,
      productionSigningEnabled: false,
      keyMaterialPresent: false,
      intentDigest: "sha256:08e4f6a2b9d7",
      policyDigest: "sha256:4b2d91f0c7e8",
      idempotencyKey: "custody_idempotency_991760",
      correlationId: "8b5e1f42-6d79-4a20-9c84-3f7d0e52b9a6",
      createdAt: "2026-09-26T17:33:40.000Z",
      updatedAt: "2026-09-26T17:41:12.000Z",
      expiresAt: "2026-09-26T17:38:40.000Z",
      resolvedAt: "2026-09-26T17:41:12.000Z",
      timeline: [
        { id: "T1", occurredAt: "2026-09-26T17:33:40.000Z", actor: "service:custody-orchestrator", action: "withdrawal.intent_drafted", outcome: "recorded", evidenceDigest: "sha256:08e4f6a2b9d7" },
        { id: "T2", occurredAt: "2026-09-26T17:41:12.000Z", actor: "customer:CUS-10482", action: "withdrawal.cancelled", outcome: "recorded", evidenceDigest: "sha256:3f91c8d5e0a2" }
      ],
      evidenceItems: [
        { id: "command", label: "Intent command record", status: "ready", digest: "sha256:08e4f6a2b9d7" },
        { id: "cancellation", label: "Cancellation record", status: "ready", digest: "sha256:3f91c8d5e0a2" }
      ],
      tone: "neutral",
      auditEvidenceDigest: "sha256:3f91c8d5e0a2"
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
  investigationCases: [
    {
      id: "INV-43018",
      customerId: "CUS-10482",
      subject: "Алина Миронова",
      category: "transaction-pattern",
      priority: "Critical",
      state: "escalated",
      owner: "Fraud investigations",
      openedAt: "2026-09-28T12:36:42.000Z",
      sla: "27 мин",
      exposure: "2 450 000 ₽",
      summary: "Rapid withdrawal sequence follows a new-device login and indirect high-risk wallet exposure.",
      tone: "danger",
      relatedAlertIds: ["FRD-61084", "FRD-61079"],
      relatedCaseIds: ["AML-78041"],
      hypotheses: [
        "Account credentials may be compromised",
        "Withdrawal beneficiary differs from established behavior"
      ],
      timeline: [
        {
          id: "timeline-1",
          occurredAt: "2026-09-28T12:31:19.000Z",
          actor: "service:fraud-monitor",
          action: "fraud.alert_created",
          outcome: "FRD-61084",
          evidenceDigest: "sha256:ac7f8c9321d4"
        },
        {
          id: "timeline-2",
          occurredAt: "2026-09-28T12:36:42.000Z",
          actor: "operator:fraud-04",
          action: "investigation.opened",
          outcome: "Escalated for cross-control review",
          evidenceDigest: "sha256:4ac921a0e61f"
        }
      ],
      evidenceItems: [
        { id: "device", label: "Device change summary", status: "ready", digest: "sha256:ac7f8c9321d4" },
        { id: "velocity", label: "Withdrawal velocity", status: "ready", digest: "sha256:930ac32dd029" },
        { id: "contact", label: "Customer contact outcome", status: "missing", digest: "sha256:000000000000" }
      ],
      linkedApprovalId: "APV-843921",
      auditEvidenceDigest: "sha256:4ac921a0e61f"
    },
    {
      id: "INV-43014",
      customerId: "CUS-10477",
      subject: "Никита Серов",
      category: "identity-link",
      priority: "High",
      state: "investigating",
      owner: "AML investigations",
      openedAt: "2026-09-28T10:31:09.000Z",
      sla: "1 ч 22 мин",
      exposure: "941 280 ₽",
      summary: "Synthetic identity-link signal overlaps with unresolved PEP similarity and source-of-funds gap.",
      tone: "warning",
      relatedAlertIds: ["FRD-61072"],
      relatedCaseIds: ["AML-78038", "KYC-220177"],
      hypotheses: [
        "Shared device may belong to the same household",
        "Identity similarity requires independent evidence"
      ],
      timeline: [
        {
          id: "timeline-3",
          occurredAt: "2026-09-28T10:22:41.000Z",
          actor: "service:risk-correlation",
          action: "identity.link_detected",
          outcome: "Review required",
          evidenceDigest: "sha256:3d42ce71a60b"
        }
      ],
      evidenceItems: [
        { id: "identity", label: "Identity correlation summary", status: "ready", digest: "sha256:3d42ce71a60b" },
        { id: "device", label: "Shared device projection", status: "ready", digest: "sha256:4c720f1e1a94" },
        { id: "sof", label: "Source of funds", status: "missing", digest: "sha256:000000000000" }
      ],
      auditEvidenceDigest: "sha256:3d42ce71a60b"
    },
    {
      id: "INV-43009",
      customerId: "CUS-10468",
      subject: "София Романова",
      category: "account-takeover",
      priority: "Medium",
      state: "triage",
      owner: "Fraud queue",
      openedAt: "2026-09-28T09:16:54.000Z",
      sla: "3 ч 08 мин",
      exposure: "420 000 ₽",
      summary: "New browser fingerprint followed by a beneficiary change; no protected action was executed.",
      tone: "info",
      relatedAlertIds: ["FRD-61068"],
      relatedCaseIds: ["AML-78031"],
      hypotheses: ["Legitimate travel or browser reset", "Possible session takeover"],
      timeline: [
        {
          id: "timeline-4",
          occurredAt: "2026-09-28T09:16:54.000Z",
          actor: "service:fraud-monitor",
          action: "investigation.queued",
          outcome: "Triage pending",
          evidenceDigest: "sha256:e30371d8ce5f"
        }
      ],
      evidenceItems: [
        { id: "fingerprint", label: "Browser fingerprint summary", status: "ready", digest: "sha256:e30371d8ce5f" },
        { id: "beneficiary", label: "Beneficiary change", status: "ready", digest: "sha256:25fd21018514" }
      ],
      auditEvidenceDigest: "sha256:e30371d8ce5f"
    }
  ],
  fraudAlerts: [
    {
      id: "FRD-61084",
      customerId: "CUS-10482",
      subject: "Алина Миронова",
      scenario: "Account takeover",
      channel: "Web",
      score: 96,
      severity: "Critical",
      state: "investigating",
      detectedAt: "2026-09-28T12:31:19.000Z",
      sla: "12 мин",
      exposure: "2 450 000 ₽",
      controlMode: "monitor-only",
      tone: "danger",
      signals: [
        { id: "device", label: "New device", status: "match", detail: "First-seen browser fingerprint", tone: "danger" },
        { id: "velocity", label: "Withdrawal velocity", status: "match", detail: "Three attempts within 11 minutes", tone: "danger" },
        { id: "contact", label: "Customer confirmation", status: "unavailable", detail: "No contact outcome attached", tone: "warning" }
      ],
      evidenceItems: [
        { id: "device", label: "Device change summary", status: "ready", digest: "sha256:ac7f8c9321d4" },
        { id: "velocity", label: "Withdrawal velocity", status: "ready", digest: "sha256:930ac32dd029" },
        { id: "contact", label: "Customer contact outcome", status: "missing", digest: "sha256:000000000000" }
      ],
      linkedInvestigationId: "INV-43018",
      linkedApprovalId: "APV-843921",
      auditEvidenceDigest: "sha256:ac7f8c9321d4"
    },
    {
      id: "FRD-61079",
      customerId: "CUS-10482",
      subject: "Алина Миронова",
      scenario: "Withdrawal velocity",
      channel: "Telegram Mini App",
      score: 88,
      severity: "High",
      state: "investigating",
      detectedAt: "2026-09-28T12:28:08.000Z",
      sla: "31 мин",
      exposure: "2 450 000 ₽",
      controlMode: "monitor-only",
      tone: "danger",
      signals: [
        { id: "velocity", label: "Withdrawal velocity", status: "match", detail: "Behavior threshold exceeded", tone: "danger" },
        { id: "session", label: "Session integrity", status: "review", detail: "Channel changed during sequence", tone: "warning" }
      ],
      evidenceItems: [
        { id: "timeline", label: "Withdrawal timeline", status: "ready", digest: "sha256:91b688091631" },
        { id: "session", label: "Session projection", status: "ready", digest: "sha256:38c20913fe6a" }
      ],
      linkedInvestigationId: "INV-43018",
      auditEvidenceDigest: "sha256:91b688091631"
    },
    {
      id: "FRD-61072",
      customerId: "CUS-10477",
      subject: "Никита Серов",
      scenario: "Payment anomaly",
      channel: "Web",
      score: 79,
      severity: "High",
      state: "investigating",
      detectedAt: "2026-09-28T10:22:41.000Z",
      sla: "1 ч 05 мин",
      exposure: "941 280 ₽",
      controlMode: "monitor-only",
      tone: "warning",
      signals: [
        { id: "identity", label: "Identity link", status: "match", detail: "Synthetic correlation threshold exceeded", tone: "danger" },
        { id: "device", label: "Shared device", status: "review", detail: "Household relationship not established", tone: "warning" },
        { id: "amount", label: "Amount deviation", status: "clear", detail: "Within customer baseline", tone: "success" }
      ],
      evidenceItems: [
        { id: "identity", label: "Identity correlation summary", status: "ready", digest: "sha256:3d42ce71a60b" },
        { id: "device", label: "Shared device projection", status: "ready", digest: "sha256:4c720f1e1a94" }
      ],
      linkedInvestigationId: "INV-43014",
      auditEvidenceDigest: "sha256:3d42ce71a60b"
    },
    {
      id: "FRD-61068",
      customerId: "CUS-10468",
      subject: "София Романова",
      scenario: "Payment anomaly",
      channel: "API",
      score: 67,
      severity: "Medium",
      state: "triage",
      detectedAt: "2026-09-28T09:13:37.000Z",
      sla: "2 ч 44 мин",
      exposure: "420 000 ₽",
      controlMode: "monitor-only",
      tone: "warning",
      signals: [
        { id: "beneficiary", label: "New beneficiary", status: "review", detail: "First-seen destination", tone: "warning" },
        { id: "amount", label: "Amount deviation", status: "review", detail: "2.4× customer baseline", tone: "warning" },
        { id: "device", label: "Device risk", status: "clear", detail: "Known API credential", tone: "success" }
      ],
      evidenceItems: [
        { id: "beneficiary", label: "Beneficiary change", status: "ready", digest: "sha256:25fd21018514" },
        { id: "baseline", label: "Behavior baseline", status: "ready", digest: "sha256:2ca33065b5aa" }
      ],
      linkedInvestigationId: "INV-43009",
      auditEvidenceDigest: "sha256:25fd21018514"
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
    },
    {
      eventId: "AUD-000154",
      occurredAt: "2026-09-28T13:34:42.000Z",
      actor: "operator:fraud-04",
      action: "investigation.escalated",
      resource: "investigation:INV-43018",
      outcome: "reviewed",
      evidenceDigest: "sha256:4ac921a0e61f"
    },
    {
      eventId: "AUD-000155",
      occurredAt: "2026-09-28T13:37:10.000Z",
      actor: "service:fraud-monitor",
      action: "fraud.alert_correlated",
      resource: "fraud-alert:FRD-61084",
      outcome: "recorded",
      evidenceDigest: "sha256:ac7f8c9321d4"
    }
  ]
} as const);

export const demoRepository: ReadonlyBackofficeRepository = {
  metrics: () => data.metrics,
  queues: () => data.queues,
  customers: () => data.customers,
  chatChecks: () => data.chatChecks,
  supportTickets: () => data.supportTickets,
  withdrawalIntents: () => data.withdrawalIntents,
  kycCases: () => data.kycCases,
  amlCases: () => data.amlCases,
  investigationCases: () => data.investigationCases,
  fraudAlerts: () => data.fraudAlerts,
  approvals: () => data.approvals,
  auditSource: () => data.auditSource,
  subjectTimeline: buildSubjectTimeline
};
