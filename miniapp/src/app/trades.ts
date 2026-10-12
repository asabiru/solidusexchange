import type { QuoteSide, TradeLiquidity } from "../shared/api.js";
import type { MessageKey } from "./i18n.js";

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
