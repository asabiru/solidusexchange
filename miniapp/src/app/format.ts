import type { ExchangeRate, OperationLeg, OperationStatus } from "../shared/api.js";
import { type AssetCode, assets } from "../shared/assets.js";
import { type FormatOptions, formatDecimal } from "../shared/decimal.js";
import { decimalSeparators, intlLocale, type Locale, type MessageKey } from "./i18n.js";

export const statusLabelKeys: Readonly<Record<OperationStatus, MessageKey>> = {
  completed: "status.completed",
  "in-review": "status.inReview",
  "needs-action": "status.needsAction",
  failed: "status.failed"
};

export const assetNameKeys: Readonly<Record<AssetCode, MessageKey>> = {
  RUB: "asset.RUB.name",
  USDT: "asset.USDT.name",
  TON: "asset.TON.name"
};

export const assetNetworkKeys: Readonly<Record<AssetCode, MessageKey>> = {
  RUB: "asset.RUB.network",
  USDT: "asset.USDT.network",
  TON: "asset.TON.network"
};

export interface Formatter {
  decimal: (value: string, options: Omit<FormatOptions, "separators">) => string;
  amount: (asset: AssetCode, value: string, precise?: boolean) => string;
  money: (asset: AssetCode, value: string, precise?: boolean) => string;
  signedLeg: (leg: OperationLeg) => string;
  rate: (value: ExchangeRate) => string;
  dateTime: (iso: string) => string;
  amountInput: (asset: AssetCode, value: string) => string;
}

function withUnit(asset: AssetCode, formatted: string): string {
  return asset === "RUB" ? `${formatted}\u00a0₽` : `${formatted}\u00a0${asset}`;
}

/** Locale-aware formatting. Amounts stay exact decimal strings; only separators come from Intl. */
export function createFormatter(locale: Locale): Formatter {
  const separators = decimalSeparators(locale);
  const dateFormat = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bishkek"
  });
  const decimal = (value: string, options: Omit<FormatOptions, "separators">) =>
    formatDecimal(value, { ...options, separators });

  const amount = (asset: AssetCode, value: string, precise = false) => {
    const meta = assets[asset];
    const fractionDigits = precise ? meta.scale : meta.displayScale;
    return decimal(value, { fractionDigits, minFractionDigits: Math.min(2, fractionDigits) });
  };

  return {
    decimal,
    amount,
    money: (asset, value, precise = false) => withUnit(asset, amount(asset, value, precise)),
    signedLeg: (leg) => {
      const meta = assets[leg.asset];
      const formatted = decimal(leg.direction === "out" ? `-${leg.amount}` : leg.amount, {
        fractionDigits: meta.displayScale,
        minFractionDigits: Math.min(2, meta.displayScale),
        signDisplay: "always"
      });
      return withUnit(leg.asset, formatted);
    },
    rate: (value) => {
      const digits = value.quote === "RUB" ? 2 : 6;
      const formatted = decimal(value.value, { fractionDigits: digits, minFractionDigits: 2 });
      const quote = value.quote === "RUB" ? "₽" : value.quote;
      return `1 ${value.base} = ${formatted}\u00a0${quote}`;
    },
    dateTime: (iso) => dateFormat.format(new Date(iso)),
    amountInput: (asset, value) => {
      const plain = formatDecimal(value, { fractionDigits: assets[asset].scale, minFractionDigits: 0 });
      return plain.replace(/\u00a0/g, "").replace(",", separators.decimal);
    }
  };
}
