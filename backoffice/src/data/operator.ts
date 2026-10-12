import type { OperatorRole } from "../auth/access.js";

/**
 * Fail-closed adapter for the backoffice BFF operator reads
 * (`/bff/api/operator/subjects`, `/bff/api/operator/subjects/{subjectId}`,
 * `/bff/api/operator/queue`). The BFF signs camelCase payloads whose axes are
 * the same ones `src/server/customer-api-client.ts` pins on the upstream
 * snake_case contract — exact key sets, synthetic ref patterns, enum
 * membership, coherent ISO timestamps and the `posting: "none"` sentinel.
 * A payload that violates any axis resolves to `undefined` so the views
 * degrade to their local demo rows instead of rendering unverifiable data;
 * fields the view does not need are never copied out.
 */

export type OperatorKycStatus = "unverified" | "pending" | "verified";
export type OperatorAccountStatus = "active" | "closed" | "dormant" | "restricted";
export type OperatorActivityCustomerKind =
  | "deposit"
  | "withdrawal"
  | "quote"
  | "order"
  | "payment"
  | "card"
  | "check"
  | "kyc"
  | "security";
export type OperatorActivityOperatorKind = "kyc_transition" | "flag_added";
export type OperatorActivityKind = OperatorActivityCustomerKind | OperatorActivityOperatorKind;

export interface OperatorActivityMoney {
  amount: string;
  asset: string;
}

/** One recent_activity item: `act_*` customer feed items or `opact_*` operator events. */
export interface OperatorActivityItem {
  activityId: string;
  kind: OperatorActivityKind;
  occurredAt: string;
  summary: string;
  money: OperatorActivityMoney | null;
}
export type OperatorQueueKind = "kyc" | "aml" | "tickets";
export type OperatorQueueState = "pending" | "in_review" | "escalated";
export type OperatorTicketQueueState = "open" | "waiting" | "escalated";
export type OperatorQueuePriority = "normal" | "high" | "urgent";
export type OperatorAmlAlertType = "structuring" | "velocity" | "geo_mismatch";
// The ticket categories echo the customer support ticket universe.
export type OperatorTicketCategory = "question" | "operation_problem" | "complaint" | "data_request";

export interface OperatorSubjectRow {
  subjectId: string;
  displayName: string;
  kycStatus: OperatorKycStatus;
  flags: number;
  registeredAt: string;
  lastActiveAt: string;
  posting: "none";
}

/** The KYC application states the subject dossier can carry. */
export type OperatorSubjectKycStatus =
  | "approved"
  | "in_review"
  | "needs_more_data"
  | "rejected"
  | "submitted"
  | "timed_out";
export type OperatorSubjectKycLevel = "basic" | "enhanced";
export type OperatorSubjectKycReason = "SIM_DOCUMENT_UNREADABLE" | "SIM_DATA_MISMATCH";

/** One KYC attempt inside the subject dossier history. */
export interface OperatorSubjectKycAttempt {
  sessionId: string;
  state: OperatorSubjectKycStatus;
  submittedAt: string;
  decidedAt: string | null;
  rejectionReason: OperatorSubjectKycReason | null;
}

/** The subject's KYC dossier: current state, level and session handle plus the newest-first attempt history. */
export interface OperatorSubjectKyc {
  status: OperatorSubjectKycStatus;
  level: OperatorSubjectKycLevel;
  sessionId: string;
  history: readonly OperatorSubjectKycAttempt[];
}

export interface OperatorSubjectDetail extends OperatorSubjectRow {
  accountStatus: OperatorAccountStatus;
  contactHash: string;
  sessions: number;
  devices: readonly string[];
  limits: { maxSessions: number; maxDevices: number };
  recentActivity: readonly OperatorActivityItem[];
  kyc: OperatorSubjectKyc | null;
}

export interface OperatorSubjectsView {
  mode: "test";
  subjects: readonly OperatorSubjectRow[];
}

export interface OperatorSubjectView {
  mode: "test";
  subject: OperatorSubjectDetail;
}

export interface OperatorQueueItem {
  queueId: string;
  subjectId: string;
  displayName: string;
  submittedAt: string;
  slaDueAt: string;
  state: OperatorQueueState;
  priority: OperatorQueuePriority;
  assignee: { subject: string } | null;
  ageMs: number;
}

export interface OperatorAmlQueueItem {
  queueId: string;
  subjectId: string;
  alertType: OperatorAmlAlertType;
  evidenceRefs: readonly string[];
  slaDueAt: string;
  state: OperatorQueueState;
  priority: OperatorQueuePriority;
  assignee: { subject: string } | null;
  ageMs: number;
}

export interface OperatorTicketQueueItem {
  queueId: string;
  subjectId: string;
  category: OperatorTicketCategory;
  openedAt: string;
  state: OperatorTicketQueueState;
  priority: OperatorQueuePriority;
  assignee: { subject: string } | null;
  ageMs: number;
}

export interface OperatorQueueSummary<ByState> {
  count: number;
  byState: ByState;
}

export type OperatorQueueView =
  | {
      mode: "test";
      queue: {
        kind: "kyc";
        items: readonly OperatorQueueItem[];
        summary: OperatorQueueSummary<{ pending: number; inReview: number; escalated: number }>;
        posting: "none";
      };
    }
  | {
      mode: "test";
      queue: {
        kind: "aml";
        items: readonly OperatorAmlQueueItem[];
        summary: OperatorQueueSummary<{ pending: number; inReview: number; escalated: number }>;
        posting: "none";
      };
    }
  | {
      mode: "test";
      queue: {
        kind: "tickets";
        items: readonly OperatorTicketQueueItem[];
        summary: OperatorQueueSummary<{ open: number; waiting: number; escalated: number }>;
        posting: "none";
      };
    };

/** One flag record inside the aml queue item detail. */
export interface OperatorQueueItemFlag {
  flagId: string;
  alertType: OperatorAmlAlertType;
  raisedAt: string;
}

