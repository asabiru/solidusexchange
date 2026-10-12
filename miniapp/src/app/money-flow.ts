import { screeningTargetOf } from "../shared/address-screening.js";
import { assetMetaOf } from "../shared/assets.js";
import { isDecimalString } from "../shared/decimal.js";
import type {
  DepositStatus,
  DepositView,
  KycStatus,
  WithdrawalLegView,
  WithdrawalStatus,
  WithdrawalView
} from "../shared/api.js";
import type { MessageKey } from "./i18n.js";
import { contractActivityToneOf } from "./server-fields.js";

/**
 * The /bff/deposits and /bff/withdrawals payloads are untrusted input: a view
 * renders only when its keys, ids, enums and decimals match the contract view
 * model exactly, and the rendered history stays bounded. A foreign or
 * malformed view resolves to undefined — the sheet fails closed to its
 * load-failed state instead of rendering drifted money fields.
 */
export const moneyHistoryLimit = 50;

export interface MoneyFlowBadge {
  label: MessageKey;
  tone: string;
}

const depositStatuses: Readonly<Record<DepositStatus, MessageKey>> = {
  awaiting_payment: "deposit.statusAwaitingPayment",
  payment_received: "deposit.statusPaymentReceived",
  partial_payment: "deposit.statusPartialPayment",
  duplicate_payment: "deposit.statusDuplicatePayment",
  payment_reversed: "deposit.statusPaymentReversed",
  expired_no_payment: "deposit.statusExpiredNoPayment"
};

const withdrawalStatuses: Readonly<Record<WithdrawalStatus, MessageKey>> = {
  draft: "withdraw.statusDraft",
  screened: "withdraw.statusScreened",
  pending_maker_approval: "withdraw.statusPendingMaker",
  pending_checker_approval: "withdraw.statusPendingChecker",
  unsigned_intent_ready: "withdraw.statusIntentReady",
  broadcast: "withdraw.statusBroadcast",
  confirmed: "withdraw.statusConfirmed",
  rejected: "withdraw.statusRejected",
  cancelled: "withdraw.statusCancelled",
  expired: "withdraw.statusExpired"
};

const depositMethods: Readonly<Record<DepositView["method"], MessageKey>> = {
  sbp: "deposit.methodSbp"
};

function member<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Status tones come from the shared contract-activity map so pills match the operations feed. */
export function depositStatusBadge(status: string): MoneyFlowBadge | undefined {
  const label = member(depositStatuses, status);
  return label === undefined ? undefined : { label, tone: contractActivityToneOf(status) };
}

export function withdrawalStatusBadge(status: string): MoneyFlowBadge | undefined {
  const label = member(withdrawalStatuses, status);
  return label === undefined ? undefined : { label, tone: contractActivityToneOf(status) };
}

export function depositMethodKey(method: string): MessageKey | undefined {
  return member(depositMethods, method);
}

const depositIdPattern = /^dep_[0-9a-f]{24}$/;
const depositReferencePattern = /^SIMSBP[0-9A-F]{12}$/;
const withdrawalIdPattern = /^wdr_[0-9a-f]{24}$/;
const withdrawalLegIdPattern = /^wdl_[0-9a-f]{24}$/;
const destinationReferencePattern = /^destination_ref_[a-z0-9_]{2,32}$/;

