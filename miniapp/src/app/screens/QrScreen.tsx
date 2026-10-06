import { useState } from "react";
import type { WalletView } from "../../shared/api";
import type { AssetCode } from "../../shared/assets";
import { Icon } from "../Icon";
import { useI18n } from "../i18n-context";
import type { SheetRequest } from "../navigation";
import { Coin, ScreenTitle } from "../ui";

export function QrScreen({ wallet, openSheet }: { wallet: WalletView; openSheet: (sheet: SheetRequest) => void }) {
  const [source, setSource] = useState<AssetCode>("RUB");
  const { t, format } = useI18n();
  return (
    <section className="screen" aria-label={t("tab.qr")}>
      <ScreenTitle>{t("qr.title")}</ScreenTitle>
      <div className="qr-panel">
        <div className="qr-frame"><Icon name="qr" size="lg" /></div>
        <strong>{t("qr.cameraOff")}</strong>
        <p>{t("qr.intro")}</p>
        <div className="qr-actions">
          <button type="button" onClick={() => openSheet({ kind: "qr-image" })}>
            <Icon name="gallery" size="sm" />
            {t("qr.pickImage")}
          </button>
          <button type="button" onClick={() => openSheet({ kind: "qr-manual" })}>
            <Icon name="keyboard" size="sm" />
            {t("qr.enterManually")}
          </button>
        </div>
      </div>

      <div className="heading">
        <h2>{t("qr.debitFrom")}</h2>
        <button type="button" className="link" onClick={() => openSheet({ kind: "deposit" })}>{t("common.deposit")}</button>
      </div>
      <div className="qr-sources">
        {wallet.assets.filter((entry) => entry.code !== "TON").map((entry) => (
          <button
            type="button"
            key={entry.code}
            className="qr-source"
            aria-pressed={source === entry.code}
            onClick={() => setSource(entry.code)}
          >
            <Coin asset={entry.code} />
            <span>
              <strong>{entry.code === "RUB" ? t("qr.rubles") : entry.code}</strong>
              <small className="num">{t("qr.availableSuffix", { amount: format.money(entry.code, entry.available) })}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="note">
        <span className="note__icon"><Icon name="info" size="xs" /></span>
        <span>{t("qr.note")}</span>
      </p>
    </section>
  );
}
