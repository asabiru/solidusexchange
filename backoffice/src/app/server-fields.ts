import type { Capability, OperatorRole } from "../auth/access.js";
import type {
  OperatorAccountStatus,
  OperatorActivityKind,
  OperatorAmlAlertType,
  OperatorKycStatus,
  OperatorQueuePriority,
  OperatorQueueState,
  OperatorSubjectKycLevel,
  OperatorSubjectKycReason,
  OperatorSubjectKycStatus,
  OperatorTicketCategory,
  OperatorTicketQueueState
} from "../data/operator.js";
import type {
  CheckStatus,
  CustodyIncidentStatus,
  SubjectTimelineKind,
  SupportTicketChannel,
  SupportTicketPriority,
  SupportTicketStatus,
  Tone,
  WithdrawalApprovalDecision,
  WithdrawalApprovalRole,
  WithdrawalIntentStatus
} from "../data/demo.js";
import type { MessageKey } from "./i18n.js";
import type { ScreenId } from "./navigation.js";

/**
 * Signed-envelope payloads are verified for authenticity, not for shape: every
 * field an operator screen reads is untrusted input. These guards whitelist
 * enum members via own-property lookup, coerce scalars before render, and
 * degrade non-array collections to empty lists so one malformed row cannot
 * take down the workspace (the wave-40 miniapp pattern, mirrored for the
 * backoffice client).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reads a nested object field; a missing or non-object field resolves to {}. */
export function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

/** Server list fields are untrusted: a non-array payload degrades to an empty list. */
export function arrayOf<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

/** List rows must be objects: primitives/null are dropped so `row.field` never dereferences a non-object. */
export function rowsOf<T>(value: unknown): readonly T[] {
  return arrayOf<unknown>(value).filter(isRecord) as readonly T[];
}

function member<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function enumOf<T extends string>(record: Readonly<Record<T, unknown>>, value: unknown): T | undefined {
  return typeof value === "string" && member(record, value) !== undefined ? (value as T) : undefined;
}

/** Renderable text for an untrusted scalar: strings pass through, finite numbers stringify, everything else degrades. */
export function textOf(value: unknown, fallback = "—"): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

/** Truncated digest-style text: only an over-long value earns the ellipsis, a missing one renders "—". */
export function truncatedOf(value: unknown, max: number): string {
  const text = textOf(value, "");
  return text.length > max ? `${text.slice(0, max)}…` : text || "—";
}

/** Finite numbers only; NaN/Infinity/non-numbers degrade to undefined so callers pick a fallback. */
export function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Safe integers only; fractional, non-finite and non-number payload values degrade to undefined. */
export function intOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** Chart geometry must stay finite: hostile counts (NaN, negatives, strings) clamp to zero. */
export function countToward(value: unknown): number {
  const parsed = numberOf(value);
  return parsed === undefined ? 0 : Math.max(0, parsed);
}

const tones: Readonly<Record<Tone, true>> = {
  neutral: true,
  info: true,
  success: true,
  warning: true,
  danger: true
};

/** A foreign tone (including prototype members like "constructor") never reaches data-tone. */
export function toneOf(value: unknown): Tone {
  return typeof value === "string" && member(tones, value) !== undefined ? (value as Tone) : "neutral";
}

/** Session capability lists are payload data too: a non-array operator field grants nothing. */
export function capabilitiesOf(operator: unknown): readonly Capability[] {
  return arrayOf<Capability>(recordOf(operator).capabilities);
}

const checkStatuses: Readonly<Record<CheckStatus, MessageKey>> = {
  created: "checks.status.created",
  awaiting_recipient_kyc: "checks.status.awaiting_recipient_kyc",
  claimed: "checks.status.claimed",
  cancelled: "checks.status.cancelled",
  expired: "checks.status.expired"
};

export function checkStatusOf(value: unknown): CheckStatus | undefined {
  return enumOf(checkStatuses, value);
}

export function checkStatusKeyOf(value: unknown): MessageKey | undefined {
  const status = checkStatusOf(value);
  return status === undefined ? undefined : checkStatuses[status];
}

