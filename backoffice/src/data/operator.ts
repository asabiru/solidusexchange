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
export type OperatorQueueState = "pending" | "in_review" | "escalated";
export type OperatorQueuePriority = "normal" | "high" | "urgent";

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

export interface OperatorQueueSummary {
  count: number;
  byState: { pending: number; inReview: number; escalated: number };
}

export interface OperatorQueueView {
  mode: "test";
  queue: {
    kind: "kyc";
    items: readonly OperatorQueueItem[];
    summary: OperatorQueueSummary;
    posting: "none";
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
  "kycStatus",
  "lastActiveAt",
  "limits",
  "posting",
  "registeredAt",
  "sessions",
  "subjectId"
] as const;
const subjectLimitKeys = ["maxDevices", "maxSessions"] as const;
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
const queueAssigneeKeys = ["subject"] as const;

const customerSubjectPattern = /^syn_cust_[a-z0-9]{8,32}$/;
const operatorSubjectPattern = /^syn_oper_[a-z0-9]{8,32}$/;
const displayNamePattern = /^[A-Z][a-z]{1,31} [A-Z][a-z]{1,31}$/;
const isoTimestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const contactHashPattern = /^cth_[0-9a-f]{32}$/;
const deviceRefPattern = /^dev_[0-9a-f]{16}$/;
const queueIdPattern = /^qky_[0-9a-f]{24}$/;

const kycStatuses: ReadonlySet<string> = new Set(["unverified", "pending", "verified"]);
const accountStatuses: ReadonlySet<string> = new Set(["active", "closed", "dormant", "restricted"]);
const queueStates: ReadonlySet<string> = new Set(["pending", "in_review", "escalated"]);
const queuePriorities: ReadonlySet<string> = new Set(["normal", "high", "urgent"]);

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
 * The operator subject detail: the list row's axes plus the detail
 * extension — the account_status enum, the redacted `cth_*` contact digest,
 * a bounded integer session count, unique bounded `dev_*` device refs and a
 * limits echo the counts always fit inside.
 */
export function parseOperatorSubjectView(value: unknown): OperatorSubjectView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, subjectDetailViewKeys)) {
    return undefined;
  }
  const item = value.subject;
  if (
    value.mode !== "test"
    || !isRecord(item)
    || !hasExactKeys(item, subjectDetailKeys)
    || typeof item.subjectId !== "string"
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
      })
    })
  });
}

/**
 * The operator KYC work queue: `qky_*`/`syn_cust_*`/`syn_oper_*` refs, enum
 * membership, coherent ISO timestamps (submitted never after the SLA
 * deadline), a non-negative integer age and a summary that tallies the item
 * set exactly.
 */
export function parseOperatorQueueView(value: unknown): OperatorQueueView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, queueViewKeys) || value.mode !== "test") {
    return undefined;
  }
  const queue = value.queue;
  if (!isRecord(queue) || !hasExactKeys(queue, queueKeys) || queue.kind !== "kyc" || queue.posting !== "none") {
    return undefined;
  }
  if (!Array.isArray(queue.items) || queue.items.length > queueMaxItems) {
    return undefined;
  }
  const items: OperatorQueueItem[] = [];
  const seen = new Set<string>();
  const tallied = { pending: 0, inReview: 0, escalated: 0 };
  for (const item of queue.items) {
    if (
      !isRecord(item)
      || !hasExactKeys(item, queueItemKeys)
      || typeof item.queueId !== "string"
      || !queueIdPattern.test(item.queueId)
      || seen.has(item.queueId)
      || typeof item.subjectId !== "string"
      || !customerSubjectPattern.test(item.subjectId)
      || typeof item.displayName !== "string"
      || !displayNamePattern.test(item.displayName)
      || !isIsoTimestamp(item.submittedAt)
      || !isIsoTimestamp(item.slaDueAt)
      || Date.parse(item.slaDueAt) <= Date.parse(item.submittedAt)
      || typeof item.state !== "string"
      || !queueStates.has(item.state)
      || typeof item.priority !== "string"
      || !queuePriorities.has(item.priority)
      || !isNonNegativeInt(item.ageMs)
    ) {
      return undefined;
    }
    if (item.assignee !== null) {
      if (
        !isRecord(item.assignee)
        || !hasExactKeys(item.assignee, queueAssigneeKeys)
        || typeof item.assignee.subject !== "string"
        || !operatorSubjectPattern.test(item.assignee.subject)
      ) {
        return undefined;
      }
    }
    seen.add(item.queueId);
    tallied[item.state === "in_review" ? "inReview" : (item.state as "pending" | "escalated")] += 1;
    items.push(
      Object.freeze({
        queueId: item.queueId,
        subjectId: item.subjectId,
        displayName: item.displayName,
        submittedAt: item.submittedAt,
        slaDueAt: item.slaDueAt,
        state: item.state as OperatorQueueState,
        priority: item.priority as OperatorQueuePriority,
        assignee: item.assignee === null ? null : Object.freeze({ subject: item.assignee.subject as string }),
        ageMs: item.ageMs
      })
    );
  }
  const summary = queue.summary;
  if (
    !isRecord(summary)
    || !hasExactKeys(summary, queueSummaryKeys)
    || summary.count !== items.length
    || !isRecord(summary.byState)
    || !hasExactKeys(summary.byState, queueByStateKeys)
    || summary.byState.pending !== tallied.pending
    || summary.byState.inReview !== tallied.inReview
    || summary.byState.escalated !== tallied.escalated
  ) {
    return undefined;
  }
  return Object.freeze({
    mode: "test",
    queue: Object.freeze({
      kind: "kyc",
      items: Object.freeze(items),
      summary: Object.freeze({
        count: summary.count,
        byState: Object.freeze({
          pending: tallied.pending,
          inReview: tallied.inReview,
          escalated: tallied.escalated
        })
      }),
      posting: "none"
    })
  });
}
