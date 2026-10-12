import { isDecimalString } from "../shared/decimal.js";
import type { ExchangeOrdersView, ExchangeOrderStatus, ExchangeOrderType, ExchangeOrderView, QuoteSide } from "../shared/api.js";
import { contractQuotePair, quotePriceScale } from "../shared/quote.js";
import type { MessageKey } from "./i18n.js";
import { boundedRows, hasExactKeys, isEpochMs, isKycFlag, isNonNegativeInt, isRecord, type ServedKycRows } from "./served-views.js";

export interface OrderBadge {
  label: MessageKey;
  tone: string;
}

const orderSides: Readonly<Record<QuoteSide, OrderBadge>> = Object.freeze({
  buy: Object.freeze({ label: "orders.buy", tone: "success" }),
  sell: Object.freeze({ label: "orders.sell", tone: "risk" })
});

const orderTypes: Readonly<Record<ExchangeOrderType, OrderBadge>> = Object.freeze({
  market: Object.freeze({ label: "orders.market", tone: "warning" }),
  limit: Object.freeze({ label: "orders.limit", tone: "muted" })
});

const orderStatuses: Readonly<Record<ExchangeOrderStatus, OrderBadge>> = Object.freeze({
  open: Object.freeze({ label: "orders.open", tone: "success" }),
  cancelled: Object.freeze({ label: "orders.cancelled", tone: "muted" }),
  expired: Object.freeze({ label: "orders.expired", tone: "warning" }),
  rejected: Object.freeze({ label: "orders.rejected", tone: "risk" })
});

/** Served side/type/status tags are untrusted: only declared members resolve. */
export function orderSideBadge(side: string): OrderBadge | undefined {
  return Object.hasOwn(orderSides, side) ? orderSides[side as QuoteSide] : undefined;
}

export function orderTypeBadge(orderType: string): OrderBadge | undefined {
  return Object.hasOwn(orderTypes, orderType)
    ? orderTypes[orderType as ExchangeOrderType]
    : undefined;
}

export function orderStatusBadge(status: string): OrderBadge | undefined {
  return Object.hasOwn(orderStatuses, status)
    ? orderStatuses[status as ExchangeOrderStatus]
    : undefined;
}

const orderIdPattern = /^ord_[0-9a-f]{24}$/;

const orderViewKeys = [
  "id",
  "pair",
  "base",
  "quote",
  "side",
  "orderType",
  "baseAmount",
  "price",
  "quoteAmount",
  "feeBps",
  "feeAmount",
  "totalQuoteAmount",
  "status",
  "createdAt",
  "updatedAt",
  "execution",
  "posting"
] as const;

function isOrderRow(value: unknown): value is ExchangeOrderView {
  if (!isRecord(value) || !hasExactKeys(value, orderViewKeys)) return false;
  if (typeof value.pair !== "string") return false;
  const pairDef = contractQuotePair(value.pair);
  if (pairDef === undefined || value.base !== pairDef.base || value.quote !== pairDef.quote) return false;
  return (
    typeof value.id === "string"
    && orderIdPattern.test(value.id)
    && typeof value.side === "string"
    && orderSideBadge(value.side) !== undefined
    && typeof value.orderType === "string"
    && orderTypeBadge(value.orderType) !== undefined
    && typeof value.status === "string"
    && orderStatusBadge(value.status) !== undefined
    && typeof value.baseAmount === "string"
    && isDecimalString(value.baseAmount, pairDef.baseScale)
    && typeof value.price === "string"
    && isDecimalString(value.price, quotePriceScale)
    && typeof value.quoteAmount === "string"
    && isDecimalString(value.quoteAmount, pairDef.quoteScale)
    && isNonNegativeInt(value.feeBps)
    && typeof value.feeAmount === "string"
    && isDecimalString(value.feeAmount, pairDef.quoteScale)
    && typeof value.totalQuoteAmount === "string"
    && isDecimalString(value.totalQuoteAmount, pairDef.quoteScale)
    && isEpochMs(value.createdAt)
    && isEpochMs(value.updatedAt)
    && value.execution === "not_supported"
    && value.posting === "none"
  );
}

/** Validates the served exchange-orders view like the deposits/withdrawals adapters. */
export function ordersHistory(view: unknown): ServedKycRows<ExchangeOrderView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "kyc", "orders"])
    || view.mode !== "test"
    || !isKycFlag(view.kyc)
    || !Array.isArray(view.orders)
    || !(view.orders as readonly unknown[]).every(isOrderRow)
  ) {
    return undefined;
  }
  return { kyc: view.kyc, ...boundedRows(view.orders as readonly ExchangeOrderView[]) };
}
