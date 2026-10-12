import { type RefObject, useEffect, useRef, useState } from "react";
import type { TradeView, TradesView } from "../shared/api";
import { contractQuotePair, quotePriceScale } from "../shared/quote";
import { api } from "./api";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { arrayOf } from "./server-fields";
import { tradeLiquidityBadge, tradeSideBadge } from "./trades";
import { Sheet } from "./ui";

type Mode = { kind: "list" } | { kind: "detail"; trade: TradeView };

function formattedLeg(value: string, scale: number | undefined, decimal: (v: string, o: { fractionDigits: number }) => string): string {
  return scale === undefined ? value : decimal(value, { fractionDigits: scale });
}

export function TradesSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<TradesView | undefined>();
  const [listFailed, setListFailed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [announcement, setAnnouncement] = useState("");
  const [switches, setSwitches] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t, format } = useI18n();

  useEffect(() => {
    let active = true;
    api.trades()
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
    setAnnouncement(next.kind === "detail" ? t("trades.detailTitle") : "");
    setMode(next);
  };

  const trades = arrayOf<TradeView>(view?.trades);
  const gated = view !== undefined && view.kyc !== "verified";

  return (
    <Sheet title={t("trades.title")} onClose={close}>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {mode.kind === "detail" ? (
        <TradeDetail trade={mode.trade} heading={heading} onBack={() => show({ kind: "list" })} />
      ) : (
        <>
          <h3 className="section-label" ref={heading} tabIndex={-1}>
            {t("trades.listTitle")}
          </h3>
          {listFailed ? (
            <p className="form-error" role="alert">
              {t("trades.loadFailed")}
            </p>
          ) : null}
          {view === undefined && !listFailed ? <p className="sheet__note">{t("common.loading")}</p> : null}
          {gated ? <p className="sheet__note">{t("trades.gated")}</p> : null}
          {view !== undefined && !gated && trades.length === 0 ? (
            <p className="sheet__note">{t("trades.empty")}</p>
          ) : null}
          {!gated && trades.length > 0 ? (
            <ul className="list" aria-label={t("trades.listLabel")}>
              {trades.map((trade) => {
                const pairDef = contractQuotePair(trade.pair);
                const sideBadge = tradeSideBadge(trade.side);
                const liquidityBadge = tradeLiquidityBadge(trade.liquidity);
                return (
                  <li key={trade.id}>
                    <button type="button" className="row" onClick={() => show({ kind: "detail", trade })}>
                      <span className="row__main">
                        <strong>{trade.pair}</strong>
                        <span className="num">
                          {formattedLeg(trade.quantity, pairDef?.baseScale, format.decimal)} {trade.base}
                        </span>
                        <span className="num">{format.epochMs(trade.executedAt)}</span>
                      </span>
                      <span className="row__amount">
                        <strong className="num">
                          {formattedLeg(trade.price, quotePriceScale, format.decimal)} {trade.quote}
                        </strong>
                        <span>
                          <span className={`pill pill--${sideBadge?.tone ?? "muted"}`}>
                            {sideBadge ? t(sideBadge.label) : trade.side}
                          </span>{" "}
                          <span className={`pill pill--${liquidityBadge?.tone ?? "muted"}`}>
                            {liquidityBadge ? t(liquidityBadge.label) : trade.liquidity}
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
          <p className="sheet__note">{t("trades.note")}</p>
        </>
      )}
    </Sheet>
  );
}

function TradeDetail({
  trade,
  heading,
  onBack
}: {
  trade: TradeView;
  heading: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const { t, format } = useI18n();
  const pairDef = contractQuotePair(trade.pair);
  const sideBadge = tradeSideBadge(trade.side);
  const liquidityBadge = tradeLiquidityBadge(trade.liquidity);
  const quantity = formattedLeg(trade.quantity, pairDef?.baseScale, format.decimal);
  const price = formattedLeg(trade.price, quotePriceScale, format.decimal);
  const quoteAmount = formattedLeg(trade.quoteAmount, pairDef?.quoteScale, format.decimal);
  const feeAmount = formattedLeg(trade.feeAmount, pairDef?.quoteScale, format.decimal);
  const total = formattedLeg(trade.totalQuoteAmount, pairDef?.quoteScale, format.decimal);

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("trades.detailTitle")}
      </h3>
      <div className="sheet__summary" aria-live="polite" aria-atomic="true">
        <span className="sheet__eyebrow">{trade.pair}</span>
        <span className="sheet__amount num">
          {quantity} {trade.base}
        </span>
        <span className="sheet__summary-meta">
          <span className={`pill pill--${sideBadge?.tone ?? "muted"}`}>
            {sideBadge ? t(sideBadge.label) : trade.side}
          </span>
          <span className={`pill pill--${liquidityBadge?.tone ?? "muted"}`}>
            {liquidityBadge ? t(liquidityBadge.label) : trade.liquidity}
          </span>
          <span className="num">{format.epochMs(trade.executedAt)}</span>
        </span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>{t("trades.side")}</dt>
          <dd>{sideBadge ? t(sideBadge.label) : trade.side}</dd>
        </div>
        <div>
          <dt>{t("trades.price")}</dt>
          <dd className="num">
            {price} {trade.quote}
          </dd>
        </div>
        <div>
          <dt>{t("trades.quantity")}</dt>
          <dd className="num">
            {quantity} {trade.base}
          </dd>
        </div>
        <div>
          <dt>{t("trades.quoteAmount")}</dt>
          <dd className="num">
            {quoteAmount} {trade.quote}
          </dd>
        </div>
        <div>
          <dt>{t("common.fee")}</dt>
          <dd className="num">
            {feeAmount} {trade.quote}
          </dd>
        </div>
        <div>
          <dt>{t("trades.total")}</dt>
          <dd className="num">
            {total} {trade.quote}
          </dd>
        </div>
        <div>
          <dt>{t("trades.liquidity")}</dt>
          <dd>{liquidityBadge ? t(liquidityBadge.label) : trade.liquidity}</dd>
        </div>
        <div>
          <dt>{t("trades.executedAt")}</dt>
          <dd className="num">{format.epochMs(trade.executedAt)}</dd>
        </div>
        <div>
          <dt>{t("trades.orderId")}</dt>
          <dd className="num">{trade.orderId}</dd>
        </div>
      </dl>
      <p className="sheet__note">{t("trades.note")}</p>
      <button type="button" className="cta cta--ghost" onClick={onBack}>
        {t("trades.back")}
      </button>
    </>
  );
}
