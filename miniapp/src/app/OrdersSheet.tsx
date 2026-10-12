import { type RefObject, useEffect, useRef, useState } from "react";
import type { ExchangeOrderView, ExchangeOrdersView } from "../shared/api";
import { contractQuotePair, quotePriceScale } from "../shared/quote";
import { api } from "./api";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { orderSideBadge, orderStatusBadge, orderTypeBadge, ordersHistory } from "./orders";
import { Sheet } from "./ui";

type Mode = { kind: "list" } | { kind: "detail"; order: ExchangeOrderView };

function formattedLeg(value: string, scale: number | undefined, decimal: (v: string, o: { fractionDigits: number }) => string): string {
  return scale === undefined ? value : decimal(value, { fractionDigits: scale });
}

export function OrdersSheet({ close }: { close: () => void }) {
  const [view, setView] = useState<ExchangeOrdersView | undefined>();
  const [listFailed, setListFailed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [announcement, setAnnouncement] = useState("");
  const [switches, setSwitches] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t, format } = useI18n();

  useEffect(() => {
    let active = true;
    api.exchangeOrders()
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
    setAnnouncement(next.kind === "detail" ? t("orders.detailTitle") : "");
    setMode(next);
  };

  const history = ordersHistory(view);
  const orders = history?.rows ?? [];
  const gated = history !== undefined && history.kyc !== "verified";
  const failed = listFailed || (view !== undefined && history === undefined);

  return (
    <Sheet title={t("orders.title")} onClose={close}>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {mode.kind === "detail" ? (
        <OrderDetail order={mode.order} heading={heading} onBack={() => show({ kind: "list" })} />
      ) : (
        <>
          <h3 className="section-label" ref={heading} tabIndex={-1}>
            {t("orders.listTitle")}
          </h3>
          {failed ? (
            <p className="form-error" role="alert">
              {t("orders.loadFailed")}
            </p>
          ) : null}
          {view === undefined && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
          {gated ? <p className="sheet__note">{t("orders.gated")}</p> : null}
          {history !== undefined && !gated && orders.length === 0 ? (
            <p className="sheet__note">{t("orders.empty")}</p>
          ) : null}
          {!gated && orders.length > 0 ? (
            <ul className="list" aria-label={t("orders.listLabel")}>
              {orders.map((order) => {
                const pairDef = contractQuotePair(order.pair);
                const sideBadge = orderSideBadge(order.side);
                const statusBadge = orderStatusBadge(order.status);
                return (
                  <li key={order.id}>
                    <button type="button" className="row" onClick={() => show({ kind: "detail", order })}>
                      <span className="row__main">
                        <strong>{order.pair}</strong>
                        <span className="num">
                          {formattedLeg(order.baseAmount, pairDef?.baseScale, format.decimal)} {order.base}
                        </span>
                        <span className="num">{format.epochMs(order.createdAt)}</span>
                      </span>
                      <span className="row__amount">
                        <strong className="num">
                          {formattedLeg(order.price, quotePriceScale, format.decimal)} {order.quote}
                        </strong>
                        <span>
                          <span className={`pill pill--${sideBadge?.tone ?? "muted"}`}>
                            {sideBadge ? t(sideBadge.label) : order.side}
                          </span>{" "}
                          <span className={`pill pill--${statusBadge?.tone ?? "muted"}`}>
                            {statusBadge ? t(statusBadge.label) : order.status}
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
          {history !== undefined && history.total > orders.length ? (
            <p className="sheet__note">{t("common.truncated", { shown: orders.length, total: history.total })}</p>
          ) : null}
          <p className="sheet__note">{t("orders.note")}</p>
        </>
      )}
    </Sheet>
  );
}

function OrderDetail({
  order,
  heading,
  onBack
}: {
  order: ExchangeOrderView;
  heading: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const { t, format } = useI18n();
  const pairDef = contractQuotePair(order.pair);
  const sideBadge = orderSideBadge(order.side);
  const typeBadge = orderTypeBadge(order.orderType);
  const statusBadge = orderStatusBadge(order.status);
  const quantity = formattedLeg(order.baseAmount, pairDef?.baseScale, format.decimal);
  const price = formattedLeg(order.price, quotePriceScale, format.decimal);
  const quoteAmount = formattedLeg(order.quoteAmount, pairDef?.quoteScale, format.decimal);
  const feeAmount = formattedLeg(order.feeAmount, pairDef?.quoteScale, format.decimal);
  const total = formattedLeg(order.totalQuoteAmount, pairDef?.quoteScale, format.decimal);

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("orders.detailTitle")}
      </h3>
      <div className="sheet__summary" aria-live="polite" aria-atomic="true">
        <span className="sheet__eyebrow">{order.pair}</span>
        <span className="sheet__amount num">
          {quantity} {order.base}
        </span>
        <span className="sheet__summary-meta">
          <span className={`pill pill--${sideBadge?.tone ?? "muted"}`}>
            {sideBadge ? t(sideBadge.label) : order.side}
          </span>
          <span className={`pill pill--${typeBadge?.tone ?? "muted"}`}>
            {typeBadge ? t(typeBadge.label) : order.orderType}
          </span>
          <span className={`pill pill--${statusBadge?.tone ?? "muted"}`}>
            {statusBadge ? t(statusBadge.label) : order.status}
          </span>
          <span className="num">{format.epochMs(order.createdAt)}</span>
        </span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>{t("orders.side")}</dt>
          <dd>{sideBadge ? t(sideBadge.label) : order.side}</dd>
        </div>
        <div>
          <dt>{t("orders.orderType")}</dt>
          <dd>{typeBadge ? t(typeBadge.label) : order.orderType}</dd>
        </div>
        <div>
          <dt>{t("orders.status")}</dt>
          <dd>{statusBadge ? t(statusBadge.label) : order.status}</dd>
        </div>
        <div>
          <dt>{t("orders.price")}</dt>
          <dd className="num">
            {price} {order.quote}
          </dd>
        </div>
        <div>
          <dt>{t("orders.quantity")}</dt>
          <dd className="num">
            {quantity} {order.base}
          </dd>
        </div>
        <div>
          <dt>{t("orders.quoteAmount")}</dt>
          <dd className="num">
            {quoteAmount} {order.quote}
          </dd>
        </div>
        <div>
          <dt>{t("common.fee")}</dt>
          <dd className="num">
            {feeAmount} {order.quote}
          </dd>
        </div>
        <div>
          <dt>{t("orders.total")}</dt>
          <dd className="num">
            {total} {order.quote}
          </dd>
        </div>
        <div>
          <dt>{t("orders.placedAt")}</dt>
          <dd className="num">{format.epochMs(order.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("orders.updatedAt")}</dt>
          <dd className="num">{format.epochMs(order.updatedAt)}</dd>
        </div>
        <div>
          <dt>{t("orders.orderId")}</dt>
          <dd className="num">{order.id}</dd>
        </div>
      </dl>
      <p className="sheet__note">{t("orders.note")}</p>
      <button type="button" className="cta cta--ghost" onClick={onBack}>
        {t("orders.back")}
      </button>
    </>
  );
}
