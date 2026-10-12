import { type RefObject, useEffect, useRef, useState } from "react";
import type { QuotesView, QuoteView } from "../shared/api";
import { fromUnits } from "../shared/decimal";
import { contractQuotePair, quotePriceScale, quoteState } from "../shared/quote";
import { api } from "./api";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { quoteRoundingBadge, quoteSideBadge, quoteStateBadge, quoteStatusBadge, quotesHistory } from "./quotes";
import { Sheet } from "./ui";

type Mode = { kind: "list" } | { kind: "detail"; quote: QuoteView };

function formattedLeg(value: string, scale: number | undefined, decimal: (v: string, o: { fractionDigits: number }) => string): string {
  return scale === undefined ? value : decimal(value, { fractionDigits: scale });
}

function formattedBps(bps: number, decimal: (v: string, o: { fractionDigits: number }) => string): string {
  return Number.isSafeInteger(bps)
    ? `${decimal(fromUnits(BigInt(bps), 2), { fractionDigits: 2 })}%`
    : "—";
}

export function QuotesSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<QuotesView | undefined>();
  const [listFailed, setListFailed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [announcement, setAnnouncement] = useState("");
  const [switches, setSwitches] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t, format } = useI18n();

  useEffect(() => {
    let active = true;
    api.quotes()
      .then((next) => {
        if (active) {
          setView(next);
        }
      })
      .catch(() => {
        if (active) {
          setListFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (switches > 0) {
      heading.current?.focus();
    }
  }, [switches]);

  const show = (next: Mode) => {
    setSwitches((count) => count + 1);
    setAnnouncement(next.kind === "detail" ? t("quotes.detailTitle") : "");
    setMode(next);
  };

  // The served view is untrusted: it renders only through the fail-closed adapter.
  const history = quotesHistory(view);
  const quotes = history?.rows ?? [];
  const gated = history !== undefined && history.kyc !== "verified";
  const failed = listFailed || (view !== undefined && history === undefined);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    // The indicative/issued/expired state badge keeps ticking while the sheet is open.
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Sheet title={t("quotes.title")} onClose={close}>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {mode.kind === "detail" ? (
        <QuoteDetail quote={mode.quote} nowMs={nowMs} heading={heading} onBack={() => show({ kind: "list" })} />
      ) : (
        <>
          <h3 className="section-label" ref={heading} tabIndex={-1}>
            {t("quotes.listTitle")}
          </h3>
          {failed ? (
            <p className="form-error" role="alert">
              {t("quotes.loadFailed")}
            </p>
          ) : null}
          {view === undefined && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
          {gated ? <p className="sheet__note">{t("quotes.gated")}</p> : null}
          {history !== undefined && !gated && quotes.length === 0 ? (
            <p className="sheet__note">{t("quotes.empty")}</p>
          ) : null}
          {!gated && quotes.length > 0 ? (
            <ul className="list" aria-label={t("quotes.listLabel")}>
              {quotes.map((quote) => {
                const pairDef = contractQuotePair(quote.pair);
                const sideBadge = quoteSideBadge(quote.side);
                const stateBadge = quoteStateBadge(quoteState(quote, nowMs));
                return (
                  <li key={quote.id}>
                    <button type="button" className="row" onClick={() => show({ kind: "detail", quote })}>
                      <span className="row__main">
                        <strong>{quote.pair}</strong>
                        <span className="num">
                          {formattedLeg(quote.baseAmount, pairDef?.baseScale, format.decimal)} {quote.base}
                        </span>
                        <span className="num">{format.epochMs(quote.issuedAt)}</span>
                      </span>
                      <span className="row__amount">
                        <strong className="num">
                          {formattedLeg(quote.price, quotePriceScale, format.decimal)} {quote.quote}
                        </strong>
                        <span>
                          <span className={`pill pill--${sideBadge?.tone ?? "muted"}`}>
                            {sideBadge ? t(sideBadge.label) : quote.side}
                          </span>{" "}
                          <span className={`pill pill--${stateBadge?.tone ?? "muted"}`}>
                            {stateBadge ? t(stateBadge.label) : quoteState(quote, nowMs)}
                          </span>
                        </span>
                      </span>
                      <Icon name="chevron-right" size="sm" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {history !== undefined && history.total > quotes.length ? (
            <p className="sheet__note">{t("common.truncated", { shown: quotes.length, total: history.total })}</p>
          ) : null}
          <p className="sheet__note">{t("quotes.note")}</p>
        </>
      )}
    </Sheet>
  );
}

function QuoteDetail({
  quote,
  nowMs,
  heading,
  onBack
}: {
  quote: QuoteView;
  nowMs: number;
  heading: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const { t, format } = useI18n();
  const pairDef = contractQuotePair(quote.pair);
  const sideBadge = quoteSideBadge(quote.side);
  const roundingBadge = quoteRoundingBadge(quote.rounding);
  const statusBadge = quoteStatusBadge(quote.status);
  const state = quoteState(quote, nowMs);
  const stateBadge = quoteStateBadge(state);
  const quantity = formattedLeg(quote.baseAmount, pairDef?.baseScale, format.decimal);
  const price = formattedLeg(quote.price, quotePriceScale, format.decimal);
  const midPrice = formattedLeg(quote.midPrice, quotePriceScale, format.decimal);
  const quoteAmount = formattedLeg(quote.quoteAmount, pairDef?.quoteScale, format.decimal);
  const feeAmount = formattedLeg(quote.feeAmount, pairDef?.quoteScale, format.decimal);
  const total = formattedLeg(quote.totalQuoteAmount, pairDef?.quoteScale, format.decimal);

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("quotes.detailTitle")}
      </h3>
      <div className="sheet__summary" aria-live="polite" aria-atomic="true">
        <span className="sheet__eyebrow">{quote.pair}</span>
        <span className="sheet__amount num">
          {quantity} {quote.base}
        </span>
        <span className="sheet__summary-meta">
          <span className={`pill pill--${sideBadge?.tone ?? "muted"}`}>
            {sideBadge ? t(sideBadge.label) : quote.side}
          </span>
          <span className={`pill pill--${roundingBadge?.tone ?? "muted"}`}>
            {roundingBadge ? t(roundingBadge.label) : quote.rounding}
          </span>
          <span className={`pill pill--${statusBadge?.tone ?? "muted"}`}>
            {statusBadge ? t(statusBadge.label) : quote.status}
          </span>
          <span className={`pill pill--${stateBadge?.tone ?? "muted"}`}>
            {stateBadge ? t(stateBadge.label) : state}
          </span>
          <span className="num">{format.epochMs(quote.issuedAt)}</span>
        </span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>{t("quotes.side")}</dt>
          <dd>{sideBadge ? t(sideBadge.label) : quote.side}</dd>
        </div>
        <div>
          <dt>{t("quotes.rounding")}</dt>
          <dd>{roundingBadge ? t(roundingBadge.label) : quote.rounding}</dd>
        </div>
        <div>
          <dt>{t("quotes.status")}</dt>
          <dd>{statusBadge ? t(statusBadge.label) : quote.status}</dd>
        </div>
        <div>
          <dt>{t("quotes.state")}</dt>
          <dd>{stateBadge ? t(stateBadge.label) : state}</dd>
        </div>
        <div>
          <dt>{t("quotes.price")}</dt>
          <dd className="num">
            {price} {quote.quote}
          </dd>
        </div>
        <div>
          <dt>{t("quotes.midPrice")}</dt>
          <dd className="num">
            {midPrice} {quote.quote}
          </dd>
        </div>
        <div>
          <dt>{t("quotes.quantity")}</dt>
          <dd className="num">
            {quantity} {quote.base}
          </dd>
        </div>
        <div>
          <dt>{t("quotes.quoteAmount")}</dt>
          <dd className="num">
            {quoteAmount} {quote.quote}
          </dd>
        </div>
        <div>
          <dt>{t("common.fee")}</dt>
          <dd className="num">
            {feeAmount} {quote.quote}
          </dd>
        </div>
        <div>
          <dt>{t("quotes.total")}</dt>
          <dd className="num">
            {total} {quote.quote}
          </dd>
        </div>
        <div>
          <dt>{t("quotes.spread")}</dt>
          <dd className="num">{formattedBps(quote.spreadBps, format.decimal)}</dd>
        </div>
        <div>
          <dt>{t("quotes.feeRate")}</dt>
          <dd className="num">{formattedBps(quote.feeBps, format.decimal)}</dd>
        </div>
        <div>
          <dt>{t("quotes.issuedAt")}</dt>
          <dd className="num">{format.epochMs(quote.issuedAt)}</dd>
        </div>
        <div>
          <dt>{t("quotes.expiresAt")}</dt>
          <dd className="num">{format.epochMs(quote.expiresAt)}</dd>
        </div>
        <div>
          <dt>{t("quotes.observedAt")}</dt>
          <dd className="num">{format.epochMs(quote.priceObservedAt)}</dd>
        </div>
        <div>
          <dt>{t("quotes.quoteId")}</dt>
          <dd className="num">{quote.id}</dd>
        </div>
      </dl>
      <p className="sheet__note">{t("quotes.note")}</p>
      <button type="button" className="cta cta--ghost" onClick={onBack}>
        {t("quotes.back")}
      </button>
    </>
  );
}
