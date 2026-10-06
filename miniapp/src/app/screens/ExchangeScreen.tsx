import { useEffect, useId, useState } from "react";
import type { QuotePreview, WalletView } from "../../shared/api";
import { type AssetCode, assets } from "../../shared/assets";
import { fromUnits, isDecimalString, normalizeAmountInput, toUnits } from "../../shared/decimal";
import { formatCountdown, quoteSecondsRemaining, quoteState } from "../../shared/quote";
import { ApiError, api } from "../api";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n-context";
import { Icon } from "../Icon";
import type { SheetRequest } from "../navigation";
import { DisabledCta, ScreenTitle, Tick } from "../ui";

type Side = "buy" | "sell";
type CryptoAsset = Exclude<AssetCode, "RUB">;

interface Props {
  wallet: WalletView;
  openSheet: (sheet: SheetRequest) => void;
}

const quoteErrors: Readonly<Record<string, MessageKey>> = {
  invalid_amount: "exchange.errorInvalidAmount",
  amount_too_small: "exchange.errorAmountTooSmall",
  invalid_pair: "exchange.errorInvalidPair",
  quote_unavailable: "exchange.errorQuoteUnavailable"
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
  const [error, setError] = useState<MessageKey | undefined>();
  const [loading, setLoading] = useState(false);
  const amountId = useId();
  const assetId = useId();
  const errorId = useId();
  const { t, format } = useI18n();
  const { amount, money, rate } = format;

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
      setError(caught instanceof ApiError ? quoteErrors[caught.code] ?? "exchange.errorQuoteFailed" : "exchange.errorQuoteFailed");
    } finally {
      setLoading(false);
    }
  }

  const statusText = !quote
    ? t("exchange.statusNone")
    : state === "expired"
      ? t("exchange.statusExpired")
      : t("exchange.statusFresh", { countdown: formatCountdown(remaining) });

  return (
    <section className="screen screen--exchange" aria-label={t("tab.exchange")}>
      <ScreenTitle>{t("tab.exchange")}</ScreenTitle>

      <fieldset className="segment" aria-label={t("exchange.directionLabel")}>
        {(["buy", "sell"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={side === value}
            onClick={() => {
              setSide(value);
              reset();
            }}
          >
            {t(value === "buy" ? "exchange.buy" : "exchange.sell")}
          </button>
        ))}
      </fieldset>

      {wallet.kyc !== "verified" ? (
        <button type="button" className="inline-alert" onClick={() => openSheet({ kind: "kyc-required" })}>
          <Icon name="id-card" size="sm" />
          <span>{t("exchange.kycAlert")}</span>
          <Icon name="chevron-right" size="sm" />
        </button>
      ) : null}

      <div className="exchange-field">
        <div className="exchange-field__head">
          <label className="field-label" htmlFor={amountId}>{t("exchange.youGive")}</label>
          <span className="exchange-field__balance num">{t("common.availableAmount", { amount: money(from, available) })}</span>
        </div>
        <div className="exchange-field__body">
          <input
            id={amountId}
            className="exchange-field__value num"
            inputMode="decimal"
            autoComplete="off"
            value={input}
            aria-invalid={input !== "" && !valid}
            aria-describedby={errorId}
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
          <span>{t("exchange.debitAmount")}</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              setInput(format.amountInput(from, available));
              reset();
            }}
          >
            {t("exchange.useAll")}
          </button>
        </div>
      </div>

      <button
        type="button"
        className="swap-arrow"
        aria-label={t("exchange.swapDirection")}
        onClick={() => {
          setSide(side === "buy" ? "sell" : "buy");
          reset();
        }}
      >
        <Icon name="swap-vertical" />
      </button>

      <div className="exchange-field">
        <div className="exchange-field__head">
          <span className="field-label">{t("exchange.youGet")}</span>
          <span className="exchange-field__balance">{t("exchange.preliminary")}</span>
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
          <span>{t("exchange.bySimulatorQuote")}</span>
          <strong className="num">{quote && state !== "expired" ? money(to, quote.value.amountOut, true) : ""}</strong>
        </div>
      </div>

      <div className={`exchange-summary${state === "expired" ? " is-expired" : ""}`}>
        <div className="exchange-summary__head">
          <strong>{t("exchange.terms")}</strong>
          <span
            className={`exchange-summary__status num is-${state ?? "empty"}`}
            role="timer"
            aria-live="off"
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
            <dt>{t("common.rate")}</dt>
            <dd className="num">{quote ? rate(quote.value.rate) : "—"}</dd>
          </div>
          <div>
            <dt>{t("common.fee")}</dt>
            <dd className="num">{quote ? t("exchange.feeIncluded", { amount: money(quote.value.feeAsset, quote.value.fee) }) : "—"}</dd>
          </div>
          <div>
            <dt>{t("exchange.spread")}</dt>
            <dd className="num">{quote ? t("exchange.spreadInRate", { value: format.decimal(fromUnits(BigInt(quote.value.spreadBps), 2), { fractionDigits: 2 }) }) : "—"}</dd>
          </div>
          <div>
            <dt>{t("exchange.totalDebit")}</dt>
            <dd className="num">{quote ? money(quote.value.from, quote.value.total) : "—"}</dd>
          </div>
        </dl>
        {state === "expired" ? (
          <div className="exchange-summary__expired">
            <Icon name="clock" size="sm" />
            <span>{t("exchange.expiredNotice")}</span>
          </div>
        ) : null}
        {quote?.value.insufficientBalance ? (
          <div className="exchange-summary__expired">
            <Icon name="alert" size="sm" />
            <span>{t("exchange.insufficientBalance")}</span>
          </div>
        ) : null}
      </div>

      <p className="form-error" id={errorId} aria-live="polite">
        {error ? t(error) : input !== "" && !valid ? t("exchange.errorInvalidAmount") : ""}
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {loading ? t("exchange.requesting") : quote ? t(state === "expired" ? "exchange.statusExpired" : "a11y.quoteReady") : t("exchange.statusNone")}
      </p>

      <button type="button" className="cta cta--secondary" onClick={requestQuote} disabled={loading}>
        {t(loading ? "exchange.requesting" : quote ? "exchange.refreshQuote" : "exchange.getQuote")}
      </button>

      <DisabledCta
        label={t("exchange.confirm")}
        hint={t("exchange.confirmHint")}
      />

      <p className="note">
        <span className="note__icon"><Icon name="info" size="xs" /></span>
        <span>{t("exchange.note", { seconds: quote?.value.ttlSeconds ?? 30 })}</span>
      </p>
    </section>
  );
}

function CryptoSelect({ id, value, onChange }: { id: string; value: CryptoAsset; onChange: (value: CryptoAsset) => void }) {
  const { t } = useI18n();
  return (
    <select
      id={id}
      className="asset-select"
      aria-label={t("exchange.cryptoAsset")}
      value={value}
      onChange={(event) => onChange(event.target.value === "TON" ? "TON" : "USDT")}
    >
      <option value="USDT">USDT</option>
      <option value="TON">TON</option>
    </select>
  );
}
