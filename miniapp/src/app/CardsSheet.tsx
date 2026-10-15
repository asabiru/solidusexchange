import { type RefObject, useEffect, useRef, useState } from "react";
import type { CardView } from "../shared/api";
import { api } from "./api";
import { cardBrandBadge, cardKindBadge, cardsHistory, cardStatusBadge } from "./cards";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { Sheet } from "./ui";

type Mode = { kind: "list" } | { kind: "detail"; card: CardView };

export function CardsSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<unknown>();
  const [listFailed, setListFailed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [announcement, setAnnouncement] = useState("");
  const [switches, setSwitches] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    api.cards()
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
    setAnnouncement(next.kind === "detail" ? t("cards.detailTitle") : "");
    setMode(next);
  };

  const history = cardsHistory(view);
  const cards = history?.rows ?? [];
  const gated = history !== undefined && history.kyc !== "verified";
  const failed = listFailed || (view !== undefined && history === undefined);

  return (
    <Sheet title={t("cards.title")} onClose={close}>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {mode.kind === "detail" ? (
        <CardDetail card={mode.card} heading={heading} onBack={() => show({ kind: "list" })} />
      ) : (
        <>
          <h3 className="section-label" ref={heading} tabIndex={-1}>
            {t("cards.listTitle")}
          </h3>
          {failed ? (
            <p className="form-error" role="alert">
              {t("cards.loadFailed")}
            </p>
          ) : null}
          {view === undefined && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
          {gated ? <p className="sheet__note">{t("cards.gated")}</p> : null}
          {history !== undefined && !gated && cards.length === 0 ? (
            <p className="sheet__note">{t("cards.empty")}</p>
          ) : null}
          {!gated && cards.length > 0 ? (
            <ul className="list" aria-label={t("cards.listLabel")}>
              {cards.map((card) => {
                const brandBadge = cardBrandBadge(card.brand);
                const kindBadge = cardKindBadge(card.kind);
                const statusBadge = cardStatusBadge(card.status);
                return (
                  <li key={card.id}>
                    <button type="button" className="row" onClick={() => show({ kind: "detail", card })}>
                      <span className="coin coin--menu" aria-hidden="true"><Icon name="credit-card" size="sm" /></span>
                      <span className="row__main">
                        <strong>{brandBadge ? t(brandBadge.label) : card.brand} ·· {card.last4}</strong>
                        <span>{kindBadge ? t(kindBadge.label) : card.kind}</span>
                      </span>
                      <span className="row__amount">
                        <span className={`pill pill--${statusBadge?.tone ?? "muted"}`}>
                          {statusBadge ? t(statusBadge.label) : card.status}
                        </span>
                      </span>
                      <Icon name="chevron-right" size="sm" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {history !== undefined && history.total > cards.length ? (
            <p className="sheet__note">{t("common.truncated", { shown: cards.length, total: history.total })}</p>
          ) : null}
          <p className="sheet__note">{t("cards.note")}</p>
        </>
      )}
    </Sheet>
  );
}

function CardDetail({
  card,
  heading,
  onBack
}: {
  card: CardView;
  heading: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const { t, format } = useI18n();
  const brandBadge = cardBrandBadge(card.brand);
  const kindBadge = cardKindBadge(card.kind);
  const statusBadge = cardStatusBadge(card.status);

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("cards.detailTitle")}
      </h3>
      <div className="sheet__summary" aria-live="polite" aria-atomic="true">
        <span className="sheet__eyebrow">{brandBadge ? t(brandBadge.label) : card.brand}</span>
        <span className="sheet__amount num">···· {card.last4}</span>
        <span className="sheet__summary-meta">
          <span className={`pill pill--${statusBadge?.tone ?? "muted"}`}>
            {statusBadge ? t(statusBadge.label) : card.status}
          </span>
          <span className={`pill pill--${kindBadge?.tone ?? "muted"}`}>
            {kindBadge ? t(kindBadge.label) : card.kind}
          </span>
        </span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>{t("cards.masked")}</dt>
          <dd className="num">···· {card.last4}</dd>
        </div>
        <div>
          <dt>{t("cards.brand")}</dt>
          <dd>{brandBadge ? t(brandBadge.label) : card.brand}</dd>
        </div>
        <div>
          <dt>{t("cards.kind")}</dt>
          <dd>{kindBadge ? t(kindBadge.label) : card.kind}</dd>
        </div>
        <div>
          <dt>{t("cards.status")}</dt>
          <dd>{statusBadge ? t(statusBadge.label) : card.status}</dd>
        </div>
        <div>
          <dt>{t("cards.monthlyLimit")}</dt>
          <dd className="num">{format.money(card.asset, card.monthlyLimit)}</dd>
        </div>
        <div>
          <dt>{t("cards.token")}</dt>
          <dd className="num">{card.tokenReference}</dd>
        </div>
        <div>
          <dt>{t("cards.createdAt")}</dt>
          <dd className="num">{format.epochMs(card.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("cards.expiresAt")}</dt>
          <dd className="num">{format.epochMs(card.expiresAt)}</dd>
        </div>
        <div>
          <dt>{t("cards.updatedAt")}</dt>
          <dd className="num">{format.epochMs(card.updatedAt)}</dd>
        </div>
      </dl>
      <p className="sheet__note">{t("cards.note")}</p>
      <button type="button" className="cta cta--ghost" onClick={onBack}>
        {t("cards.back")}
      </button>
    </>
  );
}
