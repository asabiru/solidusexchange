import type {
  ActivityKind,
  AddressScreeningStatus,
  KycActivity,
  KycVerificationState,
  OperationStatus,
  SessionClient,
  SessionSource
} from "../shared/api.js";
import type { ScreeningNetwork } from "../shared/address-screening.js";
import type { SupportCategory, SupportStatus } from "../shared/support.js";
import type { IconName } from "./icon-data.js";
import type { MessageKey } from "./i18n.js";

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
  support_requested: "common.support"
};

export function activityKindKeyOf(kind: string): MessageKey | undefined {
  return member(activityKinds, kind);
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
