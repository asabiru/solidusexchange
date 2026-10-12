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

export interface OperatorSubjectDetail extends OperatorSubjectRow {
  accountStatus: OperatorAccountStatus;
  contactHash: string;
  sessions: number;
  devices: readonly string[];
  limits: { maxSessions: number; maxDevices: number };
  recentActivity: readonly OperatorActivityItem[];
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
  "kycStatus",
  "lastActiveAt",
  "limits",
  "posting",
  "recentActivity",
  "registeredAt",
  "sessions",
  "subjectId"
] as const;
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

const customerSubjectPattern = /^syn_cust_[a-z0-9]{8,32}$/;
const operatorSubjectPattern = /^syn_oper_[a-z0-9]{8,32}$/;
const displayNamePattern = /^[A-Z][a-z]{1,31} [A-Z][a-z]{1,31}$/;
const isoTimestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const contactHashPattern = /^cth_[0-9a-f]{32}$/;
const deviceRefPattern = /^dev_[0-9a-f]{16}$/;
const queueIdPattern = /^qky_[0-9a-f]{24}$/;
const amlQueueIdPattern = /^qml_[0-9a-f]{24}$/;
const ticketQueueIdPattern = /^qtick_[0-9a-f]{24}$/;
const evidenceRefPattern = /^evd_[0-9a-f]{24}$/;
const evidenceRefsMaxItems = 8;

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

/** The recent_activity page: a bounded newest-first list with unique ids. */
function parseRecentActivity(value: unknown): readonly OperatorActivityItem[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > activityBound) {
    return undefined;
  }
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
  ) {
    return undefined;
  }
  const recentActivity = parseRecentActivity(item.recentActivity);
  if (recentActivity === undefined) {
    return undefined;
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
      recentActivity
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
