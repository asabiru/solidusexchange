import type { ExchangeOrderStatus, ExchangeOrderType, QuoteSide } from "../shared/api.js";
import type { MessageKey } from "./i18n.js";

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
