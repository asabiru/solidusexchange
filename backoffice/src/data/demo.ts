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
  exposure: string;
  evidence: string;
  age: string;
  state: string;
  tone: Tone;
}

export interface ReadonlyBackofficeRepository {
  metrics(): readonly Metric[];
  queues(): readonly QueueRow[];
  customers(): readonly CustomerRow[];
  approvals(): readonly ApprovalRow[];
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
    { id: "APV-843921", action: "Withdrawal review", maker: "Payments orchestration", exposure: "2 450 000 ₽", evidence: "84%", age: "18 мин", state: "High risk", tone: "danger" },
    { id: "APV-843918", action: "Ledger reversal", maker: "Finance operator", exposure: "184 200 ₽", evidence: "100%", age: "42 мин", state: "2 of 3", tone: "warning" },
    { id: "APV-843910", action: "Policy publish", maker: "Product operator", exposure: "11 206 users", evidence: "100%", age: "2 ч 14 мин", state: "Legal ready", tone: "info" },
    { id: "APV-843904", action: "PII export", maker: "Support L2", exposure: "1 customer", evidence: "100%", age: "3 ч 02 мин", state: "Second approver", tone: "neutral" }
  ]
} as const;

export const demoRepository: ReadonlyBackofficeRepository = {
  metrics: () => data.metrics,
  queues: () => data.queues,
  customers: () => data.customers,
  approvals: () => data.approvals
};
