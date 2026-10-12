import { type RefObject, useEffect, useRef, useState } from "react";
import type { DepositView, DepositsView, WithdrawalView, WithdrawalsView } from "../shared/api";
import type { AssetCode } from "../shared/assets";
import { api } from "./api";
import { assetNameKey } from "./format";
import type { MessageKey } from "./i18n";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import {
  depositHistory,
  depositMethodKey,
  depositStatusBadge,
  withdrawalHistory,
  withdrawalStatusBadge
} from "./money-flow";
import { screeningNetworkKeyOf } from "./server-fields";
import { Coin, DisabledCta, Sheet, Unavailable } from "./ui";

interface MoneyFlow {
  title: MessageKey;
  note: MessageKey;
  options: readonly { asset: AssetCode; title: MessageKey; detail: MessageKey }[];
  cta: MessageKey;
  unavailable: MessageKey;
  historyTitle: MessageKey;
  historyNote: MessageKey;
  listLabel: MessageKey;
  empty: MessageKey;
  gated: MessageKey;
  loadFailed: MessageKey;
  detailTitle: MessageKey;
  back: MessageKey;
}

const flows: Readonly<Record<"deposit" | "withdraw", MoneyFlow>> = {
  deposit: {
    title: "common.deposit",
    note: "deposit.note",
    options: [
      { asset: "RUB", title: "deposit.RUB.title", detail: "deposit.RUB.detail" },
      { asset: "USDT", title: "deposit.USDT.title", detail: "deposit.USDT.detail" },
      { asset: "TON", title: "deposit.TON.title", detail: "deposit.TON.detail" }
    ],
    cta: "deposit.cta",
    unavailable: "deposit.unavailable",
    historyTitle: "deposit.historyTitle",
    historyNote: "deposit.historyNote",
    listLabel: "deposit.listLabel",
    empty: "deposit.empty",
    gated: "deposit.gated",
    loadFailed: "deposit.loadFailed",
    detailTitle: "deposit.detailTitle",
    back: "deposit.back"
  },
  withdraw: {
    title: "withdraw.title",
    note: "withdraw.note",
    options: [
      { asset: "RUB", title: "withdraw.RUB.title", detail: "withdraw.RUB.detail" },
      { asset: "USDT", title: "withdraw.USDT.title", detail: "withdraw.USDT.detail" },
      { asset: "TON", title: "withdraw.TON.title", detail: "withdraw.TON.detail" }
    ],
    cta: "withdraw.cta",
    unavailable: "withdraw.unavailable",
    historyTitle: "withdraw.historyTitle",
    historyNote: "withdraw.historyNote",
    listLabel: "withdraw.listLabel",
    empty: "withdraw.empty",
    gated: "withdraw.gated",
    loadFailed: "withdraw.loadFailed",
    detailTitle: "withdraw.detailTitle",
    back: "withdraw.back"
  }
};

type Detail =
  | { kind: "deposit"; deposit: DepositView }
  | { kind: "withdrawal"; withdrawal: WithdrawalView };

