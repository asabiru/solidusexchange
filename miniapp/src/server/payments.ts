import type { KycStatus, PaymentsView, PaymentStatus, PaymentView } from "../shared/api.js";

export const paymentIdPattern = /^pay_[0-9a-f]{24}$/;
export const paymentRecipientReferencePattern = /^recipient_ref_[a-z0-9_]{2,32}$/;
export const paymentProviderReferencePattern = /^SIMBANK[0-9A-F]{16}$/;
export const paymentRubScale = 2;
export const paymentStatuses: readonly PaymentStatus[] = Object.freeze([
  "created",
  "processing",
  "completed",
  "failed",
  "reversed",
  "cancelled",
  "expired"
]);
// The rail observed — and therefore referenced — the payment in exactly
// these states; created/cancelled/expired instructions never reached the
// bank, so their provider reference stays null (mirrors the contract).
export const paymentRailObservedStatuses: readonly PaymentStatus[] = Object.freeze([
  "processing",
  "completed",
  "failed",
  "reversed"
]);

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (paymentStatuses as readonly string[]).includes(value);
}

/** The customer-api payments contract entry shape (snake_case field names). */
export interface ContractPayment {
  payment_id: string;
  asset: "RUB";
  method: "sbp";
  status: PaymentStatus;
  amount: string;
  fee_amount: string;
  total_amount: string;
  recipient_reference: string;
  provider_reference: string | null;
  created_at: string;
  updated_at: string;
  posting: "none";
}

/**
 * Adapts validated customer-api payment entries into the app's payments
 * view: payment_id becomes id, fee_amount/total_amount become fee/total,
 * recipient_reference/provider_reference become camelCase and the ISO
 * timestamps parse to milliseconds. The app keeps its own kyc flag — the
 * contract view has no session-state counterpart.
 */
export function contractPaymentsView(payments: readonly ContractPayment[], kyc: KycStatus): PaymentsView {
  return {
    mode: "test",
    kyc,
    payments: payments.map((payment) => ({
      id: payment.payment_id,
      asset: payment.asset,
      method: "sbp",
      status: payment.status,
      amount: payment.amount,
      fee: payment.fee_amount,
      total: payment.total_amount,
      recipientReference: payment.recipient_reference,
      providerReference: payment.provider_reference,
      createdAt: Date.parse(payment.created_at),
      updatedAt: Date.parse(payment.updated_at),
      posting: "none"
    }))
  };
}

const syntheticPayments: readonly PaymentView[] = Object.freeze([
  Object.freeze({
    id: "pay_a1b2c3d4e5f6a7b8c9d0e1f2",
    asset: "RUB",
    method: "sbp",
    status: "completed",
    amount: "1500.00",
    fee: "7.50",
    total: "1507.50",
    recipientReference: "recipient_ref_a1b2c3d4",
    providerReference: "SIMBANKA1B2C3D4E5F6A7B8",
    createdAt: Date.parse("2026-10-05T11:20:00.000Z"),
    updatedAt: Date.parse("2026-10-05T11:24:00.000Z"),
    posting: "none"
  }),
  Object.freeze({
    id: "pay_f1e2d3c4b5a6f7e8d9c0b1a2",
    asset: "RUB",
    method: "sbp",
    status: "created",
    amount: "800.00",
    fee: "2.00",
    total: "802.00",
    recipientReference: "recipient_ref_f6e5d4c3",
    providerReference: null,
    createdAt: Date.parse("2026-10-08T09:15:00.000Z"),
    updatedAt: Date.parse("2026-10-08T09:15:00.000Z"),
    posting: "none"
  })
]);

const views: Readonly<Record<KycStatus, PaymentsView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", payments: syntheticPayments }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", payments: Object.freeze([]) })
});

/**
 * The local synthetic payments list: a verified session sees the frozen
 * test-mode outbound SBP payment observations; a gated session sees the
 * same shape emptied in place (like the deposits gated view).
 * Observational only — every entry carries posting "none" and nothing
 * here moves money.
 */
export function paymentsView(kyc: KycStatus): PaymentsView {
  return views[kyc];
}