/** A kyc queue item detail: the queue row plus the subject's kyc dossier block. */
export interface OperatorKycQueueItemDetail extends OperatorQueueItem {
  kyc: OperatorSubjectKyc | null;
}

/** An aml queue item detail: the queue row plus the subject's open flag list. */
export interface OperatorAmlQueueItemDetail extends OperatorAmlQueueItem {
  flags: readonly OperatorQueueItemFlag[];
}

/** A tickets queue item detail: the queue row plus the ticket extension. */
export interface OperatorTicketQueueItemDetail extends OperatorTicketQueueItem {
  subject: string;
  lastMessageAt: string;
  otherOpenTickets: number;
}

/** The queue item member read, discriminated by kind like the collection. */
export type OperatorQueueItemDetailView =
  | { mode: "test"; kind: "kyc"; item: OperatorKycQueueItemDetail }
  | { mode: "test"; kind: "aml"; item: OperatorAmlQueueItemDetail }
  | { mode: "test"; kind: "tickets"; item: OperatorTicketQueueItemDetail };

export type OperatorAuditAction =
  | "session.opened"
  | "session.rotated"
  | "queue.viewed"
  | "subject.viewed"
  | "flag.reviewed";

export type OperatorAuditTargetKind = "session" | "queue_item" | "subject" | "flag";

/** One operator action-log row — opaque handles only, never PII. */
export interface OperatorAuditEntry {
  auditId: string;
  actorSubjectId: string;
  actorRole: string;
  action: OperatorAuditAction;
  targetKind: OperatorAuditTargetKind;
  targetId: string;
  at: string;
  detailHash: string;
}

/** The operator audit feed read, newest-first with a page cursor. */
export interface OperatorAuditView {
  mode: "test";
  audit: {
    asOf: string;
    entries: readonly OperatorAuditEntry[];
    nextCursor: string | null;
  };
}

const operatorSubjectsViewKeys = ["mode", "subjects"] as const;
const subjectRowKeys = [
  "displayName",
  "flags",
  "kycStatus",
  "lastActiveAt",
  "posting",
  "registeredAt",
  "subjectId"
] as const;
const subjectDetailViewKeys = ["mode", "subject"] as const;
const subjectDetailKeys = [
  "accountStatus",
  "contactHash",
  "devices",
  "displayName",
  "flags",
  "kyc",
  "kycStatus",
  "lastActiveAt",
  "limits",
  "posting",
  "recentActivity",
  "registeredAt",
  "sessions",
  "subjectId"
] as const;
const subjectKycKeys = ["history", "level", "sessionId", "status"] as const;
const subjectKycAttemptKeys = ["decidedAt", "rejectionReason", "sessionId", "state", "submittedAt"] as const;
const subjectKycStatuses: ReadonlySet<string> = new Set([
  "approved",
  "in_review",
  "needs_more_data",
  "rejected",
  "submitted",
  "timed_out"
]);
const subjectKycPendingStatuses: ReadonlySet<string> = new Set(["submitted", "in_review"]);
const subjectKycEndings: ReadonlySet<string> = new Set(["rejected", "needs_more_data", "timed_out"]);
const subjectKycLevels: ReadonlySet<string> = new Set(["basic", "enhanced"]);
const subjectKycReasonCodes: ReadonlySet<string> = new Set(["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"]);
const kycSessionPattern = /^kys_[0-9a-f]{24}$/;
const kycHistoryBound = 4;
const subjectLimitKeys = ["maxDevices", "maxSessions"] as const;
const activityItemKeys = ["activityId", "kind", "occurredAt", "summary", "money"] as const;
const activityMoneyKeys = ["amount", "asset"] as const;
const activityIdPattern = /^(act|opact)_[0-9a-f]{24}$/;
const activityBound = 8;
const customerActivityStatuses: Readonly<Record<OperatorActivityCustomerKind, ReadonlySet<string>>> = {
  deposit: new Set([
    "awaiting_payment",
    "payment_received",
    "partial_payment",
    "duplicate_payment",
    "payment_reversed",
    "expired_no_payment"
  ]),
  withdrawal: new Set([
    "draft",
    "screened",
    "pending_maker_approval",
    "pending_checker_approval",
    "unsigned_intent_ready",
    "broadcast",
    "confirmed",
    "rejected",
    "cancelled",
    "expired"
  ]),
  quote: new Set(["indicative"]),
  order: new Set(["open", "cancelled", "expired", "rejected"]),
  payment: new Set(["created", "processing", "completed", "failed", "reversed", "cancelled", "expired"]),
  card: new Set(["pending_activation", "active", "frozen", "blocked", "expired", "terminated"]),
  check: new Set(["awaiting_confirmation", "created", "awaiting_recipient_kyc", "claimed", "cancelled", "expired"]),
  kyc: new Set(["submitted", "in_review", "approved", "rejected", "needs_more_data", "timed_out", "unavailable"]),
  security: new Set(["login", "revoked"])
};
const customerActivityKinds: ReadonlySet<string> = new Set(Object.keys(customerActivityStatuses));
const operatorOnlyActivityKinds: ReadonlySet<string> = new Set(["kyc_transition", "flag_added"]);
const activityMoneyKinds: ReadonlySet<string> = new Set(
  [...customerActivityKinds].filter((kind) => kind !== "kyc" && kind !== "security")
);
const kycTransitionSummaries: ReadonlySet<string> = new Set(["submitted", "approved"]);
const amlAlertTypes: ReadonlySet<string> = new Set(["structuring", "velocity", "geo_mismatch"]);
const activitySummaries: ReadonlySet<string> = new Set([
  ...Object.values(customerActivityStatuses).flatMap((statuses) => [...statuses]),
  ...kycTransitionSummaries,
  ...amlAlertTypes
]);
const activityAssetScales: ReadonlyMap<string, number> = new Map([["RUB", 2], ["USDT", 6], ["TON", 9]]);
const queueViewKeys = ["mode", "queue"] as const;
const queueKeys = ["items", "kind", "posting", "summary"] as const;
const queueItemKeys = [
  "ageMs",
  "assignee",
  "displayName",
  "priority",
  "queueId",
  "slaDueAt",
  "state",
  "subjectId",
  "submittedAt"
] as const;
const queueSummaryKeys = ["byState", "count"] as const;
const queueByStateKeys = ["escalated", "inReview", "pending"] as const;
const queueTicketByStateKeys = ["escalated", "open", "waiting"] as const;
const queueAssigneeKeys = ["subject"] as const;
const amlQueueItemKeys = [
  "ageMs",
  "alertType",
  "assignee",
  "evidenceRefs",
  "priority",
  "queueId",
  "slaDueAt",
  "state",
  "subjectId"
] as const;
const ticketQueueItemKeys = [
  "ageMs",
  "assignee",
  "category",
  "openedAt",
  "priority",
  "queueId",
  "state",
  "subjectId"
] as const;
const queueItemDetailViewKeys = ["item", "kind", "mode"] as const;
const kycQueueItemDetailKeys = [...queueItemKeys, "kyc"] as const;
const amlQueueItemDetailKeys = [...amlQueueItemKeys, "flags"] as const;
const ticketQueueItemDetailKeys = [
  ...ticketQueueItemKeys,
  "lastMessageAt",
  "otherOpenTickets",
  "subject"
] as const;
const queueItemFlagKeys = ["alertType", "flagId", "raisedAt"] as const;

