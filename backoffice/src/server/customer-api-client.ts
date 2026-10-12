import { createHash } from "node:crypto";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticOperatorToken } from "@solidchange/customer-api/synthetic-token";
import type { OperatorRole } from "../auth/access.js";
import { isDeviceId } from "./device.js";

export const customerApiClientVersion = "solidchange-backoffice-bff/0.1.0";
export const customerApiPlatform = "operator-web";
const tokenTtlSeconds = 300;
export const maxCustomerApiResponseBytes = 16_384;

const operatorIdPattern = /^opr_[0-9a-f]{24}$/;
const operatorSubjectPattern = /^syn_oper_[a-z0-9]{8,32}$/;
const customerSubjectPattern = /^syn_cust_[a-z0-9]{8,32}$/;
const displayNamePattern = /^[A-Z][a-z]{1,31} [A-Z][a-z]{1,31}$/;
const isoTimestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const operatorSubjectsViewKeys = ["mode", "subjects"] as const;
const subjectRowKeys = [
  "display_name",
  "flags",
  "kyc_status",
  "last_active_at",
  "posting",
  "registered_at",
  "subject_id"
] as const;
const subjectDetailViewKeys = ["mode", "subject"] as const;
const subjectDetailKeys = [
  "account_status",
  "contact_hash",
  "devices",
  "display_name",
  "flags",
  "kyc",
  "kyc_status",
  "last_active_at",
  "limits",
  "posting",
  "recent_activity",
  "registered_at",
  "sessions",
  "subject_id"
] as const;
const subjectKycKeys = ["history", "level", "session_id", "status"] as const;
const subjectKycAttemptKeys = [
  "decided_at",
  "rejection_reason",
  "session_id",
  "state",
  "submitted_at"
] as const;
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
const kycSessionPattern = /^kys_[0-9a-f]{24}$/u;
const kycHistoryBound = 4;
const subjectLimitKeys = ["max_devices", "max_sessions"] as const;
const activityItemKeys = ["activity_id", "kind", "occurred_at", "summary", "money"] as const;
const activityMoneyKeys = ["amount", "asset"] as const;
const activityIdPattern = /^(act|opact)_[0-9a-f]{24}$/u;
const activityBound = 8;
const customerActivityStatuses: Readonly<Record<string, ReadonlySet<string>>> = {
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
const subjectAccountStatuses: ReadonlySet<string> = new Set(["active", "closed", "dormant", "restricted"]);
const contactHashPattern = /^cth_[0-9a-f]{32}$/;
const deviceRefPattern = /^dev_[0-9a-f]{16}$/;
const subjectSessionsMax = 16;
const subjectDevicesMax = 8;
const subjectsMaxItems = 64;
const kycStatuses: ReadonlySet<string> = new Set(["unverified", "pending", "verified"]);
const queueViewKeys = ["mode", "queue"] as const;
const queueKeys = ["items", "kind", "posting", "summary"] as const;
const queueItemKeys = [
  "age_ms",
  "assignee",
  "display_name",
  "priority",
  "queue_id",
  "sla_due_at",
  "state",
  "subject_id",
  "submitted_at"
] as const;
const queueSummaryKeys = ["by_state", "count"] as const;
const queueByStateKeys = ["escalated", "in_review", "pending"] as const;
const queueTicketByStateKeys = ["escalated", "open", "waiting"] as const;
const queueAssigneeKeys = ["subject"] as const;
const amlQueueItemKeys = [
  "age_ms",
  "alert_type",
  "assignee",
  "evidence_refs",
  "priority",
  "queue_id",
  "sla_due_at",
  "state",
  "subject_id"
] as const;
const ticketQueueItemKeys = [
  "age_ms",
  "assignee",
  "category",
  "opened_at",
  "priority",
  "queue_id",
  "state",
  "subject_id"
] as const;
const queueIdPattern = /^qky_[0-9a-f]{24}$/;
const amlQueueIdPattern = /^qml_[0-9a-f]{24}$/;
const ticketQueueIdPattern = /^qtick_[0-9a-f]{24}$/;
const queueItemIdPatterns: Readonly<Record<CustomerApiQueueKind, RegExp>> = {
  kyc: queueIdPattern,
  aml: amlQueueIdPattern,
  tickets: ticketQueueIdPattern
};
const evidenceRefPattern = /^evd_[0-9a-f]{24}$/;
const evidenceRefsMaxItems = 8;
const queueMaxItems = 64;
const queueItemDetailViewKeys = ["item", "kind", "mode"] as const;
const kycQueueItemDetailKeys = [...queueItemKeys, "kyc"] as const;
const amlQueueItemDetailKeys = [...amlQueueItemKeys, "flags"] as const;
const ticketQueueItemDetailKeys = [
  ...ticketQueueItemKeys,
  "last_message_at",
  "other_open_tickets",
  "subject"
] as const;
const queueItemFlagKeys = ["alert_type", "flag_id", "raised_at"] as const;
const flagIdPattern = /^flg_[0-9a-f]{24}$/;
const queueItemFlagsMaxItems = 8;
const ticketSubjectMaxLength = 160;
const queueKinds: ReadonlySet<string> = new Set(["kyc", "aml", "tickets"]);
const queueStates: ReadonlySet<string> = new Set(["pending", "in_review", "escalated"]);
const queueTicketStates: ReadonlySet<string> = new Set(["open", "waiting", "escalated"]);
const queuePriorities: ReadonlySet<string> = new Set(["normal", "high", "urgent"]);
// The queue's ticket categories echo the customer support ticket universe.
const ticketCategories: ReadonlySet<string> = new Set(["question", "operation_problem", "complaint", "data_request"]);
const operatorAdminViewKeys = [
  "created_at",
  "granted_capabilities",
  "mode",
  "operator_id",
  "role",
  "subject",
  "updated_at"
] as const;
const grantedCapabilitiesMaxItems = 32;
const grantedCapabilityMaxLength = 128;
// Mirror of upstream OPERATOR_CAPABILITY_POLICY capability ids: the echo
// only ever reports real operator capabilities, so a view claiming a
// capability outside the declared vocabulary fails closed.
const operatorCapabilityVocabulary: ReadonlySet<string> = new Set([
  "operator.session.read",
  "operator.capabilities.read",
  "operator.admin.read",
  "operator.subjects.read",
  "operator.queue.read"
]);
const operatorRoles: ReadonlySet<string> = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "fraud-investigator",
  "auditor"
]);

