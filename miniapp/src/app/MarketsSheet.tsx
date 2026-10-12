import { type RefObject, useEffect, useRef, useState } from "react";
import type { MarketDepthView, MarketView } from "../shared/api";
import { ApiError, api } from "./api";
import { type MessageKey } from "./i18n";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { depthTruncated } from "./markets-depth";
import { arrayOf } from "./server-fields";
import { Sheet } from "./ui";

type Mode = { kind: "list" } | { kind: "detail"; instrument: string };

export function MarketsSheet({ close }: { close: () => void }) {
  const [markets, setMarkets] = useState<readonly MarketView[] | undefined>();
  const [listFailed, setListFailed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [announcement, setAnnouncement] = useState("");
  const [switches, setSwitches] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t, format } = useI18n();

  useEffect(() => {
    let active = true;
    api.markets()
      .then((view) => { if (active) setMarkets(arrayOf<MarketView>(view.markets)); })
      .catch(() => { if (active) setListFailed(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (switches > 0) heading.current?.focus();
  }, [switches]);

  const show = (next: Mode) => {
    setSwitches((count) => count + 1);
    setAnnouncement(next.kind === "detail" ? t("markets.detailTitle") : "");
    setMode(next);
  };

  return (
    <Sheet title={t("markets.title")} onClose={close}>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
      {mode.kind === "detail" ? (
        <MarketDepth instrument={mode.instrument} heading={heading} onBack={() => show({ kind: "list" })} />
      ) : (
        <>
          <h3 className="section-label" ref={heading} tabIndex={-1}>{t("markets.listTitle")}</h3>
          {listFailed ? <p className="form-error" role="alert">{t("markets.loadFailed")}</p> : null}
          {markets === undefined && !listFailed ? <p className="sheet__note">{t("common.loading")}</p> : null}
          {markets?.length === 0 ? <p className="sheet__note">{t("markets.empty")}</p> : null}
          {markets && markets.length > 0 ? (
            <ul className="list" aria-label={t("markets.listLabel")}>
              {markets.map((market) => (
                <li key={market.instrument}>
                  <button type="button" className="row" onClick={() => show({ kind: "detail", instrument: market.instrument })}>
                    <span className="row__main">
                      <strong>{market.instrument}</strong>
                      <span className="num">
                        {market.bestBid !== null ? format.decimal(market.bestBid.price, { fractionDigits: market.priceScale }) : "—"}
                        {" / "}
                        {market.bestAsk !== null ? format.decimal(market.bestAsk.price, { fractionDigits: market.priceScale }) : "—"}
                      </span>
                    </span>
                    <Icon name="chevron-right" size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="sheet__note">{t("markets.note")}</p>
        </>
      )}
    </Sheet>
  );
}

function MarketDepth({
  instrument,
  heading,
  onBack
}: {
  instrument: string;
  heading: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const [depth, setDepth] = useState<MarketDepthView | undefined>();
  const [failed, setFailed] = useState<MessageKey | undefined>();
  const { t, format } = useI18n();

  useEffect(() => {
    let active = true;
    api.marketDepth(instrument)
      .then((value) => { if (active) setDepth(value); })
      .catch((caught: unknown) => {
        if (active) {
          setFailed(caught instanceof ApiError && caught.status === 404 ? "markets.notFound" : "common.serverUnreachable");
        }
      });
    return () => { active = false; };
  }, [instrument]);

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>{t("markets.detailTitle")}</h3>
      {failed ? <p className="sheet__note" role="alert">{t(failed)}</p> : null}
      {!depth && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
      {depth ? (
        <>
          <div className="sheet__summary" aria-live="polite" aria-atomic="true">
            <span className="sheet__eyebrow">{depth.instrument}</span>
            <span className="sheet__summary-meta">
              <span className="num">{format.epochMs(depth.asOf)}</span>
            </span>
          </div>
          <DepthSide title={t("markets.bids")} levels={depth.bids} depth={depth} side="bids" />
          <DepthSide title={t("markets.asks")} levels={depth.asks} depth={depth} side="asks" />
          <dl className="meta-list">
            <div>
              <dt>{t("markets.lastTrade")}</dt>
              <dd className="num">
                {depth.lastTrade === null
                  ? t("markets.noTrades")
                  : `${format.decimal(depth.lastTrade.price, { fractionDigits: depth.priceScale })} · ${format.decimal(depth.lastTrade.quantity, { fractionDigits: depth.baseScale })} ${depth.base} · ${format.epochMs(depth.lastTrade.executedAt)}`}
              </dd>
            </div>
            <div>
              <dt>{t("markets.asOf")}</dt>
              <dd className="num">{format.epochMs(depth.asOf)}</dd>
            </div>
          </dl>
          {depthTruncated(depth) ? (
            <p className="sheet__note">{t("markets.truncated", { total: depth.depthLevels })}</p>
          ) : null}
        </>
      ) : null}
      <button type="button" className="cta cta--ghost" onClick={onBack}>{t("markets.back")}</button>
    </>
  );
}

function DepthSide({
  title,
  levels,
  depth,
  side
}: {
  title: string;
  levels: MarketDepthView["bids"];
  depth: MarketDepthView;
  side: "bids" | "asks";
}) {
  const { t, format } = useI18n();
  return (
    <table className={`depth-table depth-table--${side}`}>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{t("markets.price")}</th>
          <th scope="col">{t("markets.quantity")}</th>
          <th scope="col">{t("markets.orders")}</th>
        </tr>
      </thead>
      <tbody>
        {levels.length === 0 ? (
          <tr>
            <td colSpan={3}>{t("markets.sideEmpty")}</td>
          </tr>
        ) : (
          levels.map((level) => (
            <tr key={level.price}>
              <td className="num">{format.decimal(level.price, { fractionDigits: depth.priceScale })}</td>
              <td className="num">{format.decimal(level.quantity, { fractionDigits: depth.baseScale })}</td>
              <td className="num">{level.orderCount}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