const ticketStatuses: Readonly<Record<SupportTicketStatus, MessageKey>> = {
  open: "support.status.open",
  "pending-customer": "support.status.pending-customer",
  escalated: "support.status.escalated",
  resolved: "support.status.resolved"
};

export function ticketStatusOf(value: unknown): SupportTicketStatus | undefined {
  return enumOf(ticketStatuses, value);
}

export function ticketStatusKeyOf(value: unknown): MessageKey | undefined {
  const status = ticketStatusOf(value);
  return status === undefined ? undefined : ticketStatuses[status];
}

const ticketPriorities: Readonly<Record<SupportTicketPriority, MessageKey>> = {
  low: "support.priority.low",
  normal: "support.priority.normal",
  high: "support.priority.high",
  urgent: "support.priority.urgent"
};

export function ticketPriorityKeyOf(value: unknown): MessageKey | undefined {
  return member(ticketPriorities, textOf(value, ""));
}

const ticketChannels: Readonly<Record<SupportTicketChannel, MessageKey>> = {
  miniapp: "support.channel.miniapp",
  telegram: "support.channel.telegram"
};

export function ticketChannelKeyOf(value: unknown): MessageKey | undefined {
  return member(ticketChannels, textOf(value, ""));
}

const supportAuthors: Readonly<Record<string, MessageKey>> = {
  customer: "support.author.customer",
  operator: "support.author.operator",
  system: "support.author.system"
};

export function supportAuthorKeyOf(value: unknown): MessageKey | undefined {
  return member(supportAuthors, textOf(value, ""));
}

const withdrawalStatuses: Readonly<Record<WithdrawalIntentStatus, MessageKey>> = {
  draft: "withdrawals.status.draft",
  screened: "withdrawals.status.screened",
  pending_maker_approval: "withdrawals.status.pending_maker_approval",
  pending_checker_approval: "withdrawals.status.pending_checker_approval",
  unsigned_intent_ready: "withdrawals.status.unsigned_intent_ready",
  broadcast: "withdrawals.status.broadcast",
  confirmed: "withdrawals.status.confirmed",
  rejected: "withdrawals.status.rejected",
  cancelled: "withdrawals.status.cancelled",
  expired: "withdrawals.status.expired"
};

export function withdrawalStatusOf(value: unknown): WithdrawalIntentStatus | undefined {
  return enumOf(withdrawalStatuses, value);
}

export function withdrawalStatusKeyOf(value: unknown): MessageKey | undefined {
  const status = withdrawalStatusOf(value);
  return status === undefined ? undefined : withdrawalStatuses[status];
}

const custodyIncidentStatuses: Readonly<Record<CustodyIncidentStatus, MessageKey>> = {
  open: "custody.incidentStatus.open",
  investigating: "custody.incidentStatus.investigating",
  resolved: "custody.incidentStatus.resolved"
};

export function custodyIncidentStatusKeyOf(value: unknown): MessageKey | undefined {
  return member(custodyIncidentStatuses, textOf(value, ""));
}

const withdrawalRoles: Readonly<Record<WithdrawalApprovalRole, MessageKey>> = {
  custody_maker: "withdrawals.role.custody_maker",
  custody_checker: "withdrawals.role.custody_checker"
};

export function withdrawalRoleKeyOf(value: unknown): MessageKey | undefined {
  return member(withdrawalRoles, textOf(value, ""));
}

const withdrawalDecisions: Readonly<Record<WithdrawalApprovalDecision, MessageKey>> = {
  pending: "withdrawals.decision.pending",
  approved: "withdrawals.decision.approved",
  rejected: "withdrawals.decision.rejected"
};

export function withdrawalDecisionKeyOf(value: unknown): MessageKey | undefined {
  return member(withdrawalDecisions, textOf(value, ""));
}

const subjectKinds: Readonly<Record<SubjectTimelineKind, MessageKey>> = {
  check: "subjects.kind.check",
  support: "subjects.kind.support",
  withdrawal: "subjects.kind.withdrawal",
  kyc: "subjects.kind.kyc",
  aml: "subjects.kind.aml",
  investigation: "subjects.kind.investigation",
  "fraud-alert": "subjects.kind.fraud-alert",
  audit: "subjects.kind.audit"
};

