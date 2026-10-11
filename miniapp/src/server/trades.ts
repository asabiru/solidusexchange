import type {
  KycStatus,
  QuotePair,
  QuoteSide,
  TradeLiquidity,
  TradesView,
  TradeView
} from "../shared/api.js";
import type { AssetCode } from "../shared/assets.js";

export const tradeIdPattern = /^trd_[0-9a-f]{24}$/;
export const tradeLiquidities: readonly TradeLiquidity[] = Object.freeze(["maker", "taker"]);

export function isTradeLiquidity(value: unknown): value is TradeLiquidity {
  return typeof value === "string" && (tradeLiquidities as readonly string[]).includes(value);
}

/** The customer-api trades contract entry shape (snake_case field names). */
export interface ContractTrade {
  trade_id: string;
  order_id: string;
  pair: QuotePair;
  base_asset: AssetCode;
  quote_asset: AssetCode;
  side: QuoteSide;
  liquidity: TradeLiquidity;
  price: string;
  quantity: string;
  quote_amount: string;
  fee_bps: number;
  fee_amount: string;
  total_quote_amount: string;
  executed_at: string;
  execution: "not_supported";
  posting: "none";
}

/**
 * Adapts validated customer-api trade entries into the app's trades view:
 * trade_id becomes id, order_id keeps its ord_* reference, the asset and
 * decimal fields become camelCase and the ISO timestamp parses to
 * milliseconds. The app keeps its own kyc flag — the contract view has no
 * session-state counterpart.
 */
export function contractTradesView(
  trades: readonly ContractTrade[],
  kyc: KycStatus
): TradesView {
  return {
    mode: "test",
    kyc,
    trades: trades.map((trade) => ({
      id: trade.trade_id,
      orderId: trade.order_id,
      pair: trade.pair,
      base: trade.base_asset,
      quote: trade.quote_asset,
      side: trade.side,
      liquidity: trade.liquidity,
      price: trade.price,
      quantity: trade.quantity,
      quoteAmount: trade.quote_amount,
      feeBps: trade.fee_bps,
      feeAmount: trade.fee_amount,
      totalQuoteAmount: trade.total_quote_amount,
      executedAt: Date.parse(trade.executed_at),
      execution: "not_supported",
      posting: "none"
    }))
  };
}

const syntheticTrades: readonly TradeView[] = Object.freeze([
  Object.freeze({
    id: "trd_b2c3d4e5f6a7b8c9d0e1f2a3",
    orderId: "ord_a1b2c3d4e5f6a7b8c9d0e1f2",
    pair: "USDT/RUB",
    base: "USDT",
    quote: "RUB",
    side: "sell",
    liquidity: "maker",
    price: "90.00000000",
    quantity: "10.000000",
    quoteAmount: "900.00",
    feeBps: 30,
    feeAmount: "2.70",
    totalQuoteAmount: "897.30",
    executedAt: Date.parse("2026-10-02T14:05:00.000Z"),
    execution: "not_supported",
    posting: "none"
  }),
  Object.freeze({
    id: "trd_c3d4e5f6a7b8c9d0e1f2a3b4",
    orderId: "ord_f1e2d3c4b5a6f7e8d9c0b1a2",
    pair: "TON/USDT",
    base: "TON",
    quote: "USDT",
    side: "buy",
    liquidity: "taker",
    price: "3.20000000",
    quantity: "2.000000000",
    quoteAmount: "6.400000",
    feeBps: 20,
    feeAmount: "0.012800",
    totalQuoteAmount: "6.412800",
    executedAt: Date.parse("2026-10-07T10:40:00.000Z"),
    execution: "not_supported",
    posting: "none"
  })
]);

const views: Readonly<Record<KycStatus, TradesView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", trades: syntheticTrades }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", trades: Object.freeze([]) })
});

/**
 * The local synthetic trades list: a verified session sees the frozen
 * test-mode trade observations; a gated session sees the same shape emptied
 * in place (like the exchange-orders gated view). Observational only —
 * every entry carries execution "not_supported" and posting "none" and
 * nothing here moves money.
 */
export function tradesView(kyc: KycStatus): TradesView {
  return views[kyc];
}
