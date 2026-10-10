import type { Capability, OperatorRole } from "../auth/access.js";
import type {
  CheckStatus,
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
  "waiting-recipient-kyc": "checks.status.waiting-recipient-kyc",
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
  "pending-approval": "withdrawals.status.pending-approval",
  screened: "withdrawals.status.screened",
  broadcast: "withdrawals.status.broadcast",
  confirmed: "withdrawals.status.confirmed",
  rejected: "withdrawals.status.rejected",
  cancelled: "withdrawals.status.cancelled"
};

export function withdrawalStatusOf(value: unknown): WithdrawalIntentStatus | undefined {
  return enumOf(withdrawalStatuses, value);
}

export function withdrawalStatusKeyOf(value: unknown): MessageKey | undefined {
  const status = withdrawalStatusOf(value);
  return status === undefined ? undefined : withdrawalStatuses[status];
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
