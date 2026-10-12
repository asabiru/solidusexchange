import type { QuoteRounding, QuoteSide, QuoteView } from "../shared/api.js";
import type { QuoteState } from "../shared/quote.js";
import type { MessageKey } from "./i18n.js";

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