export function MoneyFlowSheet({ mode, initial, close }: { mode: "deposit" | "withdraw"; initial?: AssetCode; close: () => void }) {
  const flow = flows[mode];
  const [selected, setSelected] = useState<AssetCode | undefined>(initial);
  const [detail, setDetail] = useState<Detail | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const [switches, setSwitches] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (switches > 0) {
      heading.current?.focus();
    }
  }, [switches]);

  const show = (next: Detail | undefined) => {
    setSwitches((count) => count + 1);
    setAnnouncement(next === undefined ? "" : t(flow.detailTitle));
    setDetail(next);
  };

  return (
    <Sheet title={t(flow.title)} onClose={close}>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
      {detail?.kind === "deposit" ? (
        <DepositDetail deposit={detail.deposit} heading={heading} onBack={() => show(undefined)} />
      ) : detail?.kind === "withdrawal" ? (
        <WithdrawalDetail withdrawal={detail.withdrawal} heading={heading} onBack={() => show(undefined)} />
      ) : (
        <>
          <p className="sheet__note">{t(flow.note)}</p>
          <fieldset className="options" aria-label={t("flow.methodLabel")}>
            {flow.options.map((option) => (
              <button
                type="button"
                key={option.asset}
                className="option"
                aria-pressed={selected === option.asset}
                onClick={() => setSelected(option.asset)}
              >
                <Coin asset={option.asset} />
                <span className="row__main">
                  <strong>{t(option.title)}</strong>
                  <span>{t(option.detail)}</span>
                </span>
                {selected === option.asset ? <Icon name="check" size="sm" /> : null}
              </button>
            ))}
          </fieldset>
          {selected ? (
            <>
              <Unavailable>{t(flow.unavailable)}</Unavailable>
              <DisabledCta label={t(flow.cta)} />
            </>
          ) : null}
          {mode === "deposit" ? (
            <DepositHistory flow={flow} heading={heading} onOpen={(deposit) => show({ kind: "deposit", deposit })} />
          ) : (
            <WithdrawalHistory flow={flow} heading={heading} onOpen={(withdrawal) => show({ kind: "withdrawal", withdrawal })} />
          )}
          <p className="sheet__note">{t(flow.historyNote)}</p>
        </>
      )}
    </Sheet>
  );
}

