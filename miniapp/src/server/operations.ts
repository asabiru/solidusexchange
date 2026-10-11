import type {
  OperationDetail,
  OperationStatus,
  OperationSummary,
  TimelineStep
} from "../shared/api.js";
import { assets } from "../shared/assets.js";
import { toUnits } from "../shared/decimal.js";
import type { CustomerApiOperationItem } from "./customer-api-client.js";

export const operationIdPattern = /^ope_[0-9a-f]{24}$/u;

// The upstream feed carries the domain lifecycle status of each kind
// verbatim; the app surface only knows the four display buckets. Terminal
// good states map to "completed", terminal bad to "failed", states that
// wait on the customer to "needs-action", and every other in-flight —
// including a status word the adapter does not recognise — to "in-review"
// (the one bucket that never claims money settled).
const completedOperationStatuses = new Set<string>(["completed", "confirmed", "payment_received"]);
const failedOperationStatuses = new Set<string>([
  "cancelled",
  "expired",
  "expired_no_payment",
  "failed",
  "payment_reversed",
  "rejected",
  "reversed"
]);
const actionOperationStatuses = new Set<string>([
  "awaiting_payment",
  "duplicate_payment",
  "partial_payment",
  "unsigned_intent_ready"
]);

function operationStatusOf(status: string): OperationStatus {
  if (completedOperationStatuses.has(status)) {
    return "completed";
  }
  if (failedOperationStatuses.has(status)) {
    return "failed";
  }
  if (actionOperationStatuses.has(status)) {
    return "needs-action";
  }
  return "in-review";
}

function operationSummaryOf(item: CustomerApiOperationItem): OperationSummary {
  return {
    id: item.operation_id,
    reference: item.reference,
    kind: item.kind,
    status: operationStatusOf(item.status),
    title: item.title,
    channel: item.channel,
    createdAt: item.created_at,
    legs: item.legs.map((leg) => Object.freeze({
      asset: leg.asset,
      amount: leg.amount,
      direction: leg.direction
    }))
  };
}

/**
 * Adapts the served operations collection to the /bff/operations summary
 * list. The app shape drops posting (always "none" upstream) and the
 * detail-only fields; per-kind domain statuses collapse to the display
 * buckets via operationStatusOf.
 */
export function contractOperationsView(
  items: readonly CustomerApiOperationItem[]
): OperationSummary[] {
  return items.map(operationSummaryOf);
}

/**
 * Adapts one served OperationView item to the /bff/operations/:id detail
 * shape: flat fee_amount/fee_asset collapse back to the optional fee
 * object (omitted when zero), the exchange object becomes rate, and a
 * null timeline timestamp drops the optional at field.
 */
export function contractOperationDetail(item: CustomerApiOperationItem): OperationDetail {
  const feeScale = assets[item.fee_asset].scale;
  const timeline: TimelineStep[] = item.timeline.map((step) => {
    const base = { title: step.title, detail: step.detail, state: step.state };
    return step.at === null ? base : { ...base, at: step.at };
  });
  const detail: OperationDetail = {
    ...operationSummaryOf(item),
    note: item.note,
    timeline
  };
  if (toUnits(item.fee_amount, feeScale) > 0n) {
    detail.fee = { asset: item.fee_asset, amount: item.fee_amount };
  }
  if (item.exchange !== null) {
    detail.rate = {
      base: item.exchange.base_asset,
      quote: item.exchange.quote_asset,
      value: item.exchange.rate
    };
  }
  return detail;
}
