import { useState } from "react";
import type { WalletView } from "../../shared/api";
import type { AssetCode } from "../../shared/assets";
import { money } from "../format";
import { Icon } from "../Icon";
import type { SheetRequest } from "../navigation";
import { Coin, ScreenTitle } from "../ui";

export function QrScreen({ wallet, openSheet }: { wallet: WalletView; openSheet: (sheet: SheetRequest) => void }) {
  const [source, setSource] = useState<AssetCode>("RUB");
  return (
    <section className="screen" aria-label="QR">
      <ScreenTitle>Оплата по QR</ScreenTitle>
      <div className="qr-panel">
        <div className="qr-frame"><Icon name="qr" size="lg" /></div>
        <strong>Камера не используется</strong>
        <p>
          В тестовой версии сканирование отключено. Перед оплатой SolidChange покажет получателя,
          актив, сеть, сумму и комиссию.
        </p>
        <div className="qr-actions">
          <button type="button" onClick={() => openSheet({ kind: "qr-image" })}>
            <Icon name="gallery" size="sm" />
            Выбрать изображение
          </button>
          <button type="button" onClick={() => openSheet({ kind: "qr-manual" })}>
            <Icon name="keyboard" size="sm" />
            Ввести вручную
          </button>
        </div>
      </div>

      <div className="heading">
        <h3>Списать с</h3>
        <button type="button" className="link" onClick={() => openSheet({ kind: "deposit" })}>Пополнить</button>
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
              <strong>{entry.code === "RUB" ? "Рубли" : entry.code}</strong>
              <small className="num">{money(entry.code, entry.available)} доступно</small>
            </span>
          </button>
        ))}
      </div>
      <p className="note">
        <span className="note__icon"><Icon name="info" size="xs" /></span>
        <span>
          В приложении камера запрашивается только после нажатия центральной кнопки. Здесь доступ к камере
          не запрашивается вовсе.
        </span>
      </p>
    </section>
  );
}