function DepositHistory({
  flow,
  heading,
  onOpen
}: {
  flow: MoneyFlow;
  heading: RefObject<HTMLHeadingElement | null>;
  onOpen: (deposit: DepositView) => void;
}) {
  const [view, setView] = useState<DepositsView | undefined>();
  const [failed, setFailed] = useState(false);
  const { t, format } = useI18n();
  const { money } = format;

  useEffect(() => {
    let active = true;
    api.deposits()
      .then((next) => {
        if (active) {
          setView(next);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const history = view === undefined ? undefined : depositHistory(view);
  const error = failed || (view !== undefined && history === undefined);
  const gated = history !== undefined && history.kyc !== "verified";
  const rows = history === undefined || gated ? [] : history.rows;

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t(flow.historyTitle)}
      </h3>
      {error ? (
        <p className="form-error" role="alert">
          {t(flow.loadFailed)}
        </p>
      ) : null}
      {view === undefined && !error ? <p className="sheet__note">{t("common.loading")}</p> : null}
      {gated ? <p className="sheet__note">{t(flow.gated)}</p> : null}
      {history !== undefined && !gated && rows.length === 0 ? (
        <p className="sheet__note">{t(flow.empty)}</p>
      ) : null}
      {!gated && rows.length > 0 ? (
        <ul className="list" aria-label={t(flow.listLabel)}>
          {rows.map((deposit) => {
            const badge = depositStatusBadge(deposit.status);
            const methodKey = depositMethodKey(deposit.method);
            return (
              <li key={deposit.id}>
                <button type="button" className="row" onClick={() => onOpen(deposit)}>
                  <span className="row__main">
                    <strong>{methodKey ? t(methodKey) : deposit.method}</strong>
                    <span className="num">{format.epochMs(deposit.createdAt)}</span>
                  </span>
                  <span className="row__amount">
                    <strong className="num">{money(deposit.asset, deposit.expected, true)}</strong>
                    <span className={`pill pill--${badge?.tone ?? "muted"}`}>
                      {badge ? t(badge.label) : deposit.status}
                    </span>
                  </span>
                  <Icon name="chevron-right" size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {history !== undefined && history.total > rows.length ? (
        <p className="sheet__note">{t("common.truncated", { shown: rows.length, total: history.total })}</p>
      ) : null}
    </>
  );
}

function WithdrawalHistory({
  flow,
  heading,
  onOpen
}: {
  flow: MoneyFlow;
  heading: RefObject<HTMLHeadingElement | null>;
  onOpen: (withdrawal: WithdrawalView) => void;
}) {
  const [view, setView] = useState<WithdrawalsView | undefined>();
  const [failed, setFailed] = useState(false);
  const { t, format } = useI18n();
  const { money } = format;

  useEffect(() => {
    let active = true;
    api.withdrawals()
      .then((next) => {
        if (active) {
          setView(next);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const history = view === undefined ? undefined : withdrawalHistory(view);
  const error = failed || (view !== undefined && history === undefined);
  const gated = history !== undefined && history.kyc !== "verified";
  const rows = history === undefined || gated ? [] : history.rows;

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t(flow.historyTitle)}
      </h3>
      {error ? (
        <p className="form-error" role="alert">
          {t(flow.loadFailed)}
        </p>
      ) : null}
      {view === undefined && !error ? <p className="sheet__note">{t("common.loading")}</p> : null}
      {gated ? <p className="sheet__note">{t(flow.gated)}</p> : null}
      {history !== undefined && !gated && rows.length === 0 ? (
        <p className="sheet__note">{t(flow.empty)}</p>
      ) : null}
      {!gated && rows.length > 0 ? (
        <ul className="list" aria-label={t(flow.listLabel)}>
          {rows.map((withdrawal) => {
            const badge = withdrawalStatusBadge(withdrawal.status);
            const networkKey = screeningNetworkKeyOf(withdrawal.network);
            return (
              <li key={withdrawal.id}>
                <button type="button" className="row" onClick={() => onOpen(withdrawal)}>
                  <span className="row__main">
                    <strong>
                      {withdrawal.asset} · {networkKey ? t(networkKey) : withdrawal.network}
                    </strong>
                    <span className="num">{format.epochMs(withdrawal.createdAt)}</span>
                  </span>
                  <span className="row__amount">
                    <strong className="num">{money(withdrawal.asset, withdrawal.amount, true)}</strong>
                    <span className={`pill pill--${badge?.tone ?? "muted"}`}>
                      {badge ? t(badge.label) : withdrawal.status}
                    </span>
                  </span>
                  <Icon name="chevron-right" size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {history !== undefined && history.total > rows.length ? (
        <p className="sheet__note">{t("common.truncated", { shown: rows.length, total: history.total })}</p>
      ) : null}
    </>
  );
}

function DepositDetail({
  deposit,
  heading,
  onBack
}: {
  deposit: DepositView;
  heading: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const { t, format } = useI18n();
  const { money } = format;
  const badge = depositStatusBadge(deposit.status);
  const methodKey = depositMethodKey(deposit.method);

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("deposit.detailTitle")}
      </h3>
      <div className="sheet__summary" aria-live="polite" aria-atomic="true">
        <span className="sheet__eyebrow">{methodKey ? t(methodKey) : deposit.method}</span>
        <span className="sheet__amount num">{money(deposit.asset, deposit.expected, true)}</span>
        <span className="sheet__summary-meta">
          <span className={`pill pill--${badge?.tone ?? "muted"}`}>
            {badge ? t(badge.label) : deposit.status}
          </span>
          <span className="num">{format.epochMs(deposit.createdAt)}</span>
        </span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>{t("deposit.status")}</dt>
          <dd>
            <span className={`pill pill--${badge?.tone ?? "muted"}`}>
              {badge ? t(badge.label) : deposit.status}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t("deposit.method")}</dt>
          <dd>{methodKey ? t(methodKey) : deposit.method}</dd>
        </div>
        <div>
          <dt>{t("deposit.expected")}</dt>
          <dd className="num">{money(deposit.asset, deposit.expected, true)}</dd>
        </div>
        <div>
          <dt>{t("deposit.received")}</dt>
          <dd className="num">{money(deposit.asset, deposit.received, true)}</dd>
        </div>
        <div>
          <dt>{t("deposit.reversed")}</dt>
          <dd className="num">{money(deposit.asset, deposit.reversed, true)}</dd>
        </div>
        <div>
          <dt>{t("deposit.reference")}</dt>
          <dd className="num">{deposit.paymentReference}</dd>
        </div>
        <div>
          <dt>{t("deposit.createdAt")}</dt>
          <dd className="num">{format.epochMs(deposit.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("deposit.updatedAt")}</dt>
          <dd className="num">{format.epochMs(deposit.updatedAt)}</dd>
        </div>
        <div>
          <dt>{t("deposit.depositId")}</dt>
          <dd className="num">{deposit.id}</dd>
        </div>
      </dl>
      <p className="sheet__note">{t("deposit.historyNote")}</p>
      <button type="button" className="cta cta--ghost" onClick={onBack}>
        {t("deposit.back")}
      </button>
    </>
  );
}

function WithdrawalDetail({
  withdrawal,
  heading,
  onBack
}: {
  withdrawal: WithdrawalView;
  heading: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}) {
  const { t, format } = useI18n();
  const { money } = format;
  const badge = withdrawalStatusBadge(withdrawal.status);
  const networkKey = screeningNetworkKeyOf(withdrawal.network);
  const nameKey = assetNameKey(withdrawal.asset);

  return (
    <>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("withdraw.detailTitle")}
      </h3>
      <div className="sheet__summary" aria-live="polite" aria-atomic="true">
        <span className="sheet__eyebrow">
          {withdrawal.asset} · {networkKey ? t(networkKey) : withdrawal.network}
        </span>
        <span className="sheet__amount num">{money(withdrawal.asset, withdrawal.amount, true)}</span>
        <span className="sheet__summary-meta">
          <span className={`pill pill--${badge?.tone ?? "muted"}`}>
            {badge ? t(badge.label) : withdrawal.status}
          </span>
          <span className="num">{format.epochMs(withdrawal.createdAt)}</span>
        </span>
      </div>
      <dl className="meta-list">
        <div>
          <dt>{t("withdraw.status")}</dt>
          <dd>
            <span className={`pill pill--${badge?.tone ?? "muted"}`}>
              {badge ? t(badge.label) : withdrawal.status}
            </span>
          </dd>
        </div>
        <div>
          <dt>{t("withdraw.asset")}</dt>
          <dd>{nameKey ? t(nameKey) : withdrawal.asset}</dd>
        </div>
        <div>
          <dt>{t("common.network")}</dt>
          <dd>{networkKey ? t(networkKey) : withdrawal.network}</dd>
        </div>
        <div>
          <dt>{t("withdraw.amount")}</dt>
          <dd className="num">{money(withdrawal.asset, withdrawal.amount, true)}</dd>
        </div>
        <div>
          <dt>{t("common.fee")}</dt>
          <dd className="num">{money(withdrawal.asset, withdrawal.fee, true)}</dd>
        </div>
        <div>
          <dt>{t("withdraw.destination")}</dt>
          <dd className="num">{withdrawal.destinationReference}</dd>
        </div>
        <div>
          <dt>{t("withdraw.createdAt")}</dt>
          <dd className="num">{format.epochMs(withdrawal.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("withdraw.updatedAt")}</dt>
          <dd className="num">{format.epochMs(withdrawal.updatedAt)}</dd>
        </div>
        <div>
          <dt>{t("withdraw.expiresAt")}</dt>
          <dd className="num">{format.epochMs(withdrawal.expiresAt)}</dd>
        </div>
        <div>
          <dt>{t("withdraw.withdrawalId")}</dt>
          <dd className="num">{withdrawal.id}</dd>
        </div>
      </dl>
      <h3 className="section-label">{t("withdraw.legs")}</h3>
      <ul className="list" aria-label={t("withdraw.legsLabel")}>
        {withdrawal.legs.map((leg) => (
          <li className="row" key={leg.id}>
            <span className="row__main">
              <strong className="num">{money(leg.asset, leg.amount, true)}</strong>
              <span className="num">{leg.id}</span>
            </span>
            <span className="pill pill--muted">{t("withdraw.legOut")}</span>
          </li>
        ))}
      </ul>
      <p className="sheet__note">{t("withdraw.historyNote")}</p>
      <button type="button" className="cta cta--ghost" onClick={onBack}>
        {t("withdraw.back")}
      </button>
    </>
  );
}
