import type {
  ExchangeOrderStatus,
  ExchangeOrderType,
  ExchangeOrdersView,
  ExchangeOrderView,
  KycStatus,
  QuotePair,
  QuoteSide
} from "../shared/api.js";
import type { AssetCode } from "../shared/assets.js";
import { divideRounded } from "../shared/decimal.js";
import type { ContractQuotePair } from "./quotes.js";

export const exchangeOrderIdPattern = /^ord_[0-9a-f]{24}$/;
export const exchangeOrderPriceScale = 8;
export const exchangeOrderMaxBps = 1_000;
export const exchangeOrderTypes: readonly ExchangeOrderType[] = Object.freeze(["market", "limit"]);
export const exchangeOrderStatuses: readonly ExchangeOrderStatus[] = Object.freeze([
  "open",
  "cancelled",
  "expired",
  "rejected"
]);

export function isExchangeOrderType(value: unknown): value is ExchangeOrderType {
  return typeof value === "string" && (exchangeOrderTypes as readonly string[]).includes(value);
}

export function isExchangeOrderStatus(value: unknown): value is ExchangeOrderStatus {
  return typeof value === "string" && (exchangeOrderStatuses as readonly string[]).includes(value);
}

/**
 * Contract-faithful derived amounts — the quote-leg units, the (always
 * customer-unfriendly rounded) fee and the payable or receivable total —
 * mirroring the upstream contract validator's computeAmounts with the order's
 * fixed price so a strict parse fails closed on amounts that do not recompute
 * exactly.
 */
export function contractExchangeOrderAmounts(
  pairDef: ContractQuotePair,
  side: QuoteSide,
  baseAmountUnits: bigint,
  priceUnits: bigint,
  feeBps: number
): { quoteUnits: bigint; fee: bigint; total: bigint } {
  const buy = side === "buy";
  const quoteUnits = divideRounded(
    baseAmountUnits * priceUnits * 10n ** BigInt(pairDef.quoteScale),
    10n ** BigInt(pairDef.baseScale + exchangeOrderPriceScale),
    buy ? "up" : "down"
  );
  const fee = divideRounded(quoteUnits * BigInt(feeBps), 10_000n, "up");
  const total = buy ? quoteUnits + fee : quoteUnits - fee;
  return { quoteUnits, fee, total };
}

/** The customer-api exchange-orders contract entry shape (snake_case field names). */
export interface ContractExchangeOrder {
  order_id: string;
  pair: QuotePair;
  base_asset: AssetCode;
  quote_asset: AssetCode;
  side: QuoteSide;
  order_type: ExchangeOrderType;
  base_amount: string;
  price: string;
  quote_amount: string;
  fee_bps: number;
  fee_amount: string;
  total_quote_amount: string;
  status: ExchangeOrderStatus;
  created_at: string;
  updated_at: string;
  execution: "not_supported";
  posting: "none";
}

/**
 * Adapts validated customer-api exchange-order entries into the app's orders
 * view: order_id becomes id, order_type becomes orderType, the asset and
 * decimal fields become camelCase and the ISO timestamps parse to
 * milliseconds. The app keeps its own kyc flag — the contract view has no
 * session-state counterpart.
 */
export function contractExchangeOrdersView(
  orders: readonly ContractExchangeOrder[],
  kyc: KycStatus
): ExchangeOrdersView {
  return {
    mode: "test",
    kyc,
    orders: orders.map((order) => ({
      id: order.order_id,
      pair: order.pair,
      base: order.base_asset,
      quote: order.quote_asset,
      side: order.side,
      orderType: order.order_type,
      baseAmount: order.base_amount,
      price: order.price,
      quoteAmount: order.quote_amount,
      feeBps: order.fee_bps,
      feeAmount: order.fee_amount,
      totalQuoteAmount: order.total_quote_amount,
      status: order.status,
      createdAt: Date.parse(order.created_at),
      updatedAt: Date.parse(order.updated_at),
      execution: "not_supported",
      posting: "none"
    }))
  };
}

const syntheticOrders: readonly ExchangeOrderView[] = Object.freeze([
  Object.freeze({
    id: "ord_a1b2c3d4e5f6a7b8c9d0e1f2",
    pair: "USDT/RUB",
    base: "USDT",
    quote: "RUB",
    side: "sell",
    orderType: "limit",
    baseAmount: "25.000000",
    price: "89.77500000",
    quoteAmount: "2244.37",
    feeBps: 30,
    feeAmount: "6.74",
    totalQuoteAmount: "2237.63",
    status: "open",
    createdAt: Date.parse("2026-10-02T14:05:00.000Z"),
    updatedAt: Date.parse("2026-10-02T14:05:00.000Z"),
    execution: "not_supported",
    posting: "none"
  }),
  Object.freeze({
    id: "ord_f1e2d3c4b5a6f7e8d9c0b1a2",
    pair: "TON/USDT",
    base: "TON",
    quote: "USDT",
    side: "buy",
    orderType: "market",
    baseAmount: "2.000000000",
    price: "3.21200000",
    quoteAmount: "6.424000",
    feeBps: 20,
    feeAmount: "0.012848",
    totalQuoteAmount: "6.436848",
    status: "cancelled",
    createdAt: Date.parse("2026-10-07T10:40:00.000Z"),
    updatedAt: Date.parse("2026-10-07T10:44:00.000Z"),
    execution: "not_supported",
    posting: "none"
  })
]);

const views: Readonly<Record<KycStatus, ExchangeOrdersView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", orders: syntheticOrders }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", orders: Object.freeze([]) })
});

/**
 * The local synthetic exchange-orders list: a verified session sees the
 * frozen test-mode order observations; a gated session sees the same shape
 * emptied in place (like the deposits gated view). Observational only —
 * every entry carries execution "not_supported" and posting "none" and
 * nothing here moves money.
 */
export function exchangeOrdersView(kyc: KycStatus): ExchangeOrdersView {
  return views[kyc];
}