const customerSubjectPattern = /^syn_cust_[a-z0-9]{8,32}$/;
const operatorSubjectPattern = /^syn_oper_[a-z0-9]{8,32}$/;
const displayNamePattern = /^[A-Z][a-z]{1,31} [A-Z][a-z]{1,31}$/;
const isoTimestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const contactHashPattern = /^cth_[0-9a-f]{32}$/;
const deviceRefPattern = /^dev_[0-9a-f]{16}$/;
const queueIdPattern = /^qky_[0-9a-f]{24}$/;
const amlQueueIdPattern = /^qml_[0-9a-f]{24}$/;
const ticketQueueIdPattern = /^qtick_[0-9a-f]{24}$/;
const flagIdPattern = /^flg_[0-9a-f]{24}$/;
const evidenceRefPattern = /^evd_[0-9a-f]{24}$/;
const evidenceRefsMaxItems = 8;
const queueItemFlagsMaxItems = 8;
const ticketSubjectMaxLength = 160;

const kycStatuses: ReadonlySet<string> = new Set(["unverified", "pending", "verified"]);
const accountStatuses: ReadonlySet<string> = new Set(["active", "closed", "dormant", "restricted"]);
const queueStates: ReadonlySet<string> = new Set(["pending", "in_review", "escalated"]);
const queueTicketStates: ReadonlySet<string> = new Set(["open", "waiting", "escalated"]);
const queuePriorities: ReadonlySet<string> = new Set(["normal", "high", "urgent"]);
const ticketCategories: ReadonlySet<string> = new Set(["question", "operation_problem", "complaint", "data_request"]);

const subjectsMaxItems = 64;
const queueMaxItems = 64;
const subjectSessionsMax = 16;
const subjectDevicesMax = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string"
    && isoTimestampPattern.test(value)
    && new Date(Date.parse(value)).toISOString() === value
  );
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseSubjectRow(item: unknown, seen: Set<string>): OperatorSubjectRow | undefined {
  if (
    !isRecord(item)
    || !hasExactKeys(item, subjectRowKeys)
    || typeof item.subjectId !== "string"
    || !customerSubjectPattern.test(item.subjectId)
    || seen.has(item.subjectId)
    || typeof item.displayName !== "string"
    || !displayNamePattern.test(item.displayName)
    || typeof item.kycStatus !== "string"
    || !kycStatuses.has(item.kycStatus)
    || !isNonNegativeInt(item.flags)
    || !isIsoTimestamp(item.registeredAt)
    || !isIsoTimestamp(item.lastActiveAt)
    || Date.parse(item.lastActiveAt) < Date.parse(item.registeredAt)
    || item.posting !== "none"
  ) {
    return undefined;
  }
  seen.add(item.subjectId);
  return Object.freeze({
    subjectId: item.subjectId,
    displayName: item.displayName,
    kycStatus: item.kycStatus as OperatorKycStatus,
    flags: item.flags,
    registeredAt: item.registeredAt,
    lastActiveAt: item.lastActiveAt,
    posting: "none"
  });
}

/**
 * The operator subjects list: `syn_cust_*` refs, transliterated display names,
 * the lifecycle kyc_status enum, non-negative integer flag counts, coherent
 * ISO timestamps and the pinned `posting: "none"` sentinel — the same axes
 * the BFF-side upstream validator pins.
 */
export function parseOperatorSubjectsView(value: unknown): OperatorSubjectsView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, operatorSubjectsViewKeys)) {
    return undefined;
  }
  if (
    value.mode !== "test"
    || !Array.isArray(value.subjects)
    || value.subjects.length < 1
    || value.subjects.length > subjectsMaxItems
  ) {
    return undefined;
  }
  const seen = new Set<string>();
  const rows: OperatorSubjectRow[] = [];
  for (const item of value.subjects) {
    const row = parseSubjectRow(item, seen);
    if (row === undefined) return undefined;
    rows.push(row);
  }
  return Object.freeze({ mode: "test", subjects: Object.freeze(rows) });
}

/**
 * One recent_activity item: exact key set, `act_*`/`opact_*` ref grammar,
 * the kind and summary vocabularies, the prefix↔kind and money↔kind
 * coherence rules and a positive scaled-decimal amount.
 */
