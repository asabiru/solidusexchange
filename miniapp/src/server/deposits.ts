import type { DepositStatus, DepositsView, DepositView, KycStatus } from "../shared/api.js";

export const depositIdPattern = /^dep_[0-9a-f]{24}$/;
export const depositPaymentReferencePattern = /^SIMSBP[0-9A-F]{12}$/;
export const depositStatuses: readonly DepositStatus[] = Object.freeze([
  "awaiting_payment",
  "payment_received",
  "partial_payment",
  "duplicate_payment",
  "payment_reversed",
  "expired_no_payment"
]);

export function isDepositStatus(value: unknown): value is DepositStatus {
  return typeof value === "string" && (depositStatuses as readonly string[]).includes(value);
}

/** The customer-api deposits contract entry shape (snake_case field names). */
export interface ContractDeposit {
  deposit_id: string;
  asset: DepositView["asset"];
  method: "sbp";
  status: DepositStatus;
  expected_amount: string;
  received_total: string;
  reversed_total: string;
  payment_reference: string;
  created_at: string;
  updated_at: string;
  posting: "none";
}

/**
 * Adapts validated customer-api deposit entries into the app's deposits view:
 * deposit_id becomes id, expected_amount/received_total/reversed_total become
 * expected/received/reversed, payment_reference becomes paymentReference and
 * the ISO timestamps parse to milliseconds. The app keeps its own kyc flag —
 * the contract view has no session-state counterpart.
 */
export function contractDepositsView(deposits: readonly ContractDeposit[], kyc: KycStatus): DepositsView {
  return {
    mode: "test",
    kyc,
    deposits: deposits.map((deposit) => ({
      id: deposit.deposit_id,
      asset: deposit.asset,
      method: "sbp",
      status: deposit.status,
      expected: deposit.expected_amount,
      received: deposit.received_total,
      reversed: deposit.reversed_total,
      paymentReference: deposit.payment_reference,
      createdAt: Date.parse(deposit.created_at),
      updatedAt: Date.parse(deposit.updated_at),
      posting: "none"
    }))
  };
}

const syntheticDeposits: readonly DepositView[] = Object.freeze([
  Object.freeze({
    id: "dep_a1b2c3d4e5f6a7b8c9d0e1f2",
    asset: "RUB",
    method: "sbp",
    status: "payment_received",
    expected: "25000.00",
    received: "25000.00",
    reversed: "0.00",
    paymentReference: "SIMSBPA1B2C3D4E5F6",
    createdAt: Date.parse("2026-10-04T12:10:00.000Z"),
    updatedAt: Date.parse("2026-10-04T12:14:00.000Z"),
    posting: "none"
  }),
  Object.freeze({
    id: "dep_f1e2d3c4b5a6f7e8d9c0b1a2",
    asset: "RUB",
    method: "sbp",
    status: "awaiting_payment",
    expected: "10000.00",
    received: "0.00",
    reversed: "0.00",
    paymentReference: "SIMSBPF6E5D4C3B2A1",
    createdAt: Date.parse("2026-10-06T09:30:00.000Z"),
    updatedAt: Date.parse("2026-10-06T09:30:00.000Z"),
    posting: "none"
  })
]);

const views: Readonly<Record<KycStatus, DepositsView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", deposits: syntheticDeposits }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", deposits: Object.freeze([]) })
});

/**
 * The local synthetic deposits list: a verified session sees the frozen
 * test-mode SBP observations; a gated session sees the same shape emptied in
 * place (like the wallet's zeroed gated view). Observational only — every
 * entry carries posting "none" and nothing here moves money.
 */
export function depositsView(kyc: KycStatus): DepositsView {
  return views[kyc];
}