export interface CustomerApiClientOptions {
  baseUrl?: string;
  devTokenKey?: string;
  timeoutMs?: number;
}

/** Wire view of GET /api/v1/operator/admin — snake_case contract fields. */
export interface CustomerApiOperatorAdminView {
  mode: "test";
  operator_id: string;
  subject: string;
  role: OperatorRole;
  granted_capabilities: readonly string[];
  created_at: string;
  updated_at: string;
}

export type CustomerApiOperatorAdmin =
  | { status: "ok"; view: CustomerApiOperatorAdminView }
  | { status: "unavailable" }
  | { status: "not-configured" };

/** One row of GET /api/v1/operator/subjects — snake_case contract fields. */
export interface CustomerApiSubjectRow {
  subject_id: string;
  display_name: string;
  kyc_status: string;
  flags: number;
  registered_at: string;
  last_active_at: string;
  posting: string;
}

/** Wire view of GET /api/v1/operator/subjects — snake_case contract fields. */
export interface CustomerApiOperatorSubjectsView {
  mode: "test";
  subjects: readonly CustomerApiSubjectRow[];
}

export type CustomerApiOperatorSubjects =
  | { status: "ok"; view: CustomerApiOperatorSubjectsView }
  | { status: "unavailable" }
  | { status: "not-configured" };

/** Bounded limits echo inside GET /api/v1/operator/subjects/{subjectId}. */
export interface CustomerApiSubjectLimits {
  max_sessions: number;
  max_devices: number;
}

/** One recent_activity item of the operator subject detail — snake_case contract fields. */
export interface CustomerApiSubjectActivityItem {
  activity_id: string;
  kind: string;
  occurred_at: string;
  summary: string;
  money: { amount: string; asset: string } | null;
}

/** One KYC attempt inside the operator subject dossier history — snake_case contract fields. */
export interface CustomerApiSubjectKycAttempt {
  session_id: string;
  state: string;
  submitted_at: string;
  decided_at: string | null;
  rejection_reason: string | null;
}

/** The subject's KYC dossier — current application state, level and session handle plus the attempt history. */
export interface CustomerApiSubjectKyc {
  status: string;
  level: string;
  session_id: string;
  history: readonly CustomerApiSubjectKycAttempt[];
}

/** One subject row of the operator detail read — the list fields plus the id-bound detail extension. */
export interface CustomerApiSubjectDetail extends CustomerApiSubjectRow {
  account_status: string;
  contact_hash: string;
  sessions: number;
  devices: readonly string[];
  limits: CustomerApiSubjectLimits;
  recent_activity: readonly CustomerApiSubjectActivityItem[];
  kyc: CustomerApiSubjectKyc | null;
}

/** Wire view of GET /api/v1/operator/subjects/{subjectId} — snake_case contract fields. */
export interface CustomerApiOperatorSubjectView {
  mode: "test";
  subject: CustomerApiSubjectDetail;
}

export type CustomerApiOperatorSubject =
  | { status: "ok"; view: CustomerApiOperatorSubjectView }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "not-configured" };

/** The queue kinds the upstream operator queue projects. */
export type CustomerApiQueueKind = "kyc" | "aml" | "tickets";

/** One item of GET /api/v1/operator/queue?kind=kyc — snake_case contract fields. */
export interface CustomerApiQueueItem {
  queue_id: string;
  subject_id: string;
  display_name: string;
  submitted_at: string;
  sla_due_at: string;
  state: string;
  priority: string;
  assignee: { subject: string } | null;
  age_ms: number;
}

/** One item of GET /api/v1/operator/queue?kind=aml — snake_case contract fields. */
export interface CustomerApiAmlQueueItem {
  queue_id: string;
  subject_id: string;
  alert_type: string;
  evidence_refs: readonly string[];
  sla_due_at: string;
  state: string;
  priority: string;
  assignee: { subject: string } | null;
  age_ms: number;
}

/** One item of GET /api/v1/operator/queue?kind=tickets — snake_case contract fields. */
export interface CustomerApiTicketQueueItem {
  queue_id: string;
  subject_id: string;
  category: string;
  opened_at: string;
  state: string;
  priority: string;
  assignee: { subject: string } | null;
  age_ms: number;
}

interface CustomerApiQueueSummary<ByState> {
  count: number;
  by_state: ByState;
}

/** Wire view of GET /api/v1/operator/queue — snake_case contract fields, discriminated by kind. */
export type CustomerApiOperatorQueueView =
  | {
      mode: "test";
      queue: {
        kind: "kyc";
        items: readonly CustomerApiQueueItem[];
        summary: CustomerApiQueueSummary<{ pending: number; in_review: number; escalated: number }>;
        posting: "none";
      };
    }
  | {
      mode: "test";
      queue: {
        kind: "aml";
        items: readonly CustomerApiAmlQueueItem[];
        summary: CustomerApiQueueSummary<{ pending: number; in_review: number; escalated: number }>;
        posting: "none";
      };
    }
  | {
      mode: "test";
      queue: {
        kind: "tickets";
        items: readonly CustomerApiTicketQueueItem[];
        summary: CustomerApiQueueSummary<{ open: number; waiting: number; escalated: number }>;
        posting: "none";
      };
    };

export type CustomerApiOperatorQueue =
  | { status: "ok"; view: CustomerApiOperatorQueueView }
  | { status: "unavailable" }
  | { status: "not-configured" };

/** One flag record embedded in the aml queue item detail — snake_case contract fields. */
export interface CustomerApiQueueItemFlag {
  flag_id: string;
  alert_type: string;
  raised_at: string;
}

/** Detail of GET /api/v1/operator/queue/kyc/{itemId} — the queue row plus the kyc dossier block. */
export interface CustomerApiKycQueueItemDetail extends CustomerApiQueueItem {
  kyc: CustomerApiSubjectKyc | null;
}

