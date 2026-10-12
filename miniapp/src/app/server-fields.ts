import type {
  ActivityKind,
  AddressScreeningStatus,
  DeviceSessionsView,
  KycActivity,
  KycVerificationState,
  NotificationsView,
  OperationDetail,
  OperationKind,
  OperationStatus,
  SessionClient,
  SessionSource,
  SupportRequestView
} from "../shared/api.js";
import { assetMetaOf } from "../shared/assets.js";
import { isDecimalString } from "../shared/decimal.js";
import type { ScreeningNetwork } from "../shared/address-screening.js";
import type { SupportCategory, SupportStatus } from "../shared/support.js";
import type { IconName } from "./icon-data.js";
import type { MessageKey } from "./i18n.js";
import { boundedRows, hasContractKeys, hasExactKeys, isEpochMs, isNonNegativeInt, isRecord, type ServedRows } from "./served-views.js";

/**
 * Server-supplied enum and status fields are untrusted input: only declared own
 * members resolve, so a foreign value or a prototype member such as "constructor"
 * falls back instead of dereferencing an inherited or missing entry (the #218 pattern).
 */
function member<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export interface OperationStatusMeta {
  label: MessageKey;
  tone: string;
  icon: IconName;
}

const operationStatuses: Readonly<Record<OperationStatus, OperationStatusMeta>> = {
  completed: { label: "status.completed", tone: "success", icon: "check" },
  "in-review": { label: "status.inReview", tone: "warning", icon: "clock" },
  "needs-action": { label: "status.needsAction", tone: "risk", icon: "alert" },
  failed: { label: "status.failed", tone: "risk", icon: "close" }
};

export function operationStatusOf(status: string): OperationStatusMeta | undefined {
  return member(operationStatuses, status);
}

export interface ScreeningBadge {
  label: MessageKey;
  tone: string;
  detail: MessageKey;
}

const screeningBadges: Readonly<Record<AddressScreeningStatus, ScreeningBadge>> = {
  pending: { label: "screening.pendingLabel", tone: "muted", detail: "screening.pendingDetail" },
  low: { label: "screening.lowLabel", tone: "success", detail: "screening.lowDetail" },
  medium: { label: "screening.mediumLabel", tone: "warning", detail: "screening.mediumDetail" },
  high: { label: "screening.highLabel", tone: "risk", detail: "screening.highDetail" },
  severe: { label: "screening.severeLabel", tone: "risk", detail: "screening.severeDetail" },
  unavailable: { label: "screening.unavailableLabel", tone: "muted", detail: "screening.unavailableDetail" },
  timed_out: { label: "screening.timedOutLabel", tone: "muted", detail: "screening.timedOutDetail" }
};

export function screeningBadgeOf(status: string): ScreeningBadge | undefined {
  return member(screeningBadges, status);
}

const screeningNetworks: Readonly<Record<ScreeningNetwork, MessageKey>> = {
  TON_TESTNET: "network.TON_TESTNET",
  TRON_TESTNET: "network.TRON_TESTNET"
};

export function screeningNetworkKeyOf(network: string): MessageKey | undefined {
  return member(screeningNetworks, network);
}

const sessionClients: Readonly<Record<SessionClient, MessageKey>> = {
  telegram: "activity.sourceTelegram",
  "dev-login": "activity.sourceDev"
};

export function sessionClientKeyOf(client: string): MessageKey | undefined {
  return member(sessionClients, client);
}

const activitySources: Readonly<Record<SessionSource, MessageKey>> = {
  telegram: "activity.sourceTelegram",
  "dev-synthetic": "activity.sourceDev"
};

export function activitySourceKeyOf(source: string): MessageKey | undefined {
  return member(activitySources, source);
}

const activityKinds: Readonly<Record<ActivityKind, MessageKey>> = {
  session_login: "activity.login",
  session_revoked: "activity.sessionRevokedOne",
  kyc_submitted: "activity.kycSubmitted",
  kyc_in_review: "activity.kycInReview",
  kyc_approved: "activity.kycApproved",
  kyc_rejected: "activity.kycRejected",
  kyc_needs_more_data: "activity.kycNeedsMoreData",
  kyc_timed_out: "activity.kycTimedOut",
  kyc_unavailable: "activity.kycUnavailable",
  quote_previewed: "activity.filterQuote",
  address_screened: "activity.filterScreening",
  contract: "activity.filterContract",
  support_requested: "common.support"
};

export function activityKindKeyOf(kind: string): MessageKey | undefined {
  return member(activityKinds, kind);
}

/**
 * The served activity feed's upstream kind vocabulary, mapped to labels.
 * The feed is a derived-only cross-domain projection, so its kinds never
 * collide with the locally recorded ActivityKind members.
 */
