import { isDecimalString } from "../shared/decimal.js";
import type { QuoteSide, TradeLiquidity, TradesView, TradeView } from "../shared/api.js";
import { contractQuotePair, quotePriceScale } from "../shared/quote.js";
import type { MessageKey } from "./i18n.js";
import { boundedRows, hasExactKeys, isEpochMs, isKycFlag, isNonNegativeInt, isRecord, type ServedKycRows } from "./served-views.js";

export interface TradeBadge {
  label: MessageKey;
  tone: string;
}

const tradeSides: Readonly<Record<QuoteSide, TradeBadge>> = Object.freeze({
  buy: Object.freeze({ label: "trades.buy", tone: "success" }),
  sell: Object.freeze({ label: "trades.sell", tone: "risk" })
});

const tradeLiquidities: Readonly<Record<TradeLiquidity, TradeBadge>> = Object.freeze({
  maker: Object.freeze({ label: "trades.maker", tone: "muted" }),
  taker: Object.freeze({ label: "trades.taker", tone: "warning" })
});

/** Served side/liquidity tags are untrusted: only declared members resolve. */
export function tradeSideBadge(side: string): TradeBadge | undefined {
  return Object.hasOwn(tradeSides, side) ? tradeSides[side as QuoteSide] : undefined;
}

export function tradeLiquidityBadge(liquidity: string): TradeBadge | undefined {
  return Object.hasOwn(tradeLiquidities, liquidity)
    ? tradeLiquidities[liquidity as TradeLiquidity]
    : undefined;
}

const tradeIdPattern = /^trd_[0-9a-f]{24}$/;
const tradeOrderIdPattern = /^ord_[0-9a-f]{24}$/;

const tradeViewKeys = [
  "id",
  "orderId",
  "pair",
  "base",
  "quote",
  "side",
  "liquidity",
  "price",
  "quantity",
  "quoteAmount",
  "feeBps",
  "feeAmount",
  "totalQuoteAmount",
  "executedAt",
  "execution",
  "posting"
] as const;

function isTradeRow(value: unknown): value is TradeView {
  if (!isRecord(value) || !hasExactKeys(value, tradeViewKeys)) return false;
  if (typeof value.pair !== "string") return false;
  const pairDef = contractQuotePair(value.pair);
  if (pairDef === undefined || value.base !== pairDef.base || value.quote !== pairDef.quote) return false;
  return (
    typeof value.id === "string"
    && tradeIdPattern.test(value.id)
    && typeof value.orderId === "string"
    && tradeOrderIdPattern.test(value.orderId)
    && typeof value.side === "string"
    && tradeSideBadge(value.side) !== undefined
    && typeof value.liquidity === "string"
    && tradeLiquidityBadge(value.liquidity) !== undefined
    && typeof value.price === "string"
    && isDecimalString(value.price, quotePriceScale)
    && typeof value.quantity === "string"
    && isDecimalString(value.quantity, pairDef.baseScale)
    && typeof value.quoteAmount === "string"
    && isDecimalString(value.quoteAmount, pairDef.quoteScale)
    && isNonNegativeInt(value.feeBps)
    && typeof value.feeAmount === "string"
    && isDecimalString(value.feeAmount, pairDef.quoteScale)
    && typeof value.totalQuoteAmount === "string"
    && isDecimalString(value.totalQuoteAmount, pairDef.quoteScale)
    && isEpochMs(value.executedAt)
    && value.execution === "not_supported"
    && value.posting === "none"
  );
}

/** Validates the served trades view like the deposits/withdrawals adapters. */
export function tradesHistory(view: unknown): ServedKycRows<TradeView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "kyc", "trades"])
    || view.mode !== "test"
    || !isKycFlag(view.kyc)
    || !Array.isArray(view.trades)
    || !(view.trades as readonly unknown[]).every(isTradeRow)
  ) {
    return undefined;
  }
  return { kyc: view.kyc, ...boundedRows(view.trades as readonly TradeView[]) };
}