export function subjectKindKeyOf(value: unknown): MessageKey | undefined {
  return member(subjectKinds, textOf(value, ""));
}

/**
 * Timeline entries link into the detail views only where that entity kind has
 * a dedicated screen and the operator can read it; foreign kinds (and
 * prototype members like "__proto__"/"constructor", which resolve truthy on a
 * plain-object map) resolve to no link instead of crashing or mislinking.
 */
const subjectEntryLinks: Partial<Record<SubjectTimelineKind, { screen: ScreenId; capability: Capability }>> = {
  check: { screen: "checks", capability: "checks:read" },
  support: { screen: "support", capability: "support:read" },
  withdrawal: { screen: "withdrawal", capability: "custody:read" }
};

export function subjectEntryLinkOf(kind: unknown): { screen: ScreenId; capability: Capability } | undefined {
  return member(subjectEntryLinks, textOf(kind, ""));
}

const operatorRoles: Readonly<Record<OperatorRole, MessageKey>> = {
  "compliance-lead": "role.compliance-lead",
  "support-l1": "role.support-l1",
  "aml-investigator": "role.aml-investigator",
  "fraud-investigator": "role.fraud-investigator",
  auditor: "role.auditor"
};

export function operatorRoleOf(value: unknown): OperatorRole | undefined {
  return enumOf(operatorRoles, value);
}

export function operatorRoleKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorRoles, textOf(value, ""));
}

const operatorKycStatuses: Readonly<Record<OperatorKycStatus, MessageKey>> = {
  unverified: "customers.kycStatus.unverified",
  pending: "customers.kycStatus.pending",
  verified: "customers.kycStatus.verified"
};

export function operatorKycStatusKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorKycStatuses, textOf(value, ""));
}

const operatorAccountStatuses: Readonly<Record<OperatorAccountStatus, MessageKey>> = {
  active: "customers.account.active",
  closed: "customers.account.closed",
  dormant: "customers.account.dormant",
  restricted: "customers.account.restricted"
};

export function operatorAccountStatusKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorAccountStatuses, textOf(value, ""));
}

const operatorQueueStates: Readonly<Record<OperatorQueueState, MessageKey>> = {
  pending: "kyc.queueState.pending",
  in_review: "kyc.queueState.inReview",
  escalated: "kyc.queueState.escalated"
};

export function operatorQueueStateKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorQueueStates, textOf(value, ""));
}

const operatorQueuePriorities: Readonly<Record<OperatorQueuePriority, MessageKey>> = {
  normal: "kyc.queuePriority.normal",
  high: "kyc.queuePriority.high",
  urgent: "kyc.queuePriority.urgent"
};

export function operatorQueuePriorityKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorQueuePriorities, textOf(value, ""));
}

const operatorAmlAlertTypes: Readonly<Record<OperatorAmlAlertType, MessageKey>> = {
  structuring: "aml.alertType.structuring",
  velocity: "aml.alertType.velocity",
  geo_mismatch: "aml.alertType.geoMismatch"
};

export function operatorAmlAlertTypeKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorAmlAlertTypes, textOf(value, ""));
}

const operatorActivityKinds: Readonly<Record<OperatorActivityKind, MessageKey>> = {
  deposit: "activity.kind.deposit",
  withdrawal: "activity.kind.withdrawal",
  quote: "activity.kind.quote",
  order: "activity.kind.order",
  payment: "activity.kind.payment",
  card: "activity.kind.card",
  check: "activity.kind.check",
  kyc: "activity.kind.kyc",
  security: "activity.kind.security",
  kyc_transition: "activity.kind.kycTransition",
  flag_added: "activity.kind.flagAdded"
};

export function operatorActivityKindKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorActivityKinds, textOf(value, ""));
}