const contractActivityKinds: Readonly<Record<string, MessageKey>> = {
  deposit: "activity.contractDeposit",
  withdrawal: "activity.contractWithdrawal",
  quote: "activity.contractQuote",
  order: "activity.contractOrder",
  payment: "activity.contractPayment",
  card: "activity.contractCard",
  check: "activity.contractCheck",
  kyc: "activity.contractKyc",
  security: "activity.contractSecurity"
};

export function contractActivityKindKeyOf(contract: string): MessageKey | undefined {
  return member(contractActivityKinds, contract);
}

/**
 * Maps a served activity item's upstream lifecycle status onto a pill
 * tone. In-progress and pending states warn, settled positive states are
 * success, terminal negative states are risk, and neutral security
 * bookkeeping stays muted. Unknown statuses fall back to muted via the
 * caller's `??` — the feed's vocabulary may grow.
 */
const contractActivityTones: Readonly<Record<string, string>> = {
  awaiting_payment: "warning",
  payment_received: "success",
  partial_payment: "warning",
  duplicate_payment: "risk",
  payment_reversed: "risk",
  expired_no_payment: "risk",
  draft: "muted",
  screened: "warning",
  pending_maker_approval: "warning",
  pending_checker_approval: "warning",
  unsigned_intent_ready: "warning",
  broadcast: "warning",
  confirmed: "success",
  rejected: "risk",
  cancelled: "risk",
  expired: "risk",
  indicative: "muted",
  open: "warning",
  created: "warning",
  processing: "warning",
  completed: "success",
  failed: "risk",
  reversed: "risk",
  pending_activation: "warning",
  active: "success",
  frozen: "risk",
  blocked: "risk",
  terminated: "risk",
  awaiting_confirmation: "warning",
  awaiting_recipient_kyc: "warning",
  claimed: "success",
  submitted: "warning",
  in_review: "warning",
  approved: "success",
  needs_more_data: "risk",
  timed_out: "risk",
  unavailable: "risk",
  login: "muted",
  revoked: "muted"
};

export function contractActivityToneOf(status: string): string {
  return member(contractActivityTones, status) ?? "muted";
}

export interface KycActivityText {
  title: MessageKey;
  tone: string;
  icon: IconName;
}

const kycActivityTexts: Readonly<Record<KycActivity["kind"], KycActivityText>> = {
  kyc_submitted: { title: "activity.kycSubmitted", tone: "warning", icon: "id-card" },
  kyc_in_review: { title: "activity.kycInReview", tone: "warning", icon: "clock" },
  kyc_approved: { title: "activity.kycApproved", tone: "success", icon: "shield-check" },
  kyc_rejected: { title: "activity.kycRejected", tone: "risk", icon: "close" },
  kyc_needs_more_data: { title: "activity.kycNeedsMoreData", tone: "risk", icon: "alert" },
  kyc_timed_out: { title: "activity.kycTimedOut", tone: "risk", icon: "clock" },
  kyc_unavailable: { title: "activity.kycUnavailable", tone: "risk", icon: "alert" }
};

export function kycActivityOf(kind: string): KycActivityText | undefined {
  return member(kycActivityTexts, kind);
}

export interface SupportStatusBadge {
  label: MessageKey;
  tone: string;
}

const supportStatuses: Readonly<Record<SupportStatus, SupportStatusBadge>> = {
  received: { label: "support.statusReceived", tone: "muted" },
  in_review: { label: "support.statusInReview", tone: "warning" },
  answered: { label: "support.statusAnswered", tone: "success" },
  closed: { label: "support.statusClosed", tone: "muted" }
};

export function supportStatusOf(status: string): SupportStatusBadge | undefined {
  return member(supportStatuses, status);
}

const supportCategoriesMap: Readonly<Record<SupportCategory, MessageKey>> = {
  question: "support.categoryQuestion",
  operation_problem: "support.categoryOperation",
  complaint: "support.categoryComplaint",
  data_request: "support.categoryData"
};

export function supportCategoryKeyOf(category: string): MessageKey | undefined {
  return member(supportCategoriesMap, category);
}

export interface KycText {
  title: MessageKey;
  detail: MessageKey;
}

const kycOutcomes: Readonly<Record<KycVerificationState, KycText>> = {
  not_started: { title: "kyc.notStartedTitle", detail: "kyc.notStartedDetail" },
  submitted: { title: "kyc.submittedTitle", detail: "kyc.submittedDetail" },
  in_review: { title: "kyc.inReviewTitle", detail: "kyc.inReviewDetail" },
  approved: { title: "kyc.approvedTitle", detail: "kyc.approvedDetail" },
  rejected: { title: "kyc.rejectedTitle", detail: "kyc.rejectedDetail" },
  needs_more_data: { title: "kyc.needsMoreDataTitle", detail: "kyc.needsMoreDataDetail" },
  timed_out: { title: "kyc.timedOutTitle", detail: "kyc.timedOutDetail" },
  unavailable: { title: "kyc.unavailableTitle", detail: "kyc.unavailableDetail" }
};