const depositKeys = [
  "id",
  "asset",
  "method",
  "status",
  "expected",
  "received",
  "reversed",
  "paymentReference",
  "createdAt",
  "updatedAt",
  "posting"
] as const;
const withdrawalKeys = [
  "id",
  "asset",
  "network",
  "status",
  "amount",
  "fee",
  "destinationReference",
  "legs",
  "createdAt",
  "updatedAt",
  "expiresAt",
  "posting"
] as const;
const withdrawalLegKeys = ["id", "asset", "amount", "direction"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDepositRow(value: unknown): value is DepositView {
  if (!isRecord(value) || !hasExactKeys(value, depositKeys)) return false;
  if (typeof value.asset !== "string") return false;
  const meta = assetMetaOf(value.asset);
  return (
    typeof value.id === "string"
    && depositIdPattern.test(value.id)
    && meta !== undefined
    && value.method === "sbp"
    && typeof value.status === "string"
    && member(depositStatuses, value.status) !== undefined
    && typeof value.expected === "string"
    && typeof value.received === "string"
    && typeof value.reversed === "string"
    && isDecimalString(value.expected, meta.scale)
    && isDecimalString(value.received, meta.scale)
    && isDecimalString(value.reversed, meta.scale)
    && typeof value.paymentReference === "string"
    && depositReferencePattern.test(value.paymentReference)
    && isEpochMs(value.createdAt)
    && isEpochMs(value.updatedAt)
    && value.posting === "none"
  );
}

function isWithdrawalLegRow(value: unknown, asset: string, scale: number): value is WithdrawalLegView {
  if (!isRecord(value) || !hasExactKeys(value, withdrawalLegKeys)) return false;
  return (
    typeof value.id === "string"
    && withdrawalLegIdPattern.test(value.id)
    && value.asset === asset
    && typeof value.amount === "string"
    && isDecimalString(value.amount, scale)
    && value.direction === "out"
  );
}

function isWithdrawalRow(value: unknown): value is WithdrawalView {
  if (!isRecord(value) || !hasExactKeys(value, withdrawalKeys)) return false;
  const { asset, network, amount, fee, legs } = value;
  if (typeof asset !== "string" || typeof network !== "string") return false;
  const meta = assetMetaOf(asset);
  if (meta === undefined || !Array.isArray(legs)) return false;
  return (
    typeof value.id === "string"
    && withdrawalIdPattern.test(value.id)
    && screeningTargetOf(asset, network) !== undefined
    && typeof value.status === "string"
    && member(withdrawalStatuses, value.status) !== undefined
    && typeof amount === "string"
    && typeof fee === "string"
    && isDecimalString(amount, meta.scale)
    && isDecimalString(fee, meta.scale)
    && typeof value.destinationReference === "string"
    && destinationReferencePattern.test(value.destinationReference)
    // The contract's two out-legs are the principal first and the fee second.
    && legs.length === 2
    && (legs as readonly unknown[]).every(
      (leg, index) =>
        isWithdrawalLegRow(leg, asset, meta.scale)
        && leg.amount === (index === 0 ? amount : fee)
    )
    && isEpochMs(value.createdAt)
    && isEpochMs(value.updatedAt)
    && isEpochMs(value.expiresAt)
    && value.posting === "none"
  );
}

export interface MoneyHistory<T> {
  kyc: KycStatus;
  rows: readonly T[];
  /** Row count before the served cap applied — drives the truncation note. */
  total: number;
}

function isKycFlag(value: unknown): value is KycStatus {
  return value === "verified" || value === "kyc-gated";
}

/**
 * Validates the served deposits view: exact keys and the declared id, status,
 * method, reference and decimal grammar on every row, or undefined. Valid
 * histories render truncated to moneyHistoryLimit.
 */
export function depositHistory(view: unknown): MoneyHistory<DepositView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "kyc", "deposits"])
    || view.mode !== "test"
    || !isKycFlag(view.kyc)
    || !Array.isArray(view.deposits)
    || !(view.deposits as readonly unknown[]).every(isDepositRow)
  ) {
    return undefined;
  }
  return {
    kyc: view.kyc,
    rows: (view.deposits as readonly DepositView[]).slice(0, moneyHistoryLimit),
    total: view.deposits.length
  };
}

export function withdrawalHistory(view: unknown): MoneyHistory<WithdrawalView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "kyc", "withdrawals"])
    || view.mode !== "test"
    || !isKycFlag(view.kyc)
    || !Array.isArray(view.withdrawals)
    || !(view.withdrawals as readonly unknown[]).every(isWithdrawalRow)
  ) {
    return undefined;
  }
  return {
    kyc: view.kyc,
    rows: (view.withdrawals as readonly WithdrawalView[]).slice(0, moneyHistoryLimit),
    total: view.withdrawals.length
  };
}
