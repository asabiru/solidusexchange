import { useState } from "react";
import type { OperationSummary, SessionView, WalletView } from "../../shared/api";
import { assets } from "../../shared/assets";
import { amount, money } from "../format";
import { Icon } from "../Icon";
import type { SheetRequest, Tab } from "../navigation";
import { Coin, EmptyState, OperationRow, ScreenTitle, Tick } from "../ui";

interface Props {
  session: SessionView;
  wallet: WalletView;
  operations: readonly OperationSummary[];
  openSheet: (sheet: SheetRequest) => void;
  openTab: (tab: Tab) => void;
}

export function HomeScreen({ session, wallet, operations, openSheet, openTab }: Props) {
  const [hidden, setHidden] = useState(false);
  const verified = wallet.kyc === "verified";
  const gate = (sheet: SheetRequest) => openSheet(verified ? sheet : { kind: "kyc-required" });
  const masked = "•••••• ₽";

  return (
    <section className="screen" aria-label="Главная">
      <ScreenTitle>Главная</ScreenTitle>
      <div className="greeting">
        <span className="avatar" aria-hidden="true">Т</span>
        <div>
          <strong>Добрый день, {session.displayName}</strong>
          <span className="num">SolidChange ID · {session.customerRef}</span>
        </div>
      </div>

      {verified ? (
        <button type="button" className="kyc kyc--ok" onClick={() => openSheet({ kind: "kyc" })}>
          <span className="kyc__mark"><Icon name="check" /></span>
          <span className="kyc__main">
            <strong>Проверка пройдена</strong>
            <span>Уровень Standard · лимиты не настроены (D-014)</span>
          </span>
          <Icon name="chevron-right" size="sm" />
        </button>
      ) : (
        <button type="button" className="kyc kyc--gated" onClick={() => openSheet({ kind: "kyc-required" })}>
          <span className="kyc__mark"><Icon name="id-card" /></span>
          <span className="kyc__main">
            <strong>Подтвердите личность</strong>
            <span>Пройти проверку (тест) · обмен, пополнение и вывод откроются после неё</span>
          </span>
          <Icon name="chevron-right" size="sm" />
        </button>
      )}

      <div className="balance">
        <div className="balance__top">
          <span className="balance__label">Общая стоимость активов</span>
          <button
            type="button"
            className="balance__visibility"
            aria-label={hidden ? "Показать баланс" : "Скрыть баланс"}
            aria-pressed={hidden}
            onClick={() => setHidden((value) => !value)}
          >
            <Icon name={hidden ? "eye-off" : "eye"} />
          </button>
        </div>
        <Tick className="balance__value num" value={hidden ? masked : money("RUB", wallet.totalRub)} />
        <div className="balance__meta num">
          <span>Доступно {hidden ? masked : money("RUB", wallet.availableRub)}</span>
          <span>Hold {hidden ? masked : money("RUB", wallet.holdRub)}</span>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="action" onClick={() => gate({ kind: "deposit" })}>
          <span className="action__icon"><Icon name="plus" /></span>
          <span className="action__label">Пополнить</span>
        </button>
        <button type="button" className="action" onClick={() => openTab("exchange")}>
          <span className="action__icon"><Icon name="swap" /></span>
          <span className="action__label">Обменять</span>
        </button>
        <button type="button" className="action" onClick={() => gate({ kind: "withdraw" })}>
          <span className="action__icon"><Icon name="up" /></span>
          <span className="action__label">Вывести</span>
        </button>
        <button type="button" className="action" onClick={() => openSheet({ kind: "support" })}>
          <span className="action__icon"><Icon name="help" /></span>
          <span className="action__label">Поддержка</span>
        </button>
      </div>

      <div className="heading">
        <h3>Активы</h3>
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
              <strong>{assets[balance.code].name}</strong>
              <span>{balance.code} · {assets[balance.code].network}</span>
            </span>
            <span className="row__amount">
              <strong className="num">{hidden ? "••••" : money(balance.code, balance.available)}</strong>
              <span className="num">
                Hold · {hidden ? "••" : amount(balance.code, balance.hold)}
                {balance.code === "RUB" ? "" : ` · ≈ ${hidden ? "••" : money("RUB", balance.valueRub)}`}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="heading">
        <h3>Последние операции</h3>
        <button type="button" className="link" onClick={() => openTab("activity")}>Вся история</button>
      </div>
      {operations.length === 0 ? (
        <EmptyState title="Операций пока нет">Здесь появятся обмены, пополнения и выводы.</EmptyState>
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