/**
 * A foreign KYC state must not claim progress: it renders the unavailable copy,
 * the same fail-closed surface the provider-outage state uses.
 */
export function kycOutcomeOf(state: string): KycText {
  return member(kycOutcomes, state) ?? kycOutcomes.unavailable;
}

/** A foreign KYC state normalizes to "unavailable" so derived UI fails closed. */
export function kycStateOf(state: string): KycVerificationState {
  return member(kycOutcomes, state) ? (state as KycVerificationState) : "unavailable";
}

export type StepState = "done" | "current" | "pending" | "blocked";

const kycDecisionSteps: Readonly<Partial<Record<KycVerificationState, KycText & { state: StepState }>>> = {
  approved: { title: "kyc.stepApprovedTitle", detail: "kyc.stepApprovedDetail", state: "done" },
  rejected: { title: "kyc.stepRejectedTitle", detail: "kyc.stepRejectedDetail", state: "blocked" },
  needs_more_data: { title: "kyc.stepNeedsMoreDataTitle", detail: "kyc.stepNeedsMoreDataDetail", state: "blocked" },
  timed_out: { title: "kyc.stepTimedOutTitle", detail: "kyc.stepTimedOutDetail", state: "blocked" }
};

export function kycDecisionStepOf(state: string): (KycText & { state: StepState }) | undefined {
  return member(kycDecisionSteps, state);
}

const timelineStates: readonly StepState[] = Object.freeze(["done", "current", "pending", "blocked"]);

export function timelineStepState(state: string): StepState {
  return (timelineStates as readonly string[]).includes(state) ? (state as StepState) : "pending";
}

/** Server list fields are untrusted: a non-array payload degrades to an empty list. */
export function arrayOf<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

/* ——— Served view validators (wave-73 audit: fail-closed member reads) ——— */

const sessionIdPattern = /^sess_[0-9a-f]{24}$/;
const notificationIdPattern = /^ntf_[0-9a-f]{24}$/;
const supportIdPattern = /^sup_[0-9a-f]{24}$/;
const operationKinds = new Set<OperationKind>(["exchange", "deposit", "withdrawal", "qr"]);
const operationStatusNames = new Set<OperationStatus>(["completed", "in-review", "needs-action", "failed"]);
const timelineStepStates = new Set(["done", "current", "pending", "blocked"]);
const sessionClientNames = new Set<SessionClient>(["telegram", "dev-login"]);
const supportCategoryNames = new Set<SupportCategory>(["question", "operation_problem", "complaint", "data_request"]);
const supportStatusNames = new Set<SupportStatus>(["received", "in_review", "answered", "closed"]);

function isLeg(value: unknown): value is OperationDetail["legs"][number] {
  if (!isRecord(value) || !hasExactKeys(value, ["asset", "amount", "direction"]) || typeof value.asset !== "string") {
    return false;
  }
  const meta = assetMetaOf(value.asset);
  return (
    meta !== undefined
    && typeof value.amount === "string"
    && isDecimalString(value.amount, meta.scale)
    && (value.direction === "in" || value.direction === "out")
  );
}

/**
 * Validates the served operation detail (member read) — the rendered legs,
 * timeline and rate must match the contract shape or the sheet fails closed.
 */
export function operationDetailOf(value: unknown): OperationDetail | undefined {
  if (
    !isRecord(value)
    || !hasContractKeys(
      value,
      ["id", "reference", "kind", "status", "title", "channel", "createdAt", "legs", "note", "timeline"],
      ["fee", "rate"]
    )
    || typeof value.id !== "string"
    || typeof value.reference !== "string"
    || !operationKinds.has(value.kind as OperationKind)
    || !operationStatusNames.has(value.status as OperationStatus)
    || typeof value.title !== "string"
    || typeof value.channel !== "string"
    || typeof value.createdAt !== "string"
    || typeof value.note !== "string"
    || !Array.isArray(value.legs)
    || (value.legs as readonly unknown[]).length === 0
    || !(value.legs as readonly unknown[]).every(isLeg)
    || !Array.isArray(value.timeline)
    || !(value.timeline as readonly unknown[]).every(
      (step) =>
        isRecord(step)
        && hasContractKeys(step, ["title", "detail", "state"], ["at"])
        && typeof step.title === "string"
        && typeof step.detail === "string"
        && (step.at === undefined || typeof step.at === "string")
        && timelineStepStates.has(step.state as string)
    )
    || (value.fee !== undefined
      && (!isRecord(value.fee)
        || !hasExactKeys(value.fee, ["asset", "amount"])
        || typeof value.fee.asset !== "string"
        || assetMetaOf(value.fee.asset) === undefined
        || typeof value.fee.amount !== "string"
        || !isDecimalString(value.fee.amount, (assetMetaOf(value.fee.asset) as { scale: number }).scale)))
    || (value.rate !== undefined
      && (!isRecord(value.rate)
        || !hasExactKeys(value.rate, ["base", "quote", "value"])
        || typeof value.rate.base !== "string"
        || assetMetaOf(value.rate.base) === undefined
        || typeof value.rate.quote !== "string"
        || assetMetaOf(value.rate.quote) === undefined
        || typeof value.rate.value !== "string"
        || !isDecimalString(value.rate.value, 30)))
  ) {
    return undefined;
  }
  return value as unknown as OperationDetail;
}

