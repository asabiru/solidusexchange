import type { ScreeningAsset, ScreeningNetwork } from "./address-screening.js";
import type { AssetCode } from "./assets.js";
import type { CheckDirection, CheckStatus } from "./checks.js";
import type { SupportCategory, SupportStatus } from "./support.js";

export type KycStatus = "verified" | "kyc-gated";
export type SessionSource = "telegram" | "dev-synthetic";

export type SessionClient = "telegram" | "dev-login";

export interface DeviceSessionView {
  handle: string;
  client: SessionClient;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

export interface DeviceSessionsView {
  mode: "test";
  sessions: readonly DeviceSessionView[];
}

export interface HealthView {
  mode: "dev-synthetic";
  devLogin: boolean;
  telegramVerification: "configured" | "not-configured";
  moneyMovement: "disabled";
}

export interface SessionView {
  authenticated: true;
  source: SessionSource;
  kyc: KycStatus;
  displayName: string;
  customerRef: string;
  expiresAt: number;
}

export interface AssetBalance {
  code: AssetCode;
  available: string;
  hold: string;
  valueRub: string;
}

export interface WalletView {
  kyc: KycStatus;
  totalRub: string;
  availableRub: string;
  holdRub: string;
  assets: readonly AssetBalance[];
}

export type OperationKind = "exchange" | "deposit" | "withdrawal" | "qr";
export type OperationStatus = "completed" | "in-review" | "needs-action" | "failed";

export interface OperationLeg {
  asset: AssetCode;
  amount: string;
  direction: "in" | "out";
}

export interface OperationSummary {
  id: string;
  reference: string;
  kind: OperationKind;
  status: OperationStatus;
  title: string;
  channel: string;
  createdAt: string;
  legs: readonly OperationLeg[];
}

export interface TimelineStep {
  title: string;
  detail: string;
  at?: string;
  state: "done" | "current" | "pending" | "blocked";
}

export interface ExchangeRate {
  base: AssetCode;
  quote: AssetCode;
  value: string;
}

export interface OperationDetail extends OperationSummary {
  fee?: { asset: AssetCode; amount: string };
  rate?: ExchangeRate;
  note: string;
  timeline: readonly TimelineStep[];
}

export interface ProfileStep {
  title: string;
  detail: string;
  state: "done" | "required";
}

export type CustomerApiAccess =
  | { status: "connected"; granted: readonly string[]; commandsEnabled: false }
  | { status: "not-configured" }
  | { status: "unavailable" };

export interface ProfileView {
  displayName: string;
  customerRef: string;
  kyc: {
    state: KycStatus;
    level: string;
    detail: string;
    steps: readonly ProfileStep[];
  };
  limits: {
    status: "not_configured";
    decision: "D-014";
    message: string;
  };
  fees: readonly { title: string; value: string }[];
  security: readonly { title: string; detail: string; status: "placeholder" }[];
  apiAccess: CustomerApiAccess;
}

export type KycVerificationState =
  | "not_started"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "needs_more_data"
  | "timed_out"
  | "unavailable";

export interface KycVerificationView {
  mode: "test";
  provider: "simulator";
  state: KycVerificationState;
  sessionKyc: KycStatus;
  canSubmit: boolean;
  submittedAt?: number;
  reviewDeadline?: number;
}

export interface QuotePreview {
  id: string;
  from: AssetCode;
  to: AssetCode;
  amountIn: string;
  fee: string;
  feeAsset: AssetCode;
  feeBps: number;
  spreadBps: number;
  netIn: string;
  amountOut: string;
  total: string;
  rate: ExchangeRate;
  issuedAt: number;
  expiresAt: number;
  ttlSeconds: number;
  serverTime: number;
  insufficientBalance: boolean;
  kycRequired: boolean;
  executable: false;
  executionUnavailableReason: "dev_test_version";
}

export type NotificationTemplate =
  | "session_login"
  | "kyc_submitted"
  | "kyc_in_review"
  | "kyc_approved"
  | "kyc_rejected"
  | "kyc_needs_more_data"
  | "kyc_timed_out"
  | "kyc_unavailable"
  | "support_received"
  | "complaint_received";

export interface NotificationDraft {
  id: string;
  createdAt: number;
  channel: "telegram-draft";
  template: NotificationTemplate;
  locale: "ru";
  text: string;
  mode: "test";
  delivered: false;
  read: boolean;
}

export interface NotificationsView {
  mode: "test";
  delivery: "disabled";
  unread: number;
  notifications: readonly NotificationDraft[];
}

export type AddressScreeningStatus =
  | "pending"
  | "low"
  | "medium"
  | "high"
  | "severe"
  | "unavailable"
  | "timed_out";

export interface AddressScreeningView {
  id: string;
  mode: "test";
  asset: ScreeningAsset;
  network: ScreeningNetwork;
  status: AddressScreeningStatus;
  advisory: true;
  executable: false;
  submittedAt: number;
  deadline: number;
}

export type ActivityKycState = Exclude<KycVerificationState, "not_started">;
export type ActivityKind =
  | "session_login"
  | "session_revoked"
  | `kyc_${ActivityKycState}`
  | "quote_previewed"
  | "address_screened"
  | "support_requested";

interface ActivityBase {
  id: string;
  at: number;
}

export interface SessionLoginActivity extends ActivityBase {
  kind: "session_login";
  source: SessionSource;
}

export interface SessionRevokedActivity extends ActivityBase {
  kind: "session_revoked";
  scope: "single" | "others";
  count: number;
}

export interface KycActivity extends ActivityBase {
  kind: `kyc_${ActivityKycState}`;
}

export interface QuotePreviewedActivity extends ActivityBase {
  kind: "quote_previewed";
  pair: `${AssetCode}/${AssetCode}`;
  side: "buy" | "sell";
  from: AssetCode;
  to: AssetCode;
  amountIn: string;
  amountOut: string;
  fee: string;
  feeAsset: AssetCode;
  rate: ExchangeRate;
  executable: false;
}

export interface AddressScreenedActivity extends ActivityBase {
  kind: "address_screened";
  asset: ScreeningAsset;
  network: ScreeningNetwork;
  status: AddressScreeningStatus;
  advisory: true;
  executable: false;
}

export interface SupportRequestedActivity extends ActivityBase {
  kind: "support_requested";
  category: SupportCategory;
  requestId: string;
}

export type ActivityItem =
  | SessionLoginActivity
  | SessionRevokedActivity
  | KycActivity
  | QuotePreviewedActivity
  | AddressScreenedActivity
  | SupportRequestedActivity;

export interface ActivityView {
  mode: "test";
  items: readonly ActivityItem[];
  executable: false;
}

export interface SupportTimelineEntry {
  status: SupportStatus;
  at: number;
}

export interface SupportRequestView {
  id: string;
  mode: "test";
  delivery: "disabled";
  category: SupportCategory;
  topic: string;
  message: string;
  activityRef?: { id: string; kind: ActivityKind };
  status: SupportStatus;
  timeline: readonly SupportTimelineEntry[];
  complaintAcknowledged: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface SupportRequestsView {
  mode: "test";
  delivery: "disabled";
  requests: readonly SupportRequestView[];
}

/** Mirrors the bank simulator's PaymentStatusName set exactly. */
export type DepositStatus =
  | "awaiting_payment"
  | "payment_received"
  | "partial_payment"
  | "duplicate_payment"
  | "payment_reversed"
  | "expired_no_payment";

export interface DepositView {
  id: string;
  asset: AssetCode;
  method: "sbp";
  status: DepositStatus;
  expected: string;
  received: string;
  reversed: string;
  paymentReference: string;
  createdAt: number;
  updatedAt: number;
  posting: "none";
}

export interface DepositsView {
  mode: "test";
  kyc: KycStatus;
  deposits: readonly DepositView[];
}

/** Mirrors the custody withdrawal-intent lifecycle exactly. */
export type WithdrawalStatus =
  | "draft"
  | "screened"
  | "pending_maker_approval"
  | "pending_checker_approval"
  | "unsigned_intent_ready"
  | "broadcast"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "expired";

export interface WithdrawalLegView {
  id: string;
  asset: AssetCode;
  amount: string;
  direction: "out";
}

export interface WithdrawalView {
  id: string;
  asset: AssetCode;
  network: ScreeningNetwork;
  status: WithdrawalStatus;
  amount: string;
  fee: string;
  destinationReference: string;
  legs: readonly WithdrawalLegView[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  posting: "none";
}

export interface WithdrawalsView {
  mode: "test";
  kyc: KycStatus;
  withdrawals: readonly WithdrawalView[];
}

/** Mirrors the customer-api quotes contract pair set exactly. */
export type QuotePair = "USDT/RUB" | "TON/RUB" | "TON/USDT";
export type QuoteSide = "buy" | "sell";
export type QuoteRounding = "up" | "down";

export interface QuoteView {
  id: string;
  pair: QuotePair;
  base: AssetCode;
  quote: AssetCode;
  side: QuoteSide;
  baseAmount: string;
  midPrice: string;
  price: string;
  spreadBps: number;
  feeBps: number;
  quoteAmount: string;
  feeAmount: string;
  totalQuoteAmount: string;
  rounding: QuoteRounding;
  priceObservedAt: number;
  issuedAt: number;
  expiresAt: number;
  ttlSeconds: number;
  status: "indicative";
  execution: "not_supported";
  posting: "none";
}

export interface QuotesView {
  mode: "test";
  kyc: KycStatus;
  quotes: readonly QuoteView[];
}

/** Mirrors the customer-api exchange-orders contract: non-executed orders only. */
export type ExchangeOrderType = "market" | "limit";
export type ExchangeOrderStatus = "open" | "cancelled" | "expired" | "rejected";

export interface ExchangeOrderView {
  id: string;
  pair: QuotePair;
  base: AssetCode;
  quote: AssetCode;
  side: QuoteSide;
  orderType: ExchangeOrderType;
  baseAmount: string;
  price: string;
  quoteAmount: string;
  feeBps: number;
  feeAmount: string;
  totalQuoteAmount: string;
  status: ExchangeOrderStatus;
  createdAt: number;
  updatedAt: number;
  execution: "not_supported";
  posting: "none";
}

export interface ExchangeOrdersView {
  mode: "test";
  kyc: KycStatus;
  orders: readonly ExchangeOrderView[];
}

export interface CheckStatusEntry {
  status: CheckStatus;
  at: number;
}

export interface CheckView {
  /** Opaque synthetic claim reference; in the demo it doubles as the check id. */
  reference: string;
  mode: "test";
  direction: CheckDirection;
  status: CheckStatus;
  asset: AssetCode;
  amount: string;
  fee: string;
  total: string;
  claimRule: "personal";
  comment?: string;
  timeline: readonly CheckStatusEntry[];
  createdAt: number;
  expiresAt: number;
  executable: false;
  executionUnavailableReason: "dev_test_version";
}

export interface ChecksView {
  mode: "test";
  checks: readonly CheckView[];
}

export interface CheckPreview {
  id: string;
  mode: "test";
  asset: AssetCode;
  amount: string;
  fee: string;
  feeAsset: AssetCode;
  feeBps: number;
  total: string;
  claimRule: "personal";
  issuedAt: number;
  expiresAt: number;
  ttlSeconds: number;
  serverTime: number;
  insufficientBalance: boolean;
  kycRequired: boolean;
  executable: false;
  executionUnavailableReason: "dev_test_version";
}
