import type {
  KycStatus,
  MarketView,
  MarketsView,
  QuotePair
} from "../shared/api.js";
import type { AssetCode } from "../shared/assets.js";

/** A book top level as the markets contract reports it (snake_case). */
export interface ContractMarketLevel {
  price: string;
  quantity: string;
  order_count: number;
}

/** The instrument's last fill as the markets contract reports it. */
export interface ContractMarketLastTrade {
  price: string;
  quantity: string;
  executed_at: string;
}

/** The customer-api markets contract entry shape (snake_case field names). */
export interface ContractMarket {
  instrument: QuotePair;
  base_asset: AssetCode;
  quote_asset: AssetCode;
  best_bid: ContractMarketLevel | null;
  best_ask: ContractMarketLevel | null;
  last_trade: ContractMarketLastTrade | null;
  spread_bps: number | null;
  base_scale: number;
  quote_scale: number;
  price_scale: number;
  as_of: string;
  posting: "none";
}

function adaptLevel(level: ContractMarketLevel | null): MarketView["bestBid"] {
  if (level === null) {
    return null;
  }
  return { price: level.price, quantity: level.quantity, orderCount: level.order_count };
}

/**
 * Adapts validated customer-api market entries into the app's markets view:
 * the asset and decimal fields become camelCase and the ISO timestamps
 * parse to milliseconds. The app keeps its own kyc flag — the contract
 * view has no session-state counterpart.
 */
export function contractMarketsView(
  markets: readonly ContractMarket[],
  kyc: KycStatus
): MarketsView {
  return {
    mode: "test",
    kyc,
    markets: markets.map((market) => ({
      instrument: market.instrument,
      base: market.base_asset,
      quote: market.quote_asset,
      bestBid: adaptLevel(market.best_bid),
      bestAsk: adaptLevel(market.best_ask),
      lastTrade:
        market.last_trade === null
          ? null
          : {
              price: market.last_trade.price,
              quantity: market.last_trade.quantity,
              executedAt: Date.parse(market.last_trade.executed_at)
            },
      spreadBps: market.spread_bps,
      baseScale: market.base_scale,
      quoteScale: market.quote_scale,
      priceScale: market.price_scale,
      asOf: Date.parse(market.as_of),
      posting: "none"
    }))
  };
}

const syntheticMarkets: readonly MarketView[] = Object.freeze([
  Object.freeze({
    instrument: "USDT/RUB",
    base: "USDT",
    quote: "RUB",
    bestBid: Object.freeze({ price: "89.99000000", quantity: "25.000000", orderCount: 1 }),
    bestAsk: Object.freeze({ price: "90.01000000", quantity: "18.000000", orderCount: 1 }),
    lastTrade: Object.freeze({
      price: "90.00000000",
      quantity: "10.000000",
      executedAt: Date.parse("2026-10-02T14:05:00.000Z")
    }),
    spreadBps: 2,
    baseScale: 6,
    quoteScale: 2,
    priceScale: 8,
    asOf: Date.parse("2026-10-02T14:10:00.000Z"),
    posting: "none"
  }),
  Object.freeze({
    instrument: "TON/USDT",
    base: "TON",
    quote: "USDT",
    bestBid: Object.freeze({ price: "3.19000000", quantity: "7.500000000", orderCount: 1 }),
    bestAsk: Object.freeze({ price: "3.21000000", quantity: "4.000000000", orderCount: 1 }),
    lastTrade: Object.freeze({
      price: "3.20000000",
      quantity: "2.000000000",
      executedAt: Date.parse("2026-10-07T10:40:00.000Z")
    }),
    spreadBps: 62,
    baseScale: 9,
    quoteScale: 6,
    priceScale: 8,
    asOf: Date.parse("2026-10-07T10:45:00.000Z"),
    posting: "none"
  }),
  Object.freeze({
    instrument: "TON/RUB",
    base: "TON",
    quote: "RUB",
    bestBid: null,
    bestAsk: Object.freeze({ price: "300.50000000", quantity: "1.250000000", orderCount: 1 }),
    lastTrade: null,
    spreadBps: null,
    baseScale: 9,
    quoteScale: 2,
    priceScale: 8,
    asOf: Date.parse("2026-10-07T10:45:00.000Z"),
    posting: "none"
  })
]);

const views: Readonly<Record<KycStatus, MarketsView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", markets: syntheticMarkets }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", markets: Object.freeze([]) })
});

/**
 * The local synthetic markets view: a verified session sees the frozen
 * test-mode instrument rows (including one empty-side book to exercise the
 * null levels); a gated session sees the same shape emptied in place (like
 * the trades gated view). Observational only — every row carries posting
 * "none" and nothing here moves money.
 */
export function marketsView(kyc: KycStatus): MarketsView {
  return views[kyc];
}