/** Validates the served device-sessions view. */
export function sessionsViewOf(view: unknown): DeviceSessionsView | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "sessions"])
    || view.mode !== "test"
    || !Array.isArray(view.sessions)
    || !(view.sessions as readonly unknown[]).every(
      (session) =>
        isRecord(session)
        && hasExactKeys(session, ["handle", "client", "createdAt", "lastSeenAt", "current"])
        && typeof session.handle === "string"
        && sessionIdPattern.test(session.handle)
        && sessionClientNames.has(session.client as SessionClient)
        && isEpochMs(session.createdAt)
        && isEpochMs(session.lastSeenAt)
        && typeof session.current === "boolean"
    )
  ) {
    return undefined;
  }
  return view as unknown as DeviceSessionsView;
}

/**
 * Validates the served notifications view. template is deliberately not
 * re-asserted: the view model declares forward-compatible raw-text rendering
 * for future template kinds (the sheet falls back to draft.text).
 */
export function notificationsViewOf(view: unknown): NotificationsView | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "delivery", "unread", "notifications"])
    || view.mode !== "test"
    || view.delivery !== "disabled"
    || !isNonNegativeInt(view.unread)
    || !Array.isArray(view.notifications)
    || !(view.notifications as readonly unknown[]).every(
      (draft) =>
        isRecord(draft)
        && hasExactKeys(
          draft,
          ["id", "createdAt", "channel", "template", "locale", "text", "mode", "delivered", "read"]
        )
        && typeof draft.id === "string"
        && notificationIdPattern.test(draft.id)
        && isEpochMs(draft.createdAt)
        && draft.channel === "telegram-draft"
        && typeof draft.template === "string"
        && draft.locale === "ru"
        && typeof draft.text === "string"
        && draft.mode === "test"
        && draft.delivered === false
        && typeof draft.read === "boolean"
    )
  ) {
    return undefined;
  }
  return view as unknown as NotificationsView;
}

/** Validates the served support-requests collection, bounding the rendered history. */
export function supportRequestsViewOf(view: unknown): ServedRows<SupportRequestView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "delivery", "requests"])
    || view.mode !== "test"
    || view.delivery !== "disabled"
    || !Array.isArray(view.requests)
    || !(view.requests as readonly unknown[]).every(
      (request) =>
        isRecord(request)
        && hasContractKeys(
          request,
          [
            "id",
            "mode",
            "delivery",
            "category",
            "topic",
            "message",
            "status",
            "timeline",
            "complaintAcknowledged",
            "createdAt",
            "expiresAt"
          ],
          ["activityRef"]
        )
        && typeof request.id === "string"
        && supportIdPattern.test(request.id)
        && request.mode === "test"
        && request.delivery === "disabled"
        && supportCategoryNames.has(request.category as SupportCategory)
        && typeof request.topic === "string"
        && typeof request.message === "string"
        && supportStatusNames.has(request.status as SupportStatus)
        && Array.isArray(request.timeline)
        && (request.timeline as readonly unknown[]).every(
          (step) =>
            isRecord(step)
            && hasExactKeys(step, ["status", "at"])
            && supportStatusNames.has(step.status as SupportStatus)
            && isEpochMs(step.at)
        )
        && typeof request.complaintAcknowledged === "boolean"
        && isEpochMs(request.createdAt)
        && isEpochMs(request.expiresAt)
        && (request.activityRef === undefined
          || (isRecord(request.activityRef)
            && hasExactKeys(request.activityRef, ["id", "kind"])
            && typeof request.activityRef.id === "string"
            && activityKindKeyOf(request.activityRef.kind as string) !== undefined))
    )
  ) {
    return undefined;
  }
  return boundedRows(view.requests as readonly SupportRequestView[]);
}