/** Detail of GET /api/v1/operator/queue/aml/{itemId} — the queue row plus the subject's open flags. */
export interface CustomerApiAmlQueueItemDetail extends CustomerApiAmlQueueItem {
  flags: readonly CustomerApiQueueItemFlag[];
}

/** Detail of GET /api/v1/operator/queue/tickets/{itemId} — the queue row plus the ticket extension. */
export interface CustomerApiTicketQueueItemDetail extends CustomerApiTicketQueueItem {
  subject: string;
  last_message_at: string;
  other_open_tickets: number;
}

/** Wire view of GET /api/v1/operator/queue/{kind}/{itemId} — discriminated by kind like the collection. */
export type CustomerApiOperatorQueueItemDetailView =
  | { mode: "test"; kind: "kyc"; item: CustomerApiKycQueueItemDetail }
  | { mode: "test"; kind: "aml"; item: CustomerApiAmlQueueItemDetail }
  | { mode: "test"; kind: "tickets"; item: CustomerApiTicketQueueItemDetail };

export type CustomerApiOperatorQueueItem =
  | { status: "ok"; view: CustomerApiOperatorQueueItemDetailView }
  | { status: "not-found" }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiClient {
  readonly configured: boolean;
  operatorAdmin(bffSubject: string, deviceId: string, nowMs: number): Promise<CustomerApiOperatorAdmin>;
  operatorSubjects(bffSubject: string, deviceId: string, nowMs: number): Promise<CustomerApiOperatorSubjects>;
  operatorSubject(bffSubject: string, deviceId: string, subjectId: string, nowMs: number): Promise<CustomerApiOperatorSubject>;
  operatorQueue(bffSubject: string, deviceId: string, kind: CustomerApiQueueKind, nowMs: number): Promise<CustomerApiOperatorQueue>;
  operatorQueueItem(
    bffSubject: string,
    deviceId: string,
    kind: CustomerApiQueueKind,
    itemId: string,
    nowMs: number
  ): Promise<CustomerApiOperatorQueueItem>;
}