function parseActivityItem(item: unknown): OperatorActivityItem | undefined {
  if (!isRecord(item) || !hasExactKeys(item, activityItemKeys)) {
    return undefined;
  }
  if (
    typeof item.activityId !== "string"
    || !activityIdPattern.test(item.activityId)
    || typeof item.kind !== "string"
    || !(customerActivityKinds.has(item.kind) || operatorOnlyActivityKinds.has(item.kind))
    || typeof item.summary !== "string"
    || !activitySummaries.has(item.summary)
    || !isIsoTimestamp(item.occurredAt)
  ) {
    return undefined;
  }
  const operatorKind = operatorOnlyActivityKinds.has(item.kind);
  if (operatorKind !== item.activityId.startsWith("opact_")) {
    return undefined;
  }
  if (operatorKind) {
    if (item.kind === "kyc_transition" && !kycTransitionSummaries.has(item.summary)) {
      return undefined;
    }
    if (item.kind === "flag_added" && !amlAlertTypes.has(item.summary)) {
      return undefined;
    }
  } else if (!(customerActivityStatuses[item.kind as OperatorActivityCustomerKind] ?? new Set()).has(item.summary)) {
    return undefined;
  }
  if (item.money === null) {
    if (activityMoneyKinds.has(item.kind)) {
      return undefined;
    }
    return Object.freeze({
      activityId: item.activityId,
      kind: item.kind as OperatorActivityKind,
      occurredAt: item.occurredAt,
      summary: item.summary,
      money: null
    });
  }
  if (
    !activityMoneyKinds.has(item.kind)
    || !isRecord(item.money)
    || !hasExactKeys(item.money, activityMoneyKeys)
    || typeof item.money.amount !== "string"
    || typeof item.money.asset !== "string"
  ) {
    return undefined;
  }
  const scale = activityAssetScales.get(item.money.asset);
  if (
    scale === undefined
    || !new RegExp(`^(0|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u").test(item.money.amount)
    || BigInt(item.money.amount.replace(".", "")) <= 0n
  ) {
    return undefined;
  }
  return Object.freeze({
    activityId: item.activityId,
    kind: item.kind as OperatorActivityKind,
    occurredAt: item.occurredAt,
    summary: item.summary,
    money: Object.freeze({ amount: item.money.amount, asset: item.money.asset })
  });
}

/**
 * The recent_activity page: a bounded newest-first list with unique ids.
 * Every instant sits inside the account window: nothing precedes
 * registration, and the subject-side items — the subject's own `act_*`
 * feed rows and the kyc submission transition — never postdate
 * lastActiveAt (a flag raise or a kyc decision is operator-side work and
 * legitimately can).
 */
function parseRecentActivity(
  value: unknown,
  registeredAt: string,
  lastActiveAt: string
): readonly OperatorActivityItem[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > activityBound) {
    return undefined;
  }
  const registeredMs = Date.parse(registeredAt);
  const lastActiveMs = Date.parse(lastActiveAt);
  const seen = new Set<string>();
  const items: OperatorActivityItem[] = [];
  let previousMs = Number.POSITIVE_INFINITY;
  let previousId = "";
  for (const raw of value) {
    const item = parseActivityItem(raw);
    if (item === undefined || seen.has(item.activityId)) {
      return undefined;
    }
    const occurredMs = Date.parse(item.occurredAt);
    if (occurredMs < registeredMs) {
      return undefined;
    }
    const operatorSide = item.activityId.startsWith("opact_")
      && !(item.kind === "kyc_transition" && item.summary === "submitted");
    if (!operatorSide && occurredMs > lastActiveMs) {
      return undefined;
    }
    if (
      occurredMs > previousMs
      || (occurredMs === previousMs && item.activityId.localeCompare(previousId) <= 0)
    ) {
      return undefined;
    }
    seen.add(item.activityId);
    previousMs = occurredMs;
    previousId = item.activityId;
    items.push(item);
  }
  return Object.freeze(items);
}

/**
 * One KYC dossier block: exact key sets, status/level/reason vocabularies,
 * the `kys_*` session grammar, the review-window and resubmittable-ending
 * rules, unique session ids, newest-first ordering, the header echoing
 * the newest attempt and the roster kyc_status coherence — the same axes
 * the upstream `validOperatorSubjectKyc` validator pins.
 */
function parseSubjectKyc(value: unknown, rosterKycStatus?: string): OperatorSubjectKyc | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, subjectKycKeys)
    || typeof value.status !== "string"
    || !subjectKycStatuses.has(value.status)
    || typeof value.level !== "string"
    || !subjectKycLevels.has(value.level)
    || typeof value.sessionId !== "string"
    || !kycSessionPattern.test(value.sessionId)
    || !Array.isArray(value.history)
    || value.history.length < 1
    || value.history.length > kycHistoryBound
  ) {
    return undefined;
  }
  const status = value.status as OperatorSubjectKycStatus;
  // The roster kyc_status bounds the current state — subset discipline.
  // Callers without the roster row (the queue item detail validates the
  // dossier standalone, like upstream) pass no status and skip the bound.
  if (
    (rosterKycStatus === "verified" && status !== "approved")
    || (rosterKycStatus === "pending" && !subjectKycPendingStatuses.has(status))
    || (rosterKycStatus === "unverified" && (status === "approved" || subjectKycPendingStatuses.has(status)))
  ) {
    return undefined;
  }
  const sessionIds = new Set<string>();
  const history: OperatorSubjectKycAttempt[] = [];
  let previousSubmittedAt = "";
  for (const [index, raw] of value.history.entries()) {
    if (!isRecord(raw) || !hasExactKeys(raw, subjectKycAttemptKeys)) {
      return undefined;
    }
    if (
      typeof raw.sessionId !== "string"
      || !kycSessionPattern.test(raw.sessionId)
      || sessionIds.has(raw.sessionId)
      || typeof raw.state !== "string"
      || !subjectKycStatuses.has(raw.state)
      || !isIsoTimestamp(raw.submittedAt)
    ) {
      return undefined;
    }
    sessionIds.add(raw.sessionId);
    const inReview = subjectKycPendingStatuses.has(raw.state);
    if (raw.decidedAt === null) {
      // Only attempts still inside the review window lack a decision.
      if (!inReview) {
        return undefined;
      }
    } else if (
      typeof raw.decidedAt !== "string"
      || !isIsoTimestamp(raw.decidedAt)
      || inReview
      || Date.parse(raw.decidedAt) < Date.parse(raw.submittedAt)
    ) {
      return undefined;
    }
    // A rejectionReason is only ever carried by a rejected attempt.
    if (
      raw.rejectionReason !== null
      && (raw.state !== "rejected" || typeof raw.rejectionReason !== "string" || !subjectKycReasonCodes.has(raw.rejectionReason))
    ) {
      return undefined;
    }
    // A resubmission only follows a resubmittable ending decided no
    // later than the next attempt's submission; the page is newest
    // first and equal instants keep mint order.
    if (
      index > 0
      && (!subjectKycEndings.has(raw.state)
        || raw.decidedAt === null
        || raw.decidedAt > (value.history[index - 1] as { submittedAt: string }).submittedAt
        || (raw.submittedAt as string) > previousSubmittedAt)
    ) {
      return undefined;
    }
    previousSubmittedAt = raw.submittedAt as string;
    history.push(Object.freeze({
      sessionId: raw.sessionId,
      state: raw.state as OperatorSubjectKycStatus,
      submittedAt: raw.submittedAt,
      decidedAt: raw.decidedAt,
      rejectionReason: raw.rejectionReason as OperatorSubjectKycReason | null
    }));
  }
  // The header echoes the newest attempt.
  if (value.sessionId !== history[0].sessionId || status !== history[0].state) {
    return undefined;
  }
  return Object.freeze({
    status,
    level: value.level as OperatorSubjectKycLevel,
    sessionId: value.sessionId,
    history: Object.freeze(history)
  });
}

/**
 * The operator subject detail: the list row's axes plus the detail
 * extension — the account_status enum, the redacted `cth_*` contact digest,
 * a bounded integer session count, unique bounded `dev_*` device refs and a
 * limits echo the counts always fit inside.
 */
export function parseOperatorSubjectView(
  value: unknown,
  expectedSubject: string
): OperatorSubjectView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, subjectDetailViewKeys)) {
    return undefined;
  }
  const item = value.subject;
  if (
    value.mode !== "test"
    || !isRecord(item)
    || !hasExactKeys(item, subjectDetailKeys)
    || typeof item.subjectId !== "string"
    || item.subjectId !== expectedSubject
    || !customerSubjectPattern.test(item.subjectId)
    || typeof item.displayName !== "string"
    || !displayNamePattern.test(item.displayName)
    || typeof item.kycStatus !== "string"
    || !kycStatuses.has(item.kycStatus)
    || !isNonNegativeInt(item.flags)
    || !isIsoTimestamp(item.registeredAt)
    || !isIsoTimestamp(item.lastActiveAt)
    || Date.parse(item.lastActiveAt) < Date.parse(item.registeredAt)
    || item.posting !== "none"
    || typeof item.accountStatus !== "string"
    || !accountStatuses.has(item.accountStatus)
    || typeof item.contactHash !== "string"
    || !contactHashPattern.test(item.contactHash)
    || !isNonNegativeInt(item.sessions)
    || item.sessions > subjectSessionsMax
    || !Array.isArray(item.devices)
    || item.devices.length > subjectDevicesMax
    || new Set(item.devices).size !== item.devices.length
    || !item.devices.every((device) => typeof device === "string" && deviceRefPattern.test(device))
    || !isRecord(item.limits)
    || !hasExactKeys(item.limits, subjectLimitKeys)
    || !Number.isInteger(item.limits.maxSessions)
    || (item.limits.maxSessions as number) < 1
    || (item.limits.maxSessions as number) > subjectSessionsMax
    || !Number.isInteger(item.limits.maxDevices)
    || (item.limits.maxDevices as number) < 1
    || (item.limits.maxDevices as number) > subjectDevicesMax
    // Coherence mirrors the synthetic build: live counts can never exceed
    // the limits echo.
    || (item.sessions as number) > (item.limits.maxSessions as number)
    || (item.devices as unknown[]).length > (item.limits.maxDevices as number)
    // A live session sits on a device in a live account: zero registered
    // devices or a closed account means the session count must be zero.
    || ((item.sessions as number) > 0 && ((item.devices as unknown[]).length === 0 || item.accountStatus === "closed"))
  ) {
    return undefined;
  }
  const recentActivity = parseRecentActivity(item.recentActivity, item.registeredAt, item.lastActiveAt);
  if (recentActivity === undefined) {
    return undefined;
  }
  // The operator-side events cross-check against the roster within the
  // page bound — subset discipline like the upstream validator: no
  // transitions for unverified subjects, only submissions for pending
  // ones, distinct transition summaries, and flag rows never outnumber
  // the roster's open flags.
  const transitions = recentActivity.filter((activity) => activity.kind === "kyc_transition");
  if (
    (item.kycStatus === "unverified" && transitions.length !== 0)
    || (item.kycStatus === "pending" && transitions.some((activity) => activity.summary !== "submitted"))
    || new Set(transitions.map((activity) => activity.summary)).size !== transitions.length
    || recentActivity.filter((activity) => activity.kind === "flag_added").length > (item.flags as number)
  ) {
    return undefined;
  }
  // The nullable kyc dossier stays fail-closed like every other axis: a
  // present block must parse or the whole detail view is drift — a
  // malformed block must never silently render as the no-dossier state
  // while the sibling blocks still serve.
  const kyc = item.kyc === null ? null : parseSubjectKyc(item.kyc, item.kycStatus);
  if (kyc === undefined) {
    return undefined;
  }
  // Cross-block coherence: every dossier submission is subject-side work
  // inside the account window, and a surviving transition must project
  // the exact instant the dossier's newest attempt records.
  if (kyc !== null) {
    const registeredMs = Date.parse(item.registeredAt);
    const lastActiveMs = Date.parse(item.lastActiveAt);
    if (kyc.history.some((attempt) => {
      const submittedMs = Date.parse(attempt.submittedAt);
      return submittedMs < registeredMs || submittedMs > lastActiveMs;
    })) {
      return undefined;
    }
    const submitted = transitions.find((activity) => activity.summary === "submitted");
    const approved = transitions.find((activity) => activity.summary === "approved");
    if (
      (submitted !== undefined && submitted.occurredAt !== kyc.history[0].submittedAt)
      || (approved !== undefined && approved.occurredAt !== kyc.history[0].decidedAt)
    ) {
      return undefined;
    }
  }
  return Object.freeze({
    mode: "test",
    subject: Object.freeze({
      subjectId: item.subjectId,
      displayName: item.displayName,
      kycStatus: item.kycStatus as OperatorKycStatus,
      flags: item.flags,
      registeredAt: item.registeredAt,
      lastActiveAt: item.lastActiveAt,
      posting: "none",
      accountStatus: item.accountStatus as OperatorAccountStatus,
      contactHash: item.contactHash,
      sessions: item.sessions,
      devices: Object.freeze([...(item.devices as readonly string[])]),
      limits: Object.freeze({
        maxSessions: item.limits.maxSessions as number,
        maxDevices: item.limits.maxDevices as number
      }),
      recentActivity,
      kyc
    })
  });
}

/** The shared queue-item axes every kind pins: ref grammar, enums, assignee and age. */
function validQueueItemCore(
  item: Record<string, unknown>,
  keys: readonly string[],
  idPattern: RegExp,
  states: ReadonlySet<string>,
  seen: Set<string>
): boolean {
  if (
    !hasExactKeys(item, keys)
    || typeof item.queueId !== "string"
    || !idPattern.test(item.queueId)
    || seen.has(item.queueId)
    || typeof item.subjectId !== "string"
    || !customerSubjectPattern.test(item.subjectId)
    || typeof item.state !== "string"
    || !states.has(item.state)
    || typeof item.priority !== "string"
    || !queuePriorities.has(item.priority)
    || !isNonNegativeInt(item.ageMs)
  ) {
    return false;
  }
  if (item.assignee !== null) {
    if (
      !isRecord(item.assignee)
      || !hasExactKeys(item.assignee, queueAssigneeKeys)
      || typeof item.assignee.subject !== "string"
      || !operatorSubjectPattern.test(item.assignee.subject)
    ) {
      return false;
    }
  }
  return true;
}

function parseQueueAssignee(item: Record<string, unknown>): { subject: string } | null {
  return item.assignee === null ? null : Object.freeze({ subject: (item.assignee as { subject: string }).subject });
}

/**
 * The operator work queue, one projection per kind: `qky_*`/`qml_*`/
 * `qtick_*`/`evd_*`/`syn_cust_*`/`syn_oper_*` refs, the declared kind's
 * item shape and state vocabulary, coherent ISO timestamps, a non-negative
 * integer age and a summary that tallies the item set exactly.
 */
export function parseOperatorQueueView(value: unknown): OperatorQueueView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, queueViewKeys) || value.mode !== "test") {
    return undefined;
  }
  const queue = value.queue;
  if (
    !isRecord(queue)
    || !hasExactKeys(queue, queueKeys)
    || (queue.kind !== "kyc" && queue.kind !== "aml" && queue.kind !== "tickets")
    || queue.posting !== "none"
  ) {
    return undefined;
  }
  const kind = queue.kind;
  if (!Array.isArray(queue.items) || queue.items.length > queueMaxItems) {
    return undefined;
  }
  const seen = new Set<string>();
  const tallied: Record<string, number> = {};
  const items: (OperatorQueueItem | OperatorAmlQueueItem | OperatorTicketQueueItem)[] = [];
  for (const item of queue.items) {
    if (!isRecord(item)) {
      return undefined;
    }
    if (kind === "aml") {
      if (
        !validQueueItemCore(item, amlQueueItemKeys, amlQueueIdPattern, queueStates, seen)
        || typeof item.alertType !== "string"
        || !amlAlertTypes.has(item.alertType)
        || !Array.isArray(item.evidenceRefs)
        || item.evidenceRefs.length < 1
        || item.evidenceRefs.length > evidenceRefsMaxItems
        || new Set(item.evidenceRefs).size !== item.evidenceRefs.length
        || !item.evidenceRefs.every((ref) => typeof ref === "string" && evidenceRefPattern.test(ref))
        || !isIsoTimestamp(item.slaDueAt)
      ) {
        return undefined;
      }
      items.push(
        Object.freeze({
          queueId: item.queueId as string,
          subjectId: item.subjectId as string,
          alertType: item.alertType as OperatorAmlAlertType,
          evidenceRefs: Object.freeze([...(item.evidenceRefs as string[])]),
          slaDueAt: item.slaDueAt as string,
          state: item.state as OperatorQueueState,
          priority: item.priority as OperatorQueuePriority,
          assignee: parseQueueAssignee(item),
          ageMs: item.ageMs as number
        })
      );
    } else if (kind === "tickets") {
      if (
        !validQueueItemCore(item, ticketQueueItemKeys, ticketQueueIdPattern, queueTicketStates, seen)
        || typeof item.category !== "string"
        || !ticketCategories.has(item.category)
        || !isIsoTimestamp(item.openedAt)
      ) {
        return undefined;
      }
      items.push(
        Object.freeze({
          queueId: item.queueId as string,
          subjectId: item.subjectId as string,
          category: item.category as OperatorTicketCategory,
          openedAt: item.openedAt as string,
          state: item.state as OperatorTicketQueueState,
          priority: item.priority as OperatorQueuePriority,
          assignee: parseQueueAssignee(item),
          ageMs: item.ageMs as number
        })
      );
    } else {
      if (
        !validQueueItemCore(item, queueItemKeys, queueIdPattern, queueStates, seen)
        || typeof item.displayName !== "string"
        || !displayNamePattern.test(item.displayName)
        || !isIsoTimestamp(item.submittedAt)
        || !isIsoTimestamp(item.slaDueAt)
        || Date.parse(item.slaDueAt as string) <= Date.parse(item.submittedAt as string)
      ) {
        return undefined;
      }
      items.push(
        Object.freeze({
          queueId: item.queueId as string,
          subjectId: item.subjectId as string,
          displayName: item.displayName as string,
          submittedAt: item.submittedAt as string,
          slaDueAt: item.slaDueAt as string,
          state: item.state as OperatorQueueState,
          priority: item.priority as OperatorQueuePriority,
          assignee: parseQueueAssignee(item),
          ageMs: item.ageMs as number
        })
      );
    }
    seen.add(item.queueId as string);
    const tallyKey = item.state === "in_review" ? "inReview" : (item.state as string);
    tallied[tallyKey] = (tallied[tallyKey] ?? 0) + 1;
  }
  const summary = queue.summary;
  const byStateKeys = kind === "tickets" ? queueTicketByStateKeys : queueByStateKeys;
  if (
    !isRecord(summary)
    || !hasExactKeys(summary, queueSummaryKeys)
    || summary.count !== items.length
    || !isRecord(summary.byState)
    || !hasExactKeys(summary.byState, byStateKeys)
    || !Object.entries(summary.byState).every(([key, count]) => count === (tallied[key] ?? 0))
  ) {
    return undefined;
  }
  const byState = Object.freeze({ ...summary.byState });
  const parsedSummary = Object.freeze({ count: summary.count as number, byState });
  if (kind === "aml") {
    return Object.freeze({
      mode: "test",
      queue: Object.freeze({
        kind: "aml",
        items: Object.freeze(items as OperatorAmlQueueItem[]),
        summary: parsedSummary as { count: number; byState: { pending: number; inReview: number; escalated: number } },
        posting: "none"
      })
    });
  }
  if (kind === "tickets") {
    return Object.freeze({
      mode: "test",
      queue: Object.freeze({
        kind: "tickets",
        items: Object.freeze(items as OperatorTicketQueueItem[]),
        summary: parsedSummary as { count: number; byState: { open: number; waiting: number; escalated: number } },
        posting: "none"
      })
    });
  }
  return Object.freeze({
    mode: "test",
    queue: Object.freeze({
      kind: "kyc",
      items: Object.freeze(items as OperatorQueueItem[]),
      summary: parsedSummary as { count: number; byState: { pending: number; inReview: number; escalated: number } },
      posting: "none"
    })
  });
}

/**
 * The queue item member read: the view keys and kind echo plus the queue
 * row's own axes with the kind's detail key list in place of the collection
 * row keys — the nullable kyc dossier block for `kyc` (validated standalone
 * like the upstream dossier recipe), the bounded unique `flg_*` flag list
 * for `aml`, and the ticket subject/last-message/open-tally for `tickets`.
 * The requested kind and item id are the cross-check: a view answering a
 * different kind or a different queue_id is drift, not a not-found.
 */
export function parseOperatorQueueItemDetailView(
  value: unknown,
  kind: OperatorQueueKind,
  itemId: string
): OperatorQueueItemDetailView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, queueItemDetailViewKeys)) {
    return undefined;
  }
  if (value.mode !== "test" || value.kind !== kind) {
    return undefined;
  }
  const item = value.item;
  if (!isRecord(item) || item.queueId !== itemId) {
    return undefined;
  }
  const seen = new Set<string>();
  if (kind === "aml") {
    if (
      !validQueueItemCore(item, amlQueueItemDetailKeys, amlQueueIdPattern, queueStates, seen)
      || typeof item.alertType !== "string"
      || !amlAlertTypes.has(item.alertType)
      || !Array.isArray(item.evidenceRefs)
      || item.evidenceRefs.length < 1
      || item.evidenceRefs.length > evidenceRefsMaxItems
      || new Set(item.evidenceRefs).size !== item.evidenceRefs.length
      || !item.evidenceRefs.every((ref) => typeof ref === "string" && evidenceRefPattern.test(ref))
      || !isIsoTimestamp(item.slaDueAt)
      || !Array.isArray(item.flags)
      || item.flags.length > queueItemFlagsMaxItems
      || !item.flags.every(
        (flag) =>
          isRecord(flag)
          && hasExactKeys(flag, queueItemFlagKeys)
          && typeof flag.flagId === "string"
          && flagIdPattern.test(flag.flagId)
          && typeof flag.alertType === "string"
          && amlAlertTypes.has(flag.alertType)
          && isIsoTimestamp(flag.raisedAt)
      )
      || new Set((item.flags as { flagId: string }[]).map((flag) => flag.flagId)).size !== item.flags.length
    ) {
      return undefined;
    }
    return Object.freeze({
      mode: "test",
      kind: "aml",
      item: Object.freeze({
        queueId: item.queueId as string,
        subjectId: item.subjectId as string,
        alertType: item.alertType as OperatorAmlAlertType,
        evidenceRefs: Object.freeze([...(item.evidenceRefs as string[])]),
        slaDueAt: item.slaDueAt as string,
        state: item.state as OperatorQueueState,
        priority: item.priority as OperatorQueuePriority,
        assignee: parseQueueAssignee(item),
        ageMs: item.ageMs as number,
        flags: Object.freeze(
          (item.flags as { flagId: string; alertType: OperatorAmlAlertType; raisedAt: string }[]).map((flag) =>
            Object.freeze({ flagId: flag.flagId, alertType: flag.alertType, raisedAt: flag.raisedAt })
          )
        )
      })
    });
  }
  if (kind === "tickets") {
    if (
      !validQueueItemCore(item, ticketQueueItemDetailKeys, ticketQueueIdPattern, queueTicketStates, seen)
      || typeof item.category !== "string"
      || !ticketCategories.has(item.category)
      || !isIsoTimestamp(item.openedAt)
      || typeof item.subject !== "string"
      || item.subject.length === 0
      || item.subject.length > ticketSubjectMaxLength
      || !isIsoTimestamp(item.lastMessageAt)
      || !isNonNegativeInt(item.otherOpenTickets)
      || item.otherOpenTickets > queueMaxItems
    ) {
      return undefined;
    }
    return Object.freeze({
      mode: "test",
      kind: "tickets",
      item: Object.freeze({
        queueId: item.queueId as string,
        subjectId: item.subjectId as string,
        category: item.category as OperatorTicketCategory,
        openedAt: item.openedAt as string,
        state: item.state as OperatorTicketQueueState,
        priority: item.priority as OperatorQueuePriority,
        assignee: parseQueueAssignee(item),
        ageMs: item.ageMs as number,
        subject: item.subject as string,
        lastMessageAt: item.lastMessageAt as string,
        otherOpenTickets: item.otherOpenTickets as number
      })
    });
  }
  if (
    !validQueueItemCore(item, kycQueueItemDetailKeys, queueIdPattern, queueStates, seen)
    || typeof item.displayName !== "string"
    || !displayNamePattern.test(item.displayName)
    || !isIsoTimestamp(item.submittedAt)
    || !isIsoTimestamp(item.slaDueAt)
    || Date.parse(item.slaDueAt as string) <= Date.parse(item.submittedAt as string)
  ) {
    return undefined;
  }
  // The nullable kyc dossier degrades like the sibling reads: a malformed
  // block drops to the no-dossier state instead of failing the whole detail.
  const kyc = item.kyc === null ? null : parseSubjectKyc(item.kyc) ?? null;
  return Object.freeze({
    mode: "test",
    kind: "kyc",
    item: Object.freeze({
      queueId: item.queueId as string,
      subjectId: item.subjectId as string,
      displayName: item.displayName as string,
      submittedAt: item.submittedAt as string,
      slaDueAt: item.slaDueAt as string,
      state: item.state as OperatorQueueState,
      priority: item.priority as OperatorQueuePriority,
      assignee: parseQueueAssignee(item),
      ageMs: item.ageMs as number,
      kyc
    })
  });
}

const auditViewKeys = ["audit", "mode"] as const;
const auditFeedKeys = ["asOf", "entries", "nextCursor"] as const;
const auditEntryKeys = [
  "action",
  "actorRole",
  "actorSubjectId",
  "at",
  "auditId",
  "detailHash",
  "targetId",
  "targetKind"
] as const;
const auditIdPattern = /^au_[0-9a-f]{24}$/;
const auditCursorPattern = /^auc_[0-9a-f]{16}$/;
const auditDetailHashPattern = /^adh_[0-9a-f]{32}$/;
const auditTargetIdPattern = /^(osn|qky|qml|qtick|flg)_[0-9a-f]{24}$|^syn_cust_[a-z0-9]{8,32}$/;
const operatorRoleSet: ReadonlySet<string> = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "fraud-investigator",
  "auditor"
]);
const auditActions: ReadonlySet<string> = new Set([
  "session.opened",
  "session.rotated",
  "queue.viewed",
  "subject.viewed",
  "flag.reviewed"
]);
const auditTargetKinds: ReadonlySet<string> = new Set(["session", "queue_item", "subject", "flag"]);
const auditMaxEntries = 32;

/**
 * Fail-closed parser for the operator audit feed: exact key sets, the
 * `au_*`/`auc_*`/`adh_*` ref grammar, the fixed action and target-kind
 * vocabularies, ISO timestamps, a 32-entry page bound and unique audit ids.
 * Any drift fails closed to undefined so the screen degrades to its local
 * demo rows instead of rendering unverifiable data.
 */
export function parseOperatorAuditView(value: unknown): OperatorAuditView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, auditViewKeys) || value.mode !== "test") {
    return undefined;
  }
  const audit = value.audit;
  if (!isRecord(audit) || !hasExactKeys(audit, auditFeedKeys) || !isIsoTimestamp(audit.asOf)) {
    return undefined;
  }
  if (audit.nextCursor !== null && (typeof audit.nextCursor !== "string" || !auditCursorPattern.test(audit.nextCursor))) {
    return undefined;
  }
  if (!Array.isArray(audit.entries) || audit.entries.length < 1 || audit.entries.length > auditMaxEntries) {
    return undefined;
  }
  const seen = new Set<string>();
  const entries: OperatorAuditEntry[] = [];
  for (const entry of audit.entries) {
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, auditEntryKeys)
      || typeof entry.auditId !== "string"
      || !auditIdPattern.test(entry.auditId)
      || seen.has(entry.auditId)
      || typeof entry.actorSubjectId !== "string"
      || !operatorSubjectPattern.test(entry.actorSubjectId)
      || typeof entry.actorRole !== "string"
      || !operatorRoleSet.has(entry.actorRole as OperatorRole)
      || typeof entry.action !== "string"
      || !auditActions.has(entry.action)
      || typeof entry.targetKind !== "string"
      || !auditTargetKinds.has(entry.targetKind)
      || typeof entry.targetId !== "string"
      || !auditTargetIdPattern.test(entry.targetId)
      || !isIsoTimestamp(entry.at)
      || typeof entry.detailHash !== "string"
      || !auditDetailHashPattern.test(entry.detailHash)
    ) {
      return undefined;
    }
    seen.add(entry.auditId);
    entries.push(
      Object.freeze({
        auditId: entry.auditId,
        actorSubjectId: entry.actorSubjectId,
        actorRole: entry.actorRole,
        action: entry.action as OperatorAuditAction,
        targetKind: entry.targetKind as OperatorAuditTargetKind,
        targetId: entry.targetId,
        at: entry.at,
        detailHash: entry.detailHash
      })
    );
  }
  return Object.freeze({
    mode: "test",
    audit: Object.freeze({
      asOf: audit.asOf as string,
      entries: Object.freeze(entries),
      nextCursor: audit.nextCursor as string | null
    })
  });
}
