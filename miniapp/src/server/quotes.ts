import { createHash } from "node:crypto";
import { type AssetCode, assets, isAssetCode } from "../shared/assets.js";
import type { QuotePreview } from "../shared/api.js";
import { divideRounded, fromUnits, toUnits, DecimalError } from "../shared/decimal.js";

export const priceScale = 8;
export const spreadBps = 50;
export const feeBps = 30;

const priceUnit = 10n ** BigInt(priceScale);
const bpsUnit = 10_000n;

export const midPricesRub: Readonly<Record<AssetCode, bigint>> = Object.freeze({
  RUB: priceUnit,
  USDT: 9_240_000_000n,
  TON: 28_510_000_000n
});

export type QuoteErrorCode = "invalid_pair" | "invalid_amount" | "amount_too_small";

export class QuoteError extends Error {
  constructor(readonly code: QuoteErrorCode) {
    super(code);
    this.name = "QuoteError";
  }
}

export interface QuoteInput {
  from: string;
  to: string;
  amount: string;
}

export interface QuoteContext {
  nowMs: number;
  ttlSeconds: number;
  available?: string;
  kycRequired: boolean;
}

function bidRub(asset: AssetCode): bigint {
  if (asset === "RUB") return priceUnit;
  return (midPricesRub[asset] * (bpsUnit - BigInt(spreadBps))) / bpsUnit;
}

function askRub(asset: AssetCode): bigint {
  if (asset === "RUB") return priceUnit;
  return divideRounded(midPricesRub[asset] * (bpsUnit + BigInt(spreadBps)), bpsUnit, "up");
}

export function valueInRub(asset: AssetCode, amount: string): string {
  const scale = assets[asset].scale;
  const units = toUnits(amount, scale);
  const rubUnits = divideRounded(
    units * midPricesRub[asset],
    10n ** BigInt(scale + priceScale - assets.RUB.scale),
    "half-up"
  );
  return fromUnits(rubUnits, assets.RUB.scale);
}

export function simulateQuote(input: QuoteInput, context: QuoteContext): QuotePreview {
  if (!isAssetCode(input.from) || !isAssetCode(input.to) || input.from === input.to) {
    throw new QuoteError("invalid_pair");
  }
  const from = input.from;
  const to = input.to;
  const fromScale = assets[from].scale;
  const toScale = assets[to].scale;
  let amountUnits: bigint;
  try {
    amountUnits = toUnits(input.amount, fromScale);
  } catch (error) {
    if (error instanceof DecimalError) throw new QuoteError("invalid_amount");
    throw error;
  }
  if (amountUnits <= 0n) throw new QuoteError("invalid_amount");

  const feeUnits = divideRounded(amountUnits * BigInt(feeBps), bpsUnit, "up");
  const netUnits = amountUnits - feeUnits;
  const bid = bidRub(from);
  const ask = askRub(to);
  const outUnits = netUnits <= 0n
    ? 0n
    : divideRounded(
      netUnits * bid * 10n ** BigInt(toScale),
      ask * 10n ** BigInt(fromScale),
      "down"
    );
  if (outUnits <= 0n) throw new QuoteError("amount_too_small");

  const rate = from === "RUB"
    ? { base: to, quote: from, value: fromUnits(ask, priceScale) }
    : to === "RUB"
      ? { base: from, quote: to, value: fromUnits(bid, priceScale) }
      : { base: from, quote: to, value: fromUnits(divideRounded(bid * priceUnit, ask, "down"), priceScale) };

  const amountIn = fromUnits(amountUnits, fromScale);
  const issuedAt = context.nowMs;
  const id = `Q-${createHash("sha256")
    .update(`${from}|${to}|${amountIn}|${issuedAt}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase()}`;
  const insufficientBalance = context.available === undefined
    ? false
    : amountUnits > toUnits(context.available, fromScale);

  return Object.freeze({
    id,
    from,
    to,
    amountIn,
    fee: fromUnits(feeUnits, fromScale),
    feeAsset: from,
    feeBps,
    spreadBps,
    netIn: fromUnits(netUnits, fromScale),
    amountOut: fromUnits(outUnits, toScale),
    total: amountIn,
    rate: Object.freeze(rate),
    issuedAt,
    expiresAt: issuedAt + context.ttlSeconds * 1_000,
    ttlSeconds: context.ttlSeconds,
    serverTime: context.nowMs,
    insufficientBalance,
    kycRequired: context.kycRequired,
    executable: false,
    executionUnavailableReason: "dev_test_version"
  });
}