// The recent_activity summary enum is i18n-safe by contract: the customer
// per-kind statuses plus the operator-side event values. The AML alert-type
// summaries reuse the alert labels instead of a parallel copy.
const operatorActivitySummaries: Readonly<Record<string, MessageKey>> = {
  awaiting_payment: "activity.summary.awaitingPayment",
  payment_received: "activity.summary.paymentReceived",
  partial_payment: "activity.summary.partialPayment",
  duplicate_payment: "activity.summary.duplicatePayment",
  payment_reversed: "activity.summary.paymentReversed",
  expired_no_payment: "activity.summary.expiredNoPayment",
  draft: "activity.summary.draft",
  screened: "activity.summary.screened",
  pending_maker_approval: "activity.summary.pendingMakerApproval",
  pending_checker_approval: "activity.summary.pendingCheckerApproval",
  unsigned_intent_ready: "activity.summary.unsignedIntentReady",
  broadcast: "activity.summary.broadcast",
  confirmed: "activity.summary.confirmed",
  rejected: "activity.summary.rejected",
  cancelled: "activity.summary.cancelled",
  expired: "activity.summary.expired",
  indicative: "activity.summary.indicative",
  open: "activity.summary.open",
  created: "activity.summary.created",
  processing: "activity.summary.processing",
  completed: "activity.summary.completed",
  failed: "activity.summary.failed",
  reversed: "activity.summary.reversed",
  pending_activation: "activity.summary.pendingActivation",
  active: "activity.summary.active",
  frozen: "activity.summary.frozen",
  blocked: "activity.summary.blocked",
  terminated: "activity.summary.terminated",
  awaiting_confirmation: "activity.summary.awaitingConfirmation",
  awaiting_recipient_kyc: "activity.summary.awaitingRecipientKyc",
  claimed: "activity.summary.claimed",
  submitted: "activity.summary.submitted",
  in_review: "activity.summary.inReview",
  approved: "activity.summary.approved",
  needs_more_data: "activity.summary.needsMoreData",
  timed_out: "activity.summary.timedOut",
  unavailable: "activity.summary.unavailable",
  login: "activity.summary.login",
  revoked: "activity.summary.revoked",
  structuring: "aml.alertType.structuring",
  velocity: "aml.alertType.velocity",
  geo_mismatch: "aml.alertType.geoMismatch"
};

export function operatorActivitySummaryKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorActivitySummaries, textOf(value, ""));
}

// The dossier's current application state reuses the activity summary
// labels for the KYC application vocabulary — the same localized copy
// the kyc_transition events render with.
const operatorSubjectKycStatuses: Readonly<Record<OperatorSubjectKycStatus, MessageKey>> = {
  submitted: "activity.summary.submitted",
  in_review: "activity.summary.inReview",
  approved: "activity.summary.approved",
  rejected: "activity.summary.rejected",
  needs_more_data: "activity.summary.needsMoreData",
  timed_out: "activity.summary.timedOut"
};

export function operatorSubjectKycStatusKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorSubjectKycStatuses, textOf(value, ""));
}

const operatorSubjectKycLevels: Readonly<Record<OperatorSubjectKycLevel, MessageKey>> = {
  basic: "kyc.level.basic",
  enhanced: "kyc.level.enhanced"
};

export function operatorSubjectKycLevelKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorSubjectKycLevels, textOf(value, ""));
}

const operatorSubjectKycReasons: Readonly<Record<OperatorSubjectKycReason, MessageKey>> = {
  SIM_DOCUMENT_UNREADABLE: "kyc.reason.simDocumentUnreadable",
  SIM_DATA_MISMATCH: "kyc.reason.simDataMismatch"
};

export function operatorSubjectKycReasonKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorSubjectKycReasons, textOf(value, ""));
}

const operatorTicketQueueStates: Readonly<Record<OperatorTicketQueueState, MessageKey>> = {
  open: "support.queueState.open",
  waiting: "support.queueState.waiting",
  escalated: "support.queueState.escalated"
};

export function operatorTicketQueueStateKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorTicketQueueStates, textOf(value, ""));
}

const operatorTicketCategories: Readonly<Record<OperatorTicketCategory, MessageKey>> = {
  question: "support.category.question",
  operation_problem: "support.category.operationProblem",
  complaint: "support.category.complaint",
  data_request: "support.category.dataRequest"
};

export function operatorTicketCategoryKeyOf(value: unknown): MessageKey | undefined {
  return member(operatorTicketCategories, textOf(value, ""));
}
