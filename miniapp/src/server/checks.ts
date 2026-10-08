import { createHash } from "node:crypto";
import type { CheckPreview, CheckStatusEntry, CheckView, ChecksView, KycStatus } from "../shared/api.js";
import { type AssetCode, assets, isAssetCode } from "../shared/assets.js";
import { checkReferencePattern, type CheckDirection, type CheckStatus, effectiveCheckStatus } from "../shared/checks.js";
import { DecimalError, divideRounded, fromUnits, toUnits } from "../shared/decimal.js";

export const checkFeeBps = 30;
export const defaultCheckTtlSeconds = 72 * 3_600;

const bpsUnit = 10_000n;

export type CheckErrorCode = "invalid_asset" | "invalid_amount";

export class CheckError extends Error {
  constructor(readonly code: CheckErrorCode) {
    super(code);
    this.name = "CheckError";
  }
}

export interface CheckPreviewInput {
  asset: string;
  amount: string;
}

export interface CheckPreviewContext {
  nowMs: number;
  available?: string;
  kycRequired: boolean;
}

export interface CheckBookOptions {
  clock: () => number;
  ttlSeconds?: number;
}

export interface CheckBook {
  preview(input: CheckPreviewInput, context: CheckPreviewContext): CheckPreview;
  list(kyc: KycStatus): ChecksView;
  view(reference: string, kyc: KycStatus): CheckView | undefined;
}

interface Fixture {
  reference: string;
  direction: CheckDirection;
  status: CheckStatus;
  asset: AssetCode;
  amount: string;
  comment?: string;
  /** ms before "now" the check was created. */
  createdAgoMs: number;
  /** ms between creation and the current terminal status; omit while the check is open. */
  statusAfterMs?: number;
}

const fixtures: readonly Fixture[] = Object.freeze([
  {
    reference: "chk_7f3a9c1e5d2b4f8a0e6c1d3b",
    direction: "sent",
    status: "created",
    asset: "USDT",
    amount: "25.000000",
    comment: "Возврат долга",
    createdAgoMs: 3 * 3_600_000
  },
  {
    reference: "chk_2b8d4f6a0c1e3b5d7f9a2c4e",
    direction: "received",
    status: "created",
    asset: "USDT",
    amount: "10.000000",
    createdAgoMs: 5 * 3_600_000
  },
  {
    reference: "chk_5e7a9c2e4d6b8f0a1c3e5d7b",
    direction: "received",
    status: "claimed",
    asset: "TON",
    amount: "4.000000000",
    createdAgoMs: 30 * 3_600_000,
    statusAfterMs: 5 * 3_600_000
  },
  {
    reference: "chk_9d1b3f5a7c9e1d3f5a7b9c1e",
    direction: "sent",
    status: "cancelled",
    asset: "USDT",
    amount: "15.000000",
    createdAgoMs: 50 * 3_600_000,
    statusAfterMs: 10 * 3_600_000
  },
  {
    reference: "chk_4c6e8a0d2f4b6d8f0a2c4e6a",
    direction: "sent",
    status: "expired",
    asset: "USDT",
    amount: "7.500000",
    createdAgoMs: 90 * 3_600_000,
    statusAfterMs: defaultCheckTtlSeconds * 1_000
  }
]);

function feeOf(asset: AssetCode, amount: string): bigint {
  return divideRounded(toUnits(amount, assets[asset].scale) * BigInt(checkFeeBps), bpsUnit, "up");
}

function freezeView(view: CheckView): CheckView {
  return Object.freeze({ ...view, timeline: Object.freeze(view.timeline.map((entry) => Object.freeze({ ...entry }))) });
}

/**
 * Deterministic test-mode checks. Fixtures are computed from the injected
 * clock only: no I/O, no randomness, no Telegram calls, and nothing ever
 * reserves or moves funds. Preview mirrors the quote preview shape.
 */
export function createCheckBook(options: CheckBookOptions): CheckBook {
  const ttlSeconds = options.ttlSeconds ?? defaultCheckTtlSeconds;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) throw new RangeError("check TTL must be a positive integer");

  function fixtureView(fixture: Fixture, now: number, kyc: KycStatus): CheckView {
    const scale = assets[fixture.asset].scale;
    const amountUnits = toUnits(fixture.amount, scale);
    const feeUnits = feeOf(fixture.asset, fixture.amount);
    const createdAt = now - fixture.createdAgoMs;
    const timeline: CheckStatusEntry[] = [{ status: "created", at: createdAt }];
    if (fixture.statusAfterMs !== undefined) timeline.push({ status: fixture.status, at: createdAt + fixture.statusAfterMs });
    return freezeView({
      reference: fixture.reference,
      mode: "test",
      direction: fixture.direction,
      status: effectiveCheckStatus(fixture.status, fixture.direction, kyc),
      asset: fixture.asset,
      amount: fixture.amount,
      fee: fromUnits(feeUnits, scale),
      total: fromUnits(amountUnits + feeUnits, scale),
      claimRule: "personal",
      ...(fixture.comment ? { comment: fixture.comment } : {}),
      timeline,
      createdAt,
      expiresAt: createdAt + ttlSeconds * 1_000,
      executable: false,
      executionUnavailableReason: "dev_test_version"
    });
  }

  return Object.freeze({
    preview(input: CheckPreviewInput, context: CheckPreviewContext): CheckPreview {
      if (!isAssetCode(input.asset)) throw new CheckError("invalid_asset");
      const asset = input.asset;
      const scale = assets[asset].scale;
      let amountUnits: bigint;
      try {
        amountUnits = toUnits(input.amount, scale);
      } catch (error) {
        if (error instanceof DecimalError) throw new CheckError("invalid_amount");
        throw error;
      }
      if (amountUnits <= 0n) throw new CheckError("invalid_amount");
      const feeUnits = divideRounded(amountUnits * BigInt(checkFeeBps), bpsUnit, "up");
      const amount = fromUnits(amountUnits, scale);
      const issuedAt = context.nowMs;
      const id = `CHK-${createHash("sha256")
        .update(`${asset}|${amount}|${issuedAt}`)
        .digest("hex")
        .slice(0, 12)
        .toUpperCase()}`;
      return Object.freeze({
        id,
        mode: "test",
        asset,
        amount,
        fee: fromUnits(feeUnits, scale),
        feeAsset: asset,
        feeBps: checkFeeBps,
        total: fromUnits(amountUnits + feeUnits, scale),
        claimRule: "personal",
        issuedAt,
        expiresAt: issuedAt + ttlSeconds * 1_000,
        ttlSeconds,
        serverTime: context.nowMs,
        insufficientBalance: context.available === undefined
          ? false
          : amountUnits + feeUnits > toUnits(context.available, scale),
        kycRequired: context.kycRequired,
        executable: false,
        executionUnavailableReason: "dev_test_version"
      });
    },

    list(kyc: KycStatus): ChecksView {
      const now = options.clock();
      return Object.freeze({
        mode: "test",
        checks: Object.freeze(fixtures.map((fixture) => fixtureView(fixture, now, kyc)))
      });
    },

    view(reference: string, kyc: KycStatus): CheckView | undefined {
      if (!checkReferencePattern.test(reference)) return undefined;
      const fixture = fixtures.find((entry) => entry.reference === reference);
      return fixture ? fixtureView(fixture, options.clock(), kyc) : undefined;
    }
  });
}
