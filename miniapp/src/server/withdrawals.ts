import type { ScreeningAsset, ScreeningNetwork } from "../shared/address-screening.js";
import type { KycStatus, WithdrawalStatus, WithdrawalView, WithdrawalsView } from "../shared/api.js";

export const withdrawalIdPattern = /^wdr_[0-9a-f]{24}$/;
export const withdrawalLegIdPattern = /^wdl_[0-9a-f]{24}$/;
export const destinationReferencePattern = /^destination_ref_[a-z0-9_]{2,32}$/;
export const withdrawalStatuses: readonly WithdrawalStatus[] = Object.freeze([
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
]);

export function isWithdrawalStatus(value: unknown): value is WithdrawalStatus {
  return typeof value === "string" && (withdrawalStatuses as readonly string[]).includes(value);
}

/**
 * Asset/network pairs mirror the custody-dev-v1 testnet allowlist in
 * packages/custody-core/custody-policy.json exactly (and the upstream
 * withdrawals directory's own allowlist).
 */
export const withdrawalPairs: ReadonlyArray<{ asset: ScreeningAsset; network: ScreeningNetwork }> = Object.freeze([
  Object.freeze({ asset: "TON", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TRON_TESTNET" })
]);

export function isWithdrawalNetwork(value: unknown): value is ScreeningNetwork {
  return value === "TON_TESTNET" || value === "TRON_TESTNET";
}

export function isWithdrawalPair(asset: unknown, network: unknown): asset is ScreeningAsset {
  return (
    typeof asset === "string"
    && isWithdrawalNetwork(network)
    && withdrawalPairs.some((pair) => pair.asset === asset && pair.network === network)
  );
}

/** The customer-api withdrawals contract leg shape (snake_case field names). */
export interface ContractWithdrawalLeg {
  leg_id: string;
  asset: ContractWithdrawal["asset"];
  amount: string;
  direction: "out";
}

/** The customer-api withdrawals contract entry shape (snake_case field names). */
export interface ContractWithdrawal {
  withdrawal_id: string;
  asset: WithdrawalView["asset"];
  network: WithdrawalView["network"];
  status: WithdrawalStatus;
  amount: string;
  fee_amount: string;
  destination_reference: string;
  legs: readonly ContractWithdrawalLeg[];
  created_at: string;
  updated_at: string;
  expires_at: string;
  posting: "none";
}

/**
 * Adapts validated customer-api withdrawal entries into the app's withdrawals
 * view: withdrawal_id becomes id, fee_amount becomes fee, destination_reference
 * becomes destinationReference, leg_id becomes id inside each leg and the ISO
 * timestamps parse to milliseconds. The app keeps its own kyc flag — the
 * contract view has no session-state counterpart.
 */
export function contractWithdrawalsView(withdrawals: readonly ContractWithdrawal[], kyc: KycStatus): WithdrawalsView {
  return {
    mode: "test",
    kyc,
    withdrawals: withdrawals.map((withdrawal) => ({
      id: withdrawal.withdrawal_id,
      asset: withdrawal.asset,
      network: withdrawal.network,
      status: withdrawal.status,
      amount: withdrawal.amount,
      fee: withdrawal.fee_amount,
      destinationReference: withdrawal.destination_reference,
      legs: withdrawal.legs.map((leg) => ({
        id: leg.leg_id,
        asset: leg.asset,
        amount: leg.amount,
        direction: leg.direction
      })),
      createdAt: Date.parse(withdrawal.created_at),
      updatedAt: Date.parse(withdrawal.updated_at),
      expiresAt: Date.parse(withdrawal.expires_at),
      posting: "none"
    }))
  };
}

const syntheticWithdrawals: readonly WithdrawalView[] = Object.freeze([
  Object.freeze({
    id: "wdr_a1b2c3d4e5f6a7b8c9d0e1f2",
    asset: "USDT",
    network: "TRON_TESTNET",
    status: "confirmed",
    amount: "25.000000",
    fee: "0.125000",
    destinationReference: "destination_ref_a1b2c3d4e5f6a7b8",
    legs: Object.freeze([
      Object.freeze({ id: "wdl_b1c2d3e4f5a6b7c8d9e0f1a2", asset: "USDT", amount: "25.000000", direction: "out" }),
      Object.freeze({ id: "wdl_c1d2e3f4a5b6c7d8e9f0a1b2", asset: "USDT", amount: "0.125000", direction: "out" })
    ]),
    createdAt: Date.parse("2026-10-02T14:05:00.000Z"),
    updatedAt: Date.parse("2026-10-02T14:20:00.000Z"),
    expiresAt: Date.parse("2026-10-02T14:10:00.000Z"),
    posting: "none"
  }),
  Object.freeze({
    id: "wdr_f1e2d3c4b5a6f7e8d9c0b1a2",
    asset: "TON",
    network: "TON_TESTNET",
    status: "pending_maker_approval",
    amount: "2.000000000",
    fee: "0.010000000",
    destinationReference: "destination_ref_f1e2d3c4b5a6f7e8",
    legs: Object.freeze([
      Object.freeze({ id: "wdl_d1e2f3a4b5c6d7e8f9a0b1c2", asset: "TON", amount: "2.000000000", direction: "out" }),
      Object.freeze({ id: "wdl_e1f2a3b4c5d6e7f8a9b0c1d2", asset: "TON", amount: "0.010000000", direction: "out" })
    ]),
    createdAt: Date.parse("2026-10-07T10:40:00.000Z"),
    updatedAt: Date.parse("2026-10-07T10:44:00.000Z"),
    expiresAt: Date.parse("2026-10-07T10:45:00.000Z"),
    posting: "none"
  })
]);

const views: Readonly<Record<KycStatus, WithdrawalsView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", withdrawals: syntheticWithdrawals }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", withdrawals: Object.freeze([]) })
});

/**
 * The local synthetic withdrawals list: a verified session sees the frozen
 * test-mode custody-lifecycle observations; a gated session sees the same
 * shape emptied in place (like the wallet's zeroed gated view). Observational
 * only — every entry carries posting "none" and nothing here moves money.
 */
export function withdrawalsView(kyc: KycStatus): WithdrawalsView {
  return views[kyc];
}
