import { useRef } from "react";
import type { WalletView } from "../shared/api";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { Sheet } from "./ui";

function shortAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 8)}…${address.slice(-4)}`;
}

export function RequisitesSheet({ wallet, close }: { wallet: WalletView; close: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { t } = useI18n();

  return (
    <Sheet title={t("requisites.title")} onClose={close}>
      <h3 className="section-label" ref={heading} tabIndex={-1}>
        {t("requisites.depositTitle")}
      </h3>
      {wallet.depositAddresses.length === 0 ? (
        <p className="sheet__note">{t("requisites.empty")}</p>
      ) : (
        <ul className="list" aria-label={t("requisites.listLabel")}>
          {wallet.depositAddresses.map((entry) => (
            <li key={entry.id}>
              <span className="row row--static">
                <span className="coin coin--menu" aria-hidden="true"><Icon name="wallet" size="sm" /></span>
                <span className="row__main">
                  <strong>{entry.asset} · {entry.network}</strong>
                  <span className="num">{shortAddress(entry.address)}</span>
                </span>
                <span className="pill pill--muted">{t("common.test")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="section-label">{t("requisites.bankTitle")}</h3>
      <div className="list">
        <div className="row row--static">
          <span className="coin coin--menu" aria-hidden="true"><Icon name="bank" size="sm" /></span>
          <span className="row__main">
            <strong>{t("requisites.bankRow")}</strong>
            <span>{t("requisites.bankHint")}</span>
          </span>
          <span className="pill pill--muted">{t("common.soon")}</span>
        </div>
        <div className="row row--static">
          <span className="coin coin--menu" aria-hidden="true"><Icon name="lock" size="sm" /></span>
          <span className="row__main">
            <strong>{t("requisites.whitelistRow")}</strong>
            <span>{t("requisites.whitelistHint")}</span>
          </span>
          <span className="pill pill--muted">{t("common.soon")}</span>
        </div>
      </div>
      <p className="sheet__note">{t("requisites.note")}</p>
    </Sheet>
  );
}