/** Maps a BFF pseudonymous operator subject onto the customer-api operator subject space. */
export function customerApiSubject(bffSubject: string): string {
  return `syn_oper_${createHash("sha256").update(`solidchange-backoffice-bff|${bffSubject}`).digest("hex").slice(0, 24)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && value.split(";")[0].trim().toLowerCase() === "application/json";
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (!isJsonContentType(response.headers.get("content-type"))
    || (declared !== null && !(/^\d{1,9}$/.test(declared) && Number(declared) <= maxCustomerApiResponseBytes))
    || !response.body) {
    await response.body?.cancel();
    throw new Error("customer-api response rejected");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxCustomerApiResponseBytes) throw new Error("customer-api response too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
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

function validGrantedCapabilities(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value)
    && value.length <= grantedCapabilitiesMaxItems
    && new Set(value).size === value.length
    && value.every(
      (item) =>
        typeof item === "string"
        && item.length >= 1
        && item.length <= grantedCapabilityMaxLength
        && operatorCapabilityVocabulary.has(item)
    )
  );
}

/**
 * Fail-closed parser for the operator admin contract view: exact key set,
 * `opr_*`/`syn_oper_*` patterns, the staff role enum, the granted capability
 * echo and coherent ISO timestamps — the same axes the upstream
 * `validOperatorAdminView` validator pins.
 */
function parseOperatorAdminView(value: unknown, expectedSubject: string): CustomerApiOperatorAdminView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, operatorAdminViewKeys)) {
    return undefined;
  }
  if (
    value.mode !== "test"
    || typeof value.operator_id !== "string"
    || !operatorIdPattern.test(value.operator_id)
    || value.subject !== expectedSubject
    || !operatorSubjectPattern.test(value.subject)
    || typeof value.role !== "string"
    || !operatorRoles.has(value.role)
    || !validGrantedCapabilities(value.granted_capabilities)
    || !isIsoTimestamp(value.created_at)
    || !isIsoTimestamp(value.updated_at)
    // Record coherence mirrors the synthetic build: an operator record cannot
    // be updated before it was created.
    || Date.parse(value.updated_at) < Date.parse(value.created_at)
  ) {
    return undefined;
  }
  return Object.freeze({
    mode: "test",
    operator_id: value.operator_id,
    subject: value.subject,
    role: value.role as OperatorRole,
    granted_capabilities: Object.freeze([...(value.granted_capabilities as readonly string[])]),
    created_at: value.created_at,
    updated_at: value.updated_at
  });
}

/**
 * Fail-closed parser for the operator subjects contract view: exact key set,
 * `syn_cust_*` subject refs, transliterated display names, the customer
 * lifecycle kyc_status enum, non-negative integer flag counts, coherent ISO
 * timestamps and the pinned `posting: "none"` sentinel — the same axes the
 * upstream `validOperatorSubjectsView` validator pins.
 */
function parseOperatorSubjectsView(value: unknown): CustomerApiOperatorSubjectsView | undefined {
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
  const rows: CustomerApiSubjectRow[] = [];
  for (const item of value.subjects) {
    if (
      !isRecord(item)
      || !hasExactKeys(item, subjectRowKeys)
      || typeof item.subject_id !== "string"
      || !customerSubjectPattern.test(item.subject_id)
      || seen.has(item.subject_id)
      || typeof item.display_name !== "string"
      || !displayNamePattern.test(item.display_name)
      || typeof item.kyc_status !== "string"
      || !kycStatuses.has(item.kyc_status)
      || typeof item.flags !== "number"
      || !Number.isInteger(item.flags)
      || item.flags < 0
      || !isIsoTimestamp(item.registered_at)
      || !isIsoTimestamp(item.last_active_at)
      || Date.parse(item.last_active_at) < Date.parse(item.registered_at)
      || item.posting !== "none"
    ) {
      return undefined;
    }
    seen.add(item.subject_id);
    rows.push(
      Object.freeze({
        subject_id: item.subject_id,
        display_name: item.display_name,
        kyc_status: item.kyc_status,
        flags: item.flags,
        registered_at: item.registered_at,
        last_active_at: item.last_active_at,
        posting: "none"
      })
    );
  }
  return Object.freeze({ mode: "test", subjects: Object.freeze(rows) });
}

/**
 * Fail-closed parser for one recent_activity item: exact key set, the
 * `act_*`/`opact_*` ref grammar, kind and summary vocabularies (the
 * customer per-kind status sets plus the operator-side event values),
 * the prefix↔kind and money↔kind coherence rules and a positive scaled
 * decimal amount — the same axes the upstream activity-item check pins.
 */
function parseSubjectActivityItem(item: unknown): CustomerApiSubjectActivityItem | undefined {
  if (!isRecord(item) || !hasExactKeys(item, activityItemKeys)) {
    return undefined;
  }
  if (
    typeof item.activity_id !== "string"
    || !activityIdPattern.test(item.activity_id)
    || typeof item.kind !== "string"
    || !(customerActivityKinds.has(item.kind) || operatorOnlyActivityKinds.has(item.kind))
    || typeof item.summary !== "string"
    || !activitySummaries.has(item.summary)
    || !isIsoTimestamp(item.occurred_at)
  ) {
    return undefined;
  }
  const operatorKind = operatorOnlyActivityKinds.has(item.kind);
  if (operatorKind !== item.activity_id.startsWith("opact_")) {
    return undefined;
  }
  if (operatorKind) {
    if (item.kind === "kyc_transition" && !kycTransitionSummaries.has(item.summary)) {
      return undefined;
    }
    if (item.kind === "flag_added" && !amlAlertTypes.has(item.summary)) {
      return undefined;
    }
  } else if (!(customerActivityStatuses[item.kind] ?? new Set()).has(item.summary)) {
    return undefined;
  }
  if (item.money === null) {
    if (activityMoneyKinds.has(item.kind)) {
      return undefined;
    }
    return Object.freeze({
      activity_id: item.activity_id,
      kind: item.kind,
      occurred_at: item.occurred_at,
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
    activity_id: item.activity_id,
    kind: item.kind,
    occurred_at: item.occurred_at,
    summary: item.summary,
    money: Object.freeze({ amount: item.money.amount, asset: item.money.asset })
  });
}

/**
 * The recent_activity page: a bounded newest-first list with unique ids;
 * same-instant items order by id, mirroring the upstream sort. Every
 * instant sits inside the account window: nothing precedes registration,
 * and the subject-side items — the subject's own `act_*` feed rows and
 * the kyc submission transition — never postdate last_active_at (a flag
 * raise or a kyc decision is operator-side work and legitimately can).
 */
function parseSubjectRecentActivity(
  value: unknown,
  registeredAt: string,
  lastActiveAt: string
): readonly CustomerApiSubjectActivityItem[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > activityBound) {
    return undefined;
  }
  const registeredMs = Date.parse(registeredAt);
  const lastActiveMs = Date.parse(lastActiveAt);
  const seen = new Set<string>();
  const items: CustomerApiSubjectActivityItem[] = [];
  let previousMs = Number.POSITIVE_INFINITY;
  let previousId = "";
  for (const raw of value) {
    const item = parseSubjectActivityItem(raw);
    if (item === undefined || seen.has(item.activity_id)) {
      return undefined;
    }
    const occurredMs = Date.parse(item.occurred_at);
    if (occurredMs < registeredMs) {
      return undefined;
    }
    const operatorSide = item.activity_id.startsWith("opact_")
      && !(item.kind === "kyc_transition" && item.summary === "submitted");
    if (!operatorSide && occurredMs > lastActiveMs) {
      return undefined;
    }
    if (
      occurredMs > previousMs
      || (occurredMs === previousMs && item.activity_id.localeCompare(previousId) <= 0)
    ) {
      return undefined;
    }
    seen.add(item.activity_id);
    previousMs = occurredMs;
    previousId = item.activity_id;
    items.push(item);
  }
  return Object.freeze(items);
}

/**
 * Fail-closed parser for the nullable kyc dossier block: exact key sets,
 * status/level/reason vocabularies, the `kys_*` session grammar, the
 * review-window and resubmittable-ending rules, unique session ids,
 * newest-first ordering and the header echoing the newest attempt — the
 * same axes the upstream `validOperatorSubjectKyc` validator pins.
 */
function parseSubjectKyc(value: unknown): CustomerApiSubjectKyc | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, subjectKycKeys)
    || typeof value.status !== "string"
    || !subjectKycStatuses.has(value.status)
    || typeof value.level !== "string"
    || !subjectKycLevels.has(value.level)
    || typeof value.session_id !== "string"
    || !kycSessionPattern.test(value.session_id)
    || !Array.isArray(value.history)
    || value.history.length < 1
    || value.history.length > kycHistoryBound
  ) {
    return undefined;
  }
  const sessionIds = new Set<string>();
  const history: CustomerApiSubjectKycAttempt[] = [];
  let previousSubmittedAt = "";
  for (const [index, raw] of value.history.entries()) {
    if (!isRecord(raw) || !hasExactKeys(raw, subjectKycAttemptKeys)) {
      return undefined;
    }
    if (
      typeof raw.session_id !== "string"
      || !kycSessionPattern.test(raw.session_id)
      || sessionIds.has(raw.session_id)
      || typeof raw.state !== "string"
      || !subjectKycStatuses.has(raw.state)
      || !isIsoTimestamp(raw.submitted_at)
    ) {
      return undefined;
    }
    sessionIds.add(raw.session_id);
    const inReview = subjectKycPendingStatuses.has(raw.state);
    if (raw.decided_at === null) {
      // Only attempts still inside the review window lack a decision.
      if (!inReview) {
        return undefined;
      }
    } else if (
      typeof raw.decided_at !== "string"
      || !isIsoTimestamp(raw.decided_at)
      || inReview
      || Date.parse(raw.decided_at) < Date.parse(raw.submitted_at)
    ) {
      return undefined;
    }
    // A rejection_reason is only ever carried by a rejected attempt.
    if (
      raw.rejection_reason !== null
      && (raw.state !== "rejected" || typeof raw.rejection_reason !== "string" || !subjectKycReasonCodes.has(raw.rejection_reason))
    ) {
      return undefined;
    }
    // A resubmission only follows a resubmittable ending decided no
    // later than the next attempt's submission; the page is newest
    // first and equal instants keep mint order.
    if (
      index > 0
      && (!subjectKycEndings.has(raw.state)
        || raw.decided_at === null
        || raw.decided_at > value.history[index - 1].submitted_at
        || raw.submitted_at > previousSubmittedAt)
    ) {
      return undefined;
    }
    previousSubmittedAt = raw.submitted_at;
    history.push(Object.freeze({
      session_id: raw.session_id,
      state: raw.state,
      submitted_at: raw.submitted_at,
      decided_at: raw.decided_at,
      rejection_reason: raw.rejection_reason
    }));
  }
  // The header echoes the newest attempt.
  if (value.session_id !== history[0].session_id || value.status !== history[0].state) {
    return undefined;
  }
  return Object.freeze({
    status: value.status,
    level: value.level,
    session_id: value.session_id,
    history: Object.freeze(history)
  });
}

/**
 * Fail-closed parser for the operator subject detail contract view: the list
 * row's axes (exact key sets, `syn_cust_*` ref, kyc_status enum, non-negative
 * integer flags, coherent ISO timestamps, pinned `posting: "none"`) plus the
 * detail extension — the account_status enum, the redacted `cth_*` contact
 * digest, bounded integer session count, unique bounded `dev_*` device refs
 * and a limits echo the counts always fit inside — the same axes the
 * upstream `validOperatorSubjectDetailView` validator pins. The detail
 * answers exactly the requested member: a view carrying another subject's
 * record is drift, never a fallback.
 */
function parseOperatorSubjectDetailView(
  value: unknown,
  expectedSubject: string
): CustomerApiOperatorSubjectView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, subjectDetailViewKeys)) {
    return undefined;
  }
  const item = value.subject;
  if (
    value.mode !== "test"
    || !isRecord(item)
    || !hasExactKeys(item, subjectDetailKeys)
    || typeof item.subject_id !== "string"
    || item.subject_id !== expectedSubject
    || !customerSubjectPattern.test(item.subject_id)
    || typeof item.display_name !== "string"
    || !displayNamePattern.test(item.display_name)
    || typeof item.kyc_status !== "string"
    || !kycStatuses.has(item.kyc_status)
    || typeof item.flags !== "number"
    || !Number.isInteger(item.flags)
    || item.flags < 0
    || !isIsoTimestamp(item.registered_at)
    || !isIsoTimestamp(item.last_active_at)
    || Date.parse(item.last_active_at) < Date.parse(item.registered_at)
    || item.posting !== "none"
    || typeof item.account_status !== "string"
    || !subjectAccountStatuses.has(item.account_status)
    || typeof item.contact_hash !== "string"
    || !contactHashPattern.test(item.contact_hash)
    || typeof item.sessions !== "number"
    || !Number.isInteger(item.sessions)
    || item.sessions < 0
    || item.sessions > subjectSessionsMax
    || !Array.isArray(item.devices)
    || item.devices.length > subjectDevicesMax
    || new Set(item.devices).size !== item.devices.length
    || !item.devices.every((device) => typeof device === "string" && deviceRefPattern.test(device))
    || !isRecord(item.limits)
    || !hasExactKeys(item.limits, subjectLimitKeys)
    || typeof item.limits.max_sessions !== "number"
    || !Number.isInteger(item.limits.max_sessions)
    || item.limits.max_sessions < 1
    || item.limits.max_sessions > subjectSessionsMax
    || typeof item.limits.max_devices !== "number"
    || !Number.isInteger(item.limits.max_devices)
    || item.limits.max_devices < 1
    || item.limits.max_devices > subjectDevicesMax
    // Coherence mirrors the synthetic build: the live counts can never
    // exceed the limits echo.
    || item.sessions > item.limits.max_sessions
    || item.devices.length > item.limits.max_devices
    // A live session sits on a device in a live account: zero registered
    // devices or a closed account means the session count must be zero.
    || (item.sessions > 0 && (item.devices.length === 0 || item.account_status === "closed"))
  ) {
    return undefined;
  }
  const recentActivity = parseSubjectRecentActivity(item.recent_activity, item.registered_at, item.last_active_at);
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
    (item.kyc_status === "unverified" && transitions.length !== 0)
    || (item.kyc_status === "pending" && transitions.some((activity) => activity.summary !== "submitted"))
    || new Set(transitions.map((activity) => activity.summary)).size !== transitions.length
    || recentActivity.filter((activity) => activity.kind === "flag_added").length > item.flags
  ) {
    return undefined;
  }
  // The nullable kyc dossier stays fail-closed: a present block must
  // parse, and its current state stays coherent with the roster
  // kyc_status — subset discipline like the upstream validator.
  const kyc = item.kyc === null ? null : parseSubjectKyc(item.kyc);
  if (kyc === undefined) {
    return undefined;
  }
  if (
    kyc !== null
    && ((item.kyc_status === "verified" && kyc.status !== "approved")
      || (item.kyc_status === "pending" && !subjectKycPendingStatuses.has(kyc.status))
      || (item.kyc_status === "unverified"
        && (kyc.status === "approved" || subjectKycPendingStatuses.has(kyc.status))))
  ) {
    return undefined;
  }
  // Cross-block coherence: every dossier submission is subject-side work
  // inside the account window, and a surviving transition must project
  // the exact instant the dossier's newest attempt records.
  if (kyc !== null) {
    const registeredMs = Date.parse(item.registered_at);
    const lastActiveMs = Date.parse(item.last_active_at);
    if (kyc.history.some((attempt) => {
      const submittedMs = Date.parse(attempt.submitted_at);
      return submittedMs < registeredMs || submittedMs > lastActiveMs;
    })) {
      return undefined;
    }
    const submitted = transitions.find((activity) => activity.summary === "submitted");
    const approved = transitions.find((activity) => activity.summary === "approved");
    if (
      (submitted !== undefined && submitted.occurred_at !== kyc.history[0].submitted_at)
      || (approved !== undefined && approved.occurred_at !== kyc.history[0].decided_at)
    ) {
      return undefined;
    }
  }
  return Object.freeze({
    mode: "test",
    subject: Object.freeze({
      subject_id: item.subject_id,
      display_name: item.display_name,
      kyc_status: item.kyc_status,
      flags: item.flags,
      registered_at: item.registered_at,
      last_active_at: item.last_active_at,
      posting: "none",
      account_status: item.account_status,
      contact_hash: item.contact_hash,
      sessions: item.sessions,
      devices: Object.freeze([...(item.devices as readonly string[])]),
      limits: Object.freeze({
        max_sessions: item.limits.max_sessions,
        max_devices: item.limits.max_devices
      }),
      recent_activity: recentActivity,
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
    || typeof item.queue_id !== "string"
    || !idPattern.test(item.queue_id)
    || seen.has(item.queue_id)
    || typeof item.subject_id !== "string"
    || !customerSubjectPattern.test(item.subject_id)
    || typeof item.state !== "string"
    || !states.has(item.state)
    || typeof item.priority !== "string"
    || !queuePriorities.has(item.priority)
    || typeof item.age_ms !== "number"
    || !Number.isInteger(item.age_ms)
    || item.age_ms < 0
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
 * Fail-closed parser for the operator queue contract view: the same axes
 * the upstream `validOperatorQueueView` validator pins — exact key sets,
 * `qky_*`/`qml_*`/`qtick_*`/`evd_*`/`syn_cust_*`/`syn_oper_*` refs, enum
 * membership, coherent ISO timestamps (submitted never after the SLA
 * deadline), a non-negative integer age, and a summary that tallies the
 * item set exactly. The declared kind selects the item shape and the state
 * vocabulary; a view that answers a different kind than requested is drift.
 */
function parseOperatorQueueView(value: unknown, kind: CustomerApiQueueKind): CustomerApiOperatorQueueView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, queueViewKeys) || value.mode !== "test") {
    return undefined;
  }
  const queue = value.queue;
  if (!isRecord(queue) || !hasExactKeys(queue, queueKeys) || queue.kind !== kind || queue.posting !== "none") {
    return undefined;
  }
  if (!Array.isArray(queue.items) || queue.items.length > queueMaxItems) {
    return undefined;
  }
  const seen = new Set<string>();
  const tallied: Record<string, number> = {};
  const items: (CustomerApiQueueItem | CustomerApiAmlQueueItem | CustomerApiTicketQueueItem)[] = [];
  for (const item of queue.items) {
    if (!isRecord(item)) {
      return undefined;
    }
    if (kind === "aml") {
      if (
        !validQueueItemCore(item, amlQueueItemKeys, amlQueueIdPattern, queueStates, seen)
        || typeof item.alert_type !== "string"
        || !amlAlertTypes.has(item.alert_type)
        || !Array.isArray(item.evidence_refs)
        || item.evidence_refs.length < 1
        || item.evidence_refs.length > evidenceRefsMaxItems
        || new Set(item.evidence_refs).size !== item.evidence_refs.length
        || !item.evidence_refs.every((ref) => typeof ref === "string" && evidenceRefPattern.test(ref))
        || !isIsoTimestamp(item.sla_due_at)
      ) {
        return undefined;
      }
      items.push(
        Object.freeze({
          queue_id: item.queue_id as string,
          subject_id: item.subject_id as string,
          alert_type: item.alert_type as string,
          evidence_refs: Object.freeze([...(item.evidence_refs as string[])]),
          sla_due_at: item.sla_due_at as string,
          state: item.state as string,
          priority: item.priority as string,
          assignee: parseQueueAssignee(item),
          age_ms: item.age_ms as number
        })
      );
    } else if (kind === "tickets") {
      if (
        !validQueueItemCore(item, ticketQueueItemKeys, ticketQueueIdPattern, queueTicketStates, seen)
        || typeof item.category !== "string"
        || !ticketCategories.has(item.category)
        || !isIsoTimestamp(item.opened_at)
      ) {
        return undefined;
      }
      items.push(
        Object.freeze({
          queue_id: item.queue_id as string,
          subject_id: item.subject_id as string,
          category: item.category as string,
          opened_at: item.opened_at as string,
          state: item.state as string,
          priority: item.priority as string,
          assignee: parseQueueAssignee(item),
          age_ms: item.age_ms as number
        })
      );
    } else {
      if (
        !validQueueItemCore(item, queueItemKeys, queueIdPattern, queueStates, seen)
        || typeof item.display_name !== "string"
        || !displayNamePattern.test(item.display_name)
        || !isIsoTimestamp(item.submitted_at)
        || !isIsoTimestamp(item.sla_due_at)
        || Date.parse(item.sla_due_at as string) <= Date.parse(item.submitted_at as string)
      ) {
        return undefined;
      }
      items.push(
        Object.freeze({
          queue_id: item.queue_id as string,
          subject_id: item.subject_id as string,
          display_name: item.display_name as string,
          submitted_at: item.submitted_at as string,
          sla_due_at: item.sla_due_at as string,
          state: item.state as string,
          priority: item.priority as string,
          assignee: parseQueueAssignee(item),
          age_ms: item.age_ms as number
        })
      );
    }
    seen.add(item.queue_id as string);
    tallied[item.state as string] = (tallied[item.state as string] ?? 0) + 1;
  }
  const summary = queue.summary;
  const byStateKeys = kind === "tickets" ? queueTicketByStateKeys : queueByStateKeys;
  if (
    !isRecord(summary)
    || !hasExactKeys(summary, queueSummaryKeys)
    || typeof summary.count !== "number"
    || !Number.isInteger(summary.count)
    || summary.count !== items.length
    || !isRecord(summary.by_state)
    || !hasExactKeys(summary.by_state, byStateKeys)
    || !Object.entries(summary.by_state).every(([key, count]) => typeof count === "number" && count === (tallied[key] ?? 0))
  ) {
    return undefined;
  }
  const byState = Object.freeze({ ...summary.by_state } as Record<string, number>);
  const parsedSummary = Object.freeze({ count: summary.count, by_state: byState });
  if (kind === "aml") {
    return Object.freeze({
      mode: "test",
      queue: Object.freeze({
        kind: "aml",
        items: Object.freeze(items as CustomerApiAmlQueueItem[]),
        summary: parsedSummary as { count: number; by_state: { pending: number; in_review: number; escalated: number } },
        posting: "none"
      })
    });
  }
  if (kind === "tickets") {
    return Object.freeze({
      mode: "test",
      queue: Object.freeze({
        kind: "tickets",
        items: Object.freeze(items as CustomerApiTicketQueueItem[]),
        summary: parsedSummary as { count: number; by_state: { open: number; waiting: number; escalated: number } },
        posting: "none"
      })
    });
  }
  return Object.freeze({
    mode: "test",
    queue: Object.freeze({
      kind: "kyc",
      items: Object.freeze(items as CustomerApiQueueItem[]),
      summary: parsedSummary as { count: number; by_state: { pending: number; in_review: number; escalated: number } },
      posting: "none"
    })
  });
}

/**
 * Fail-closed parser for the operator queue item detail contract view — the
 * same axes `parseOperatorQueueView` pins for the row (exact key sets, ref
 * grammar, enums, coherent timestamps, a non-negative integer age), with the
 * kind's detail key list in place of the collection's row keys plus each
 * kind's extension: the nullable kyc dossier block, the bounded open flag
 * list with unique `flg_*` ids, or the ticket subject/last-message/open
 * tally. The declared kind selects the shape; a view that answers a
 * different kind than requested is drift.
 */
function parseOperatorQueueItemDetailView(
  value: unknown,
  kind: CustomerApiQueueKind
): CustomerApiOperatorQueueItemDetailView | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, queueItemDetailViewKeys)
    || value.mode !== "test"
    || value.kind !== kind
  ) {
    return undefined;
  }
  const item = value.item;
  if (!isRecord(item)) {
    return undefined;
  }
  const seen = new Set<string>();
  if (kind === "aml") {
    if (
      !validQueueItemCore(item, amlQueueItemDetailKeys, amlQueueIdPattern, queueStates, seen)
      || typeof item.alert_type !== "string"
      || !amlAlertTypes.has(item.alert_type)
      || !Array.isArray(item.evidence_refs)
      || item.evidence_refs.length < 1
      || item.evidence_refs.length > evidenceRefsMaxItems
      || new Set(item.evidence_refs).size !== item.evidence_refs.length
      || !item.evidence_refs.every((ref) => typeof ref === "string" && evidenceRefPattern.test(ref))
      || !isIsoTimestamp(item.sla_due_at)
      || !Array.isArray(item.flags)
      || item.flags.length > queueItemFlagsMaxItems
      || !item.flags.every(
        (flag) =>
          isRecord(flag)
          && hasExactKeys(flag, queueItemFlagKeys)
          && typeof flag.flag_id === "string"
          && flagIdPattern.test(flag.flag_id)
          && typeof flag.alert_type === "string"
          && amlAlertTypes.has(flag.alert_type)
          && isIsoTimestamp(flag.raised_at)
      )
      || new Set((item.flags as { flag_id: string }[]).map((flag) => flag.flag_id)).size !== item.flags.length
    ) {
      return undefined;
    }
    const flags = Object.freeze(
      (item.flags as { flag_id: string; alert_type: string; raised_at: string }[]).map((flag) =>
        Object.freeze({ flag_id: flag.flag_id, alert_type: flag.alert_type, raised_at: flag.raised_at })
      )
    );
    return Object.freeze({
      mode: "test",
      kind: "aml",
      item: Object.freeze({
        queue_id: item.queue_id as string,
        subject_id: item.subject_id as string,
        alert_type: item.alert_type as string,
        evidence_refs: Object.freeze([...(item.evidence_refs as string[])]),
        sla_due_at: item.sla_due_at as string,
        state: item.state as string,
        priority: item.priority as string,
        assignee: parseQueueAssignee(item),
        age_ms: item.age_ms as number,
        flags
      })
    });
  }
  if (kind === "tickets") {
    if (
      !validQueueItemCore(item, ticketQueueItemDetailKeys, ticketQueueIdPattern, queueTicketStates, seen)
      || typeof item.category !== "string"
      || !ticketCategories.has(item.category)
      || !isIsoTimestamp(item.opened_at)
      || typeof item.subject !== "string"
      || item.subject.length === 0
      || item.subject.length > ticketSubjectMaxLength
      || !isIsoTimestamp(item.last_message_at)
      || typeof item.other_open_tickets !== "number"
      || !Number.isInteger(item.other_open_tickets)
      || item.other_open_tickets < 0
      || item.other_open_tickets > queueMaxItems
    ) {
      return undefined;
    }
    return Object.freeze({
      mode: "test",
      kind: "tickets",
      item: Object.freeze({
        queue_id: item.queue_id as string,
        subject_id: item.subject_id as string,
        category: item.category as string,
        opened_at: item.opened_at as string,
        state: item.state as string,
        priority: item.priority as string,
        assignee: parseQueueAssignee(item),
        age_ms: item.age_ms as number,
        subject: item.subject as string,
        last_message_at: item.last_message_at as string,
        other_open_tickets: item.other_open_tickets as number
      })
    });
  }
  if (
    !validQueueItemCore(item, kycQueueItemDetailKeys, queueIdPattern, queueStates, seen)
    || typeof item.display_name !== "string"
    || !displayNamePattern.test(item.display_name)
    || !isIsoTimestamp(item.submitted_at)
    || !isIsoTimestamp(item.sla_due_at)
    || Date.parse(item.sla_due_at as string) <= Date.parse(item.submitted_at as string)
  ) {
    return undefined;
  }
  const kyc = item.kyc === null ? null : parseSubjectKyc(item.kyc);
  if (kyc === undefined) {
    return undefined;
  }
  return Object.freeze({
    mode: "test",
    kind: "kyc",
    item: Object.freeze({
      queue_id: item.queue_id as string,
      subject_id: item.subject_id as string,
      display_name: item.display_name as string,
      submitted_at: item.submitted_at as string,
      sla_due_at: item.sla_due_at as string,
      state: item.state as string,
      priority: item.priority as string,
      assignee: parseQueueAssignee(item),
      age_ms: item.age_ms as number,
      kyc
    })
  });
}

class CustomerApiHttpError extends Error {
  constructor(readonly status: number) {
    super("customer-api request failed");
    this.name = "CustomerApiHttpError";
  }
}

/**
 * Server-side, read-only client for the dev customer API's operator audience.
 * It only issues the operator directory GETs (admin, subjects), always sends
 * X-Device-Id (the operator audience pins a bound workstation device on every
 * request) and fails closed to "unavailable" on any unexpected response,
 * including a non-JSON content type or a body above
 * maxCustomerApiResponseBytes. The reads are granted to every operator token
 * upstream, so there is no "denied" arm: a refusal is contract drift, not a
 * real denial.
 */
export function createCustomerApiClient(options: CustomerApiClientOptions): CustomerApiClient {
  const { baseUrl, devTokenKey } = options;
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!baseUrl || !devTokenKey) {
    return Object.freeze({
      configured: false,
      operatorAdmin: async (): Promise<CustomerApiOperatorAdmin> => ({ status: "not-configured" }),
      operatorSubjects: async (): Promise<CustomerApiOperatorSubjects> => ({ status: "not-configured" }),
      operatorSubject: async (): Promise<CustomerApiOperatorSubject> => ({ status: "not-configured" }),
      operatorQueue: async (): Promise<CustomerApiOperatorQueue> => ({ status: "not-configured" }),
      operatorQueueItem: async (): Promise<CustomerApiOperatorQueueItem> => ({ status: "not-configured" })
    });
  }

  async function get(path: string, token: string, deviceId: string, nowMs: number): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-request-id": generateUuidV7(nowMs),
        "x-client-version": customerApiClientVersion,
        "x-platform": customerApiPlatform,
        "x-device-id": deviceId
      }
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new CustomerApiHttpError(response.status);
    }
    return readBoundedJson(response);
  }

  async function operatorAdmin(
    bffSubject: string,
    deviceId: string,
    nowMs: number
  ): Promise<CustomerApiOperatorAdmin> {
    // The route rejects absent or malformed device identities before calling;
    // this guard keeps the client itself from ever emitting a non-contract
    // X-Device-Id if it is reused elsewhere.
    if (!isDeviceId(deviceId)) {
      return { status: "unavailable" };
    }
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticOperatorToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/operator/admin", token, deviceId, nowMs);
      const view = parseOperatorAdminView(body, subject);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch {
      return { status: "unavailable" };
    }
  }

  async function operatorSubjects(
    bffSubject: string,
    deviceId: string,
    nowMs: number
  ): Promise<CustomerApiOperatorSubjects> {
    // Same device guard as operatorAdmin: never emit a non-contract
    // X-Device-Id if the client is reused outside the gated route.
    if (!isDeviceId(deviceId)) {
      return { status: "unavailable" };
    }
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticOperatorToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/operator/subjects", token, deviceId, nowMs);
      const view = parseOperatorSubjectsView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch {
      return { status: "unavailable" };
    }
  }

  async function operatorSubject(
    bffSubject: string,
    deviceId: string,
    subjectId: string,
    nowMs: number
  ): Promise<CustomerApiOperatorSubject> {
    // Same device guard as operatorAdmin: never emit a non-contract
    // X-Device-Id if the client is reused outside the gated route. The
    // subject ref guard mirrors it: a non-contract id is answered locally as
    // the uniform not-found, never propagated upstream.
    if (!isDeviceId(deviceId)) {
      return { status: "unavailable" };
    }
    if (!customerSubjectPattern.test(subjectId)) {
      return { status: "not-found" };
    }
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticOperatorToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get(`/api/v1/operator/subjects/${encodeURIComponent(subjectId)}`, token, deviceId, nowMs);
      const view = parseOperatorSubjectDetailView(body, subjectId);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch (error) {
      // The upstream member read answers unknown ids with its uniform 404;
      // that is a real not-found, not drift — surface it distinctly so the
      // route can keep the same uniform response.
      if (error instanceof CustomerApiHttpError && error.status === 404) {
        return { status: "not-found" };
      }
      return { status: "unavailable" };
    }
  }

  async function operatorQueue(
    bffSubject: string,
    deviceId: string,
    kind: CustomerApiQueueKind,
    nowMs: number
  ): Promise<CustomerApiOperatorQueue> {
    // Same device guard as operatorAdmin: never emit a non-contract
    // X-Device-Id if the client is reused outside the gated route. The kind
    // guard mirrors it: an out-of-enum kind is answered locally, never
    // propagated upstream.
    if (!isDeviceId(deviceId) || !queueKinds.has(kind)) {
      return { status: "unavailable" };
    }
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticOperatorToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get(`/api/v1/operator/queue?kind=${kind}`, token, deviceId, nowMs);
      const view = parseOperatorQueueView(body, kind);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch {
      return { status: "unavailable" };
    }
  }

  async function operatorQueueItem(
    bffSubject: string,
    deviceId: string,
    kind: CustomerApiQueueKind,
    itemId: string,
    nowMs: number
  ): Promise<CustomerApiOperatorQueueItem> {
    // Same device guard as operatorQueue: never emit a non-contract
    // X-Device-Id if the client is reused outside the gated route. The kind
    // guard and the per-kind item ref guard mirror the subject detail read:
    // an out-of-enum kind or a non-contract id — including a well-formed id
    // minted for another kind — is answered locally as the uniform
    // not-found, never propagated upstream.
    if (!isDeviceId(deviceId)) {
      return { status: "unavailable" };
    }
    if (!queueKinds.has(kind)) {
      return { status: "not-found" };
    }
    if (!queueItemIdPatterns[kind].test(itemId)) {
      return { status: "not-found" };
    }
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticOperatorToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get(
        `/api/v1/operator/queue/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}`,
        token,
        deviceId,
        nowMs
      );
      const view = parseOperatorQueueItemDetailView(body, kind);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch (error) {
      // The upstream member read answers unknown and wrong-kind ids with its
      // uniform 404; that is a real not-found, not drift — surface it
      // distinctly so the route can keep the same uniform response.
      if (error instanceof CustomerApiHttpError && error.status === 404) {
        return { status: "not-found" };
      }
      return { status: "unavailable" };
    }
  }

  return Object.freeze({ configured: true, operatorAdmin, operatorSubjects, operatorSubject, operatorQueue, operatorQueueItem });
}
