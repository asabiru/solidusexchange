import { useEffect, useId, useState } from "react";
import type { QuotePreview, WalletView } from "../../shared/api";
import { type AssetCode, assets } from "../../shared/assets";
import { formatDecimal, fromUnits, isDecimalString, normalizeAmountInput, toUnits } from "../../shared/decimal";
import { formatCountdown, quoteSecondsRemaining, quoteState } from "../../shared/quote";
import { ApiError, api } from "../api";
import { amount, money, rate } from "../format";
import { Icon } from "../Icon";
import type { SheetRequest } from "../navigation";
import { DisabledCta, ScreenTitle, Tick } from "../ui";

type Side = "buy" | "sell";
type CryptoAsset = Exclude<AssetCode, "RUB">;

interface Props {
  wallet: WalletView;
  openSheet: (sheet: SheetRequest) => void;
}

const quoteErrors: Readonly<Record<string, string>> = {
  invalid_amount: "Введите сумму больше нуля.",
  amount_too_small: "Сумма слишком мала для обмена.",
  invalid_pair: "Эта пара недоступна.",
  quote_unavailable: "Поставщик котировок временно недоступен. Попробуйте позже."
};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function ExchangeScreen({ wallet, openSheet }: Props) {
  const [side, setSide] = useState<Side>("buy");
  const [crypto, setCrypto] = useState<CryptoAsset>("USDT");
  const [input, setInput] = useState("25000");
  const [quote, setQuote] = useState<{ value: QuotePreview; offset: number } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const amountId = useId();
  const assetId = useId();

  const from: AssetCode = side === "buy" ? "RUB" : crypto;
  const to: AssetCode = side === "buy" ? crypto : "RUB";
  const normalized = normalizeAmountInput(input);
  const valid = isDecimalString(normalized, assets[from].scale) && toUnits(normalized, assets[from].scale) > 0n;
  const available = wallet.assets.find((entry) => entry.code === from)?.available ?? "0";
  const now = useNow(quote !== undefined);
  const serverNow = now + (quote?.offset ?? 0);
  const state = quote ? quoteState(quote.value, serverNow) : undefined;
  const remaining = quote ? quoteSecondsRemaining(quote.value, serverNow) : 0;
  const ttlFraction = quote
    ? Math.min(1, Math.max(0, (quote.value.expiresAt - serverNow) / (quote.value.ttlSeconds * 1_000)))
    : 0;

  function reset() {
    setQuote(undefined);
    setError(undefined);
  }

  async function requestQuote() {
    if (!valid) {
      setError(quoteErrors.invalid_amount);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const value = await api.quote(from, to, normalized);
      setQuote({ value, offset: value.serverTime - Date.now() });
    } catch (caught) {
      setQuote(undefined);
      setError(caught instanceof ApiError ? quoteErrors[caught.code] ?? "Не удалось получить котировку." : "Не удалось получить котировку.");
    } finally {
      setLoading(false);
    }
  }

  const statusText = !quote
    ? "Нет котировки"
    : state === "expired"
      ? "Котировка истекла"
      : `Курс актуален · ${formatCountdown(remaining)}`;

  return (
    <section className="screen screen--exchange" aria-label="Обмен">
      <ScreenTitle>Обмен</ScreenTitle>

      <div className="segment" role="tablist" aria-label="Направление обмена">
        {(["buy", "sell"] as const).map((value) => (
          <button
            type="button"
            role="tab"
            key={value}
            aria-selected={side === value}
            onClick={() => {
              setSide(value);
              reset();
            }}
          >
            {value === "buy" ? "Купить" : "Продать"}
          </button>
        ))}
      </div>

      {wallet.kyc !== "verified" ? (
        <button type="button" className="inline-alert" onClick={() => openSheet({ kind: "kyc-required" })}>
          <Icon name="id-card" size="sm" />
          <span>Предпросмотр доступен, но для обмена нужна идентификация.</span>
          <Icon name="chevron-right" size="sm" />
        </button>
      ) : null}

      <div className="exchange-field">
        <div className="exchange-field__head">
          <label className="field-label" htmlFor={amountId}>Вы отдаёте</label>
          <span className="exchange-field__balance num">Доступно {money(from, available)}</span>
        </div>
        <div className="exchange-field__body">
          <input
            id={amountId}
            className="exchange-field__value num"
            inputMode="decimal"
            autoComplete="off"
            value={input}
            aria-invalid={input !== "" && !valid}
            onChange={(event) => {
              setInput(event.target.value);
              reset();
            }}
          />
          {side === "buy" ? (
            <span className="asset-chip">RUB</span>
          ) : (
            <CryptoSelect id={assetId} value={crypto} onChange={(value) => { setCrypto(value); reset(); }} />
          )}
        </div>
        <div className="exchange-field__footer">
          <span>Сумма к списанию</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              setInput(amount(from, available, true).replace(/\u00a0/g, ""));
              reset();
            }}
          >
            Использовать всё
          </button>
        </div>
      </div>

      <button
        type="button"
        className="swap-arrow"
        aria-label="Поменять направление"
        onClick={() => {
          setSide(side === "buy" ? "sell" : "buy");
          reset();
        }}
      >
        <Icon name="swap-vertical" />
      </button>

      <div className="exchange-field">
        <div className="exchange-field__head">
          <span className="field-label">Вы получите</span>
          <span className="exchange-field__balance">Предварительно</span>
        </div>
        <div className="exchange-field__body">
          <output className="exchange-field__value num" aria-live="polite">
            <Tick value={quote && state !== "expired" ? amount(to, quote.value.amountOut) : "—"} />
          </output>
          {side === "sell" ? (
            <span className="asset-chip">RUB</span>
          ) : (
            <CryptoSelect id={assetId} value={crypto} onChange={(value) => { setCrypto(value); reset(); }} />
          )}
        </div>
        <div className="exchange-field__footer">
          <span>По котировке симулятора</span>
          <strong className="num">{quote && state !== "expired" ? money(to, quote.value.amountOut, true) : ""}</strong>
        </div>
      </div>

      <div className={`exchange-summary${state === "expired" ? " is-expired" : ""}`}>
        <div className="exchange-summary__head">
          <strong>Условия обмена</strong>
          <span
            className={`exchange-summary__status num is-${state ?? "empty"}`}
            role="timer"
            aria-live={state === "expired" ? "assertive" : "off"}
          >
            {statusText}
          </span>
        </div>
        {quote ? (
          <div className={`ttl-bar is-${state}`} aria-hidden="true">
            <span style={{ transform: `scaleX(${ttlFraction})` }} />
          </div>
        ) : null}
        <dl className="exchange-summary__grid">
          <div>
            <dt>Курс</dt>
            <dd className="num">{quote ? rate(quote.value.rate) : "—"}</dd>
          </div>
          <div>
            <dt>Комиссия</dt>
            <dd className="num">{quote ? `${money(quote.value.feeAsset, quote.value.fee)} · включена` : "—"}</dd>
          </div>
          <div>
            <dt>Спред</dt>
            <dd className="num">{quote ? `${formatDecimal(fromUnits(BigInt(quote.value.spreadBps), 2), { fractionDigits: 2 })}% · в курсе` : "—"}</dd>
          </div>
          <div>
            <dt>Итого к списанию</dt>
            <dd className="num">{quote ? money(quote.value.from, quote.value.total) : "—"}</dd>
          </div>
        </dl>
        {state === "expired" ? (
          <div className="exchange-summary__expired">
            <Icon name="clock" size="sm" />
            <span>Котировка истекла. Обновите её, чтобы увидеть актуальный курс.</span>
          </div>
        ) : null}
        {quote?.value.insufficientBalance ? (
          <div className="exchange-summary__expired">
            <Icon name="alert" size="sm" />
            <span>Сумма больше доступного баланса.</span>
          </div>
        ) : null}
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <button type="button" className="cta cta--secondary" onClick={requestQuote} disabled={loading}>
        {loading ? "Запрашиваем котировку…" : quote ? "Обновить котировку" : "Получить котировку"}
      </button>

      <DisabledCta
        label="Подтвердить обмен"
        hint="Исполнение обмена недоступно в тестовой версии: endpoint исполнения не существует."
      />

      <p className="note">
        <span className="note__icon"><Icon name="info" size="xs" /></span>
        <span>
          До подтверждения деньги не списываются. Котировка действует {quote?.value.ttlSeconds ?? 30} секунд.
          Курсы синтетические и не являются офертой.
        </span>
      </p>
    </section>
  );
}

function CryptoSelect({ id, value, onChange }: { id: string; value: CryptoAsset; onChange: (value: CryptoAsset) => void }) {
  return (
    <select
      id={id}
      className="asset-select"
      aria-label="Криптоактив"
      value={value}
      onChange={(event) => onChange(event.target.value === "TON" ? "TON" : "USDT")}
    >
      <option value="USDT">USDT</option>
      <option value="TON">TON</option>
    </select>
  );
}
