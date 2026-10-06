import { useState } from "react";
import type { OperationSummary, SessionView, WalletView } from "../../shared/api";
import { assetNameKeys, assetNetworkKeys } from "../format";
import { useI18n } from "../i18n-context";
import { Icon } from "../Icon";
import type { SheetRequest, Tab } from "../navigation";
import { Coin, EmptyState, OperationRow, ScreenTitle, Tick } from "../ui";

interface Props {
  session: SessionView;
  wallet: WalletView;
  operations: readonly OperationSummary[];
  unreadNotifications: number;
  openSheet: (sheet: SheetRequest) => void;
  openTab: (tab: Tab) => void;
}

export function HomeScreen({ session, wallet, operations, unreadNotifications, openSheet, openTab }: Props) {
  const [hidden, setHidden] = useState(false);
  const { t, format } = useI18n();
  const { amount, money } = format;
  const verified = wallet.kyc === "verified";
  const gate = (sheet: SheetRequest) => openSheet(verified ? sheet : { kind: "kyc-required" });
  const masked = "•••••• ₽";

  return (
    <section className="screen" aria-label={t("tab.home")}>
      <ScreenTitle>{t("tab.home")}</ScreenTitle>
      <div className="greeting">
        <span className="avatar" aria-hidden="true">{session.displayName.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{t("home.greeting", { name: session.displayName })}</strong>
          <span className="num">{t("home.customerId", { ref: session.customerRef })}</span>
        </div>
        <button
          type="button"
          className="icon-btn bell"
          aria-label={unreadNotifications > 0 ? t("home.notificationsUnread", { count: unreadNotifications }) : t("home.notifications")}
          onClick={() => openSheet({ kind: "notifications" })}
        >
          <Icon name="bell" />
          {unreadNotifications > 0 ? (
            <span className="bell__badge num" aria-hidden="true">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>
          ) : null}
        </button>
      </div>

      {verified ? (
        <button type="button" className="kyc kyc--ok" onClick={() => openSheet({ kind: "kyc" })}>
          <span className="kyc__mark"><Icon name="check" /></span>
          <span className="kyc__main">
            <strong>{t("home.kycVerifiedTitle")}</strong>
            <span>{t("home.kycVerifiedDetail")}</span>
          </span>
          <Icon name="chevron-right" size="sm" />
        </button>
      ) : (
        <button type="button" className="kyc kyc--gated" onClick={() => openSheet({ kind: "kyc-required" })}>
          <span className="kyc__mark"><Icon name="id-card" /></span>
          <span className="kyc__main">
            <strong>{t("home.kycGatedTitle")}</strong>
            <span>{t("home.kycGatedDetail")}</span>
          </span>
          <Icon name="chevron-right" size="sm" />
        </button>
      )}

      <div className="balance">
        <div className="balance__top">
          <span className="balance__label">{t("home.balanceLabel")}</span>
          <button
            type="button"
            className="balance__visibility"
            aria-label={t(hidden ? "home.showBalance" : "home.hideBalance")}
            aria-pressed={hidden}
            onClick={() => setHidden((value) => !value)}
          >
            <Icon name={hidden ? "eye-off" : "eye"} />
          </button>
        </div>
        <Tick className="balance__value num" value={hidden ? masked : money("RUB", wallet.totalRub)} />
        <div className="balance__meta num">
          <span>{t("common.availableAmount", { amount: hidden ? masked : money("RUB", wallet.availableRub) })}</span>
          <span>{t("home.holdAmount", { amount: hidden ? masked : money("RUB", wallet.holdRub) })}</span>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="action" onClick={() => gate({ kind: "deposit" })}>
          <span className="action__icon"><Icon name="plus" /></span>
          <span className="action__label">{t("common.deposit")}</span>
        </button>
        <button type="button" className="action" onClick={() => openTab("exchange")}>
          <span className="action__icon"><Icon name="swap" /></span>
          <span className="action__label">{t("home.actionExchange")}</span>
        </button>
        <button type="button" className="action" onClick={() => gate({ kind: "withdraw" })}>
          <span className="action__icon"><Icon name="up" /></span>
          <span className="action__label">{t("common.withdraw")}</span>
        </button>
        <button type="button" className="action" onClick={() => openSheet({ kind: "support" })}>
          <span className="action__icon"><Icon name="help" /></span>
          <span className="action__label">{t("common.support")}</span>
        </button>
      </div>

      <div className="list list--single">
        <button type="button" className="row" onClick={() => gate({ kind: "address-screening" })}>
          <span className="coin coin--menu" aria-hidden="true"><Icon name="shield-check" size="sm" /></span>
          <span className="row__main">
            <strong>{t("screening.title")}</strong>
            <span>{t("home.screeningDetail")}</span>
          </span>
          <Icon name="chevron-right" size="sm" />
        </button>
      </div>

      <div className="heading">
        <h3>{t("home.assets")}</h3>
      </div>
      <div className="list">
        {wallet.assets.map((balance) => (
          <button
            type="button"
            key={balance.code}
            className="row"
            onClick={() => openSheet({ kind: "asset", asset: balance.code })}
          >
            <Coin asset={balance.code} />
            <span className="row__main">
              <strong>{t(assetNameKeys[balance.code])}</strong>
              <span>{balance.code} · {t(assetNetworkKeys[balance.code])}</span>
            </span>
            <span className="row__amount">
              <strong className="num">{hidden ? "••••" : money(balance.code, balance.available)}</strong>
              <span className="num">
                {t("home.assetHold", { amount: hidden ? "••" : amount(balance.code, balance.hold) })}
                {balance.code === "RUB" ? "" : ` · ≈ ${hidden ? "••" : money("RUB", balance.valueRub)}`}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="heading">
        <h3>{t("home.recent")}</h3>
        <button type="button" className="link" onClick={() => openTab("activity")}>{t("home.allHistory")}</button>
      </div>
      {operations.length === 0 ? (
        <EmptyState title={t("home.emptyTitle")}>{t("home.emptyDetail")}</EmptyState>
      ) : (
        <div className="list">
          {operations.slice(0, 3).map((operation) => (
            <OperationRow
              key={operation.id}
              operation={operation}
              onOpen={(id) => openSheet({ kind: "operation", id })}
            />
          ))}
        </div>
      )}
    </section>
  );
}
