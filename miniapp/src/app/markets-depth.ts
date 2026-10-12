import { isDecimalString } from "../shared/decimal.js";
import type { MarketDepthView, MarketLastTradeView, MarketLevelView, MarketsView, MarketView } from "../shared/api.js";
import { contractQuotePair, quotePriceScale } from "../shared/quote.js";
import { boundedRows, hasExactKeys, isEpochMs, isKycFlag, isNonNegativeInt, isRecord, servedRowsLimit, type ServedKycRows } from "./served-views.js";

/**
 * The contract caps the served ladder: `depthLevels` reports the deeper
 * side's level count before the cap applied, so the book renders
 * truncated exactly when that count exceeds the served side.
 */
export function depthTruncated(
  depth: Pick<MarketDepthView, "bids" | "asks" | "depthLevels">
): boolean {
  return depth.depthLevels > Math.max(depth.bids.length, depth.asks.length);
}

function isDepthLevel(value: unknown, baseScale: number, priceScale: number): value is MarketLevelView {
  return (
    isRecord(value)
    && hasExactKeys(value, ["price", "quantity", "orderCount"])
    && typeof value.price === "string"
    && isDecimalString(value.price, priceScale)
    && typeof value.quantity === "string"
    && isDecimalString(value.quantity, baseScale)
    && isNonNegativeInt(value.orderCount)
  );
}

function isMarketLastTrade(value: unknown, baseScale: number, priceScale: number): value is MarketLastTradeView {
  return (
    isRecord(value)
    && hasExactKeys(value, ["price", "quantity", "executedAt"])
    && typeof value.price === "string"
    && isDecimalString(value.price, priceScale)
    && typeof value.quantity === "string"
    && isDecimalString(value.quantity, baseScale)
    && isEpochMs(value.executedAt)
  );
}

const marketViewKeys = [
  "instrument",
  "base",
  "quote",
  "bestBid",
  "bestAsk",
  "lastTrade",
  "spreadBps",
  "baseScale",
  "quoteScale",
  "priceScale",
  "asOf",
  "posting"
] as const;

function isMarketRow(value: unknown): value is MarketView {
  if (!isRecord(value) || !hasExactKeys(value, marketViewKeys)) return false;
  if (typeof value.instrument !== "string") return false;
  const pairDef = contractQuotePair(value.instrument);
  if (pairDef === undefined) return false;
  if (value.base !== pairDef.base || value.quote !== pairDef.quote) return false;
  if (value.baseScale !== pairDef.baseScale || value.quoteScale !== pairDef.quoteScale) return false;
  // priceScale is renderer input (fractionDigits) — bound it to a sane integer.
  if (!isNonNegativeInt(value.priceScale) || (value.priceScale as number) > quotePriceScale) return false;
  const baseScale = value.baseScale as number;
  const quoteScale = value.quoteScale as number;
  const priceScale = value.priceScale as number;
  const levelOk = (level: unknown) => level === null || isDepthLevel(level, baseScale, priceScale);
  return (
    levelOk(value.bestBid)
    && levelOk(value.bestAsk)
    && (value.lastTrade === null || isMarketLastTrade(value.lastTrade, baseScale, priceScale))
    && (value.spreadBps === null || isNonNegativeInt(value.spreadBps))
    && isEpochMs(value.asOf)
    && value.posting === "none"
  );
}

const depthViewKeys = [
  "mode",
  "instrument",
  "base",
  "quote",
  "bids",
  "asks",
  "lastTrade",
  "depthLevels",
  "baseScale",
  "quoteScale",
  "priceScale",
  "asOf",
  "posting"
] as const;

/** Validates the served markets collection (exact keys, contract pair/scales). */
export function marketsViewOf(view: unknown): ServedKycRows<MarketView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "kyc", "markets"])
    || view.mode !== "test"
    || !isKycFlag(view.kyc)
    || !Array.isArray(view.markets)
    || !(view.markets as readonly unknown[]).every(isMarketRow)
  ) {
    return undefined;
  }
  return { kyc: view.kyc, ...boundedRows(view.markets as readonly MarketView[]) };
}

/** Validates the served market-depth view, bounding each side to the shared served cap. */
export function marketDepthOf(view: unknown): MarketDepthView | undefined {
  if (!isRecord(view) || !hasExactKeys(view, depthViewKeys) || view.mode !== "test") return undefined;
  if (typeof view.instrument !== "string") return undefined;
  const pairDef = contractQuotePair(view.instrument);
  if (pairDef === undefined || view.base !== pairDef.base || view.quote !== pairDef.quote) return undefined;
  if (view.baseScale !== pairDef.baseScale || view.quoteScale !== pairDef.quoteScale) return undefined;
  if (!isNonNegativeInt(view.priceScale) || (view.priceScale as number) > quotePriceScale) return undefined;
  const baseScale = view.baseScale as number;
  const quoteScale = view.quoteScale as number;
  const priceScale = view.priceScale as number;
  if (
    !Array.isArray(view.bids)
    || !Array.isArray(view.asks)
    || !(view.bids as readonly unknown[]).every((level) => isDepthLevel(level, baseScale, priceScale))
    || !(view.asks as readonly unknown[]).every((level) => isDepthLevel(level, baseScale, priceScale))
    || !(view.lastTrade === null || isMarketLastTrade(view.lastTrade, baseScale, priceScale))
    || !isNonNegativeInt(view.depthLevels)
    || !isEpochMs(view.asOf)
    || view.posting !== "none"
  ) {
    return undefined;
  }
  return {
    ...(view as unknown as MarketDepthView),
    bids: (view.bids as readonly MarketLevelView[]).slice(0, servedRowsLimit),
    asks: (view.asks as readonly MarketLevelView[]).slice(0, servedRowsLimit)
  };
}
