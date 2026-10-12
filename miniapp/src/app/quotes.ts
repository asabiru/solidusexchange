import { isDecimalString } from "../shared/decimal.js";
import type { QuoteRounding, QuoteSide, QuotesView, QuoteView } from "../shared/api.js";
import { contractQuotePair, quotePriceScale, type QuoteState } from "../shared/quote.js";
import type { MessageKey } from "./i18n.js";
import { boundedRows, hasExactKeys, isEpochMs, isKycFlag, isNonNegativeInt, isRecord, type ServedKycRows } from "./served-views.js";

export interface QuoteBadge {
  label: MessageKey;
  tone: string;
}

const quoteSides: Readonly<Record<QuoteSide, QuoteBadge>> = Object.freeze({
  buy: Object.freeze({ label: "quotes.buy", tone: "success" }),
  sell: Object.freeze({ label: "quotes.sell", tone: "risk" })
});

const quoteRoundings: Readonly<Record<QuoteRounding, QuoteBadge>> = Object.freeze({
  up: Object.freeze({ label: "quotes.roundingUp", tone: "warning" }),
  down: Object.freeze({ label: "quotes.roundingDown", tone: "muted" })
});

const quoteStatuses: Readonly<Record<QuoteView["status"], QuoteBadge>> = Object.freeze({
  indicative: Object.freeze({ label: "quotes.indicative", tone: "muted" })
});

const quoteStates: Readonly<Record<QuoteState, QuoteBadge>> = Object.freeze({
  fresh: Object.freeze({ label: "quotes.stateFresh", tone: "success" }),
  expiring: Object.freeze({ label: "quotes.stateExpiring", tone: "warning" }),
  expired: Object.freeze({ label: "quotes.stateExpired", tone: "muted" })
});

/** Served side/rounding/status tags and the derived timing state are untrusted: only declared members resolve. */
export function quoteSideBadge(side: string): QuoteBadge | undefined {
  return Object.hasOwn(quoteSides, side) ? quoteSides[side as QuoteSide] : undefined;
}

export function quoteRoundingBadge(rounding: string): QuoteBadge | undefined {
  return Object.hasOwn(quoteRoundings, rounding)
    ? quoteRoundings[rounding as QuoteRounding]
    : undefined;
}

export function quoteStatusBadge(status: string): QuoteBadge | undefined {
  return Object.hasOwn(quoteStatuses, status)
    ? quoteStatuses[status as QuoteView["status"]]
    : undefined;
}

export function quoteStateBadge(state: string): QuoteBadge | undefined {
  return Object.hasOwn(quoteStates, state) ? quoteStates[state as QuoteState] : undefined;
}

const quoteIdPattern = /^qte_[0-9a-f]{24}$/;

const quoteViewKeys = [
  "id",
  "pair",
  "base",
  "quote",
  "side",
  "baseAmount",
  "midPrice",
  "price",
  "spreadBps",
  "feeBps",
  "quoteAmount",
  "feeAmount",
  "totalQuoteAmount",
  "rounding",
  "priceObservedAt",
  "issuedAt",
  "expiresAt",
  "ttlSeconds",
  "status",
  "execution",
  "posting"
] as const;

function isQuoteRow(value: unknown): value is QuoteView {
  if (!isRecord(value) || !hasExactKeys(value, quoteViewKeys)) return false;
  if (typeof value.pair !== "string") return false;
  const pairDef = contractQuotePair(value.pair);
  if (pairDef === undefined || value.base !== pairDef.base || value.quote !== pairDef.quote) return false;
  return (
    typeof value.id === "string"
    && quoteIdPattern.test(value.id)
    && typeof value.side === "string"
    && quoteSideBadge(value.side) !== undefined
    && typeof value.rounding === "string"
    && quoteRoundingBadge(value.rounding) !== undefined
    && value.status === "indicative"
    && typeof value.baseAmount === "string"
    && isDecimalString(value.baseAmount, pairDef.baseScale)
    && typeof value.midPrice === "string"
    && isDecimalString(value.midPrice, quotePriceScale)
    && typeof value.price === "string"
    && isDecimalString(value.price, quotePriceScale)
    && isNonNegativeInt(value.spreadBps)
    && isNonNegativeInt(value.feeBps)
    && typeof value.quoteAmount === "string"
    && isDecimalString(value.quoteAmount, pairDef.quoteScale)
    && typeof value.feeAmount === "string"
    && isDecimalString(value.feeAmount, pairDef.quoteScale)
    && typeof value.totalQuoteAmount === "string"
    && isDecimalString(value.totalQuoteAmount, pairDef.quoteScale)
    && isEpochMs(value.priceObservedAt)
    && isEpochMs(value.issuedAt)
    && isEpochMs(value.expiresAt)
    && isNonNegativeInt(value.ttlSeconds)
    && value.execution === "not_supported"
    && value.posting === "none"
  );
}

/**
 * Validates the served quotes view: exact keys and the declared id, pair,
 * side, rounding, status and decimal grammar on every row, or undefined.
 * Valid histories render truncated to servedRowsLimit with the pre-truncation total.
 */
export function quotesHistory(view: unknown): ServedKycRows<QuoteView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "kyc", "quotes"])
    || view.mode !== "test"
    || !isKycFlag(view.kyc)
    || !Array.isArray(view.quotes)
    || !(view.quotes as readonly unknown[]).every(isQuoteRow)
  ) {
    return undefined;
  }
  return { kyc: view.kyc, ...boundedRows(view.quotes as readonly QuoteView[]) };
}
