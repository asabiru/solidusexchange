import type { ExchangeRate } from "../shared/api.js";
import { type AssetCode, assetMetaOf } from "../shared/assets.js";
import { type DecimalSeparators, DecimalError, type FormatOptions, formatDecimal, normalizeAmountInput } from "../shared/decimal.js";
import { decimalSeparators, type IntlSupport, intlLocale, intlSupported, type Locale, type MessageKey } from "./i18n.js";

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

/** Server-provided asset codes are untrusted input: only declared members resolve to a label. */
export function assetNameKey(code: string): MessageKey | undefined {
  return Object.hasOwn(assetNameKeys, code) ? assetNameKeys[code as AssetCode] : undefined;
}

export function assetNetworkKey(code: string): MessageKey | undefined {
  return Object.hasOwn(assetNetworkKeys, code) ? assetNetworkKeys[code as AssetCode] : undefined;
}

export interface Formatter {
  decimal: (value: string, options: Omit<FormatOptions, "separators">) => string;
  amount: (asset: string, value: string, precise?: boolean) => string;
  money: (asset: string, value: string, precise?: boolean) => string;
  /** Server-supplied legs are untrusted input: direction/asset/amount are validated at render time. */
  signedLeg: (leg: { direction: string; asset: string; amount: string }) => string;
  rate: (value: ExchangeRate) => string;
  dateTime: (iso: string) => string;
  epochMs: (at: number) => string;
  amountInput: (asset: string, value: string) => string;
  parseAmountInput: (input: string) => string;
}

/** A malformed or foreign server amount renders as a dash, like an invalid date — never throws. */
const unreadable = "\u2014";

function formattedOrDash(value: string, options: Omit<FormatOptions, "separators">, separators: DecimalSeparators): string {
  try {
    return formatDecimal(value, { ...options, separators });
  } catch (error) {
    if (error instanceof DecimalError) return unreadable;
    throw error;
  }
}

function withUnit(asset: string, formatted: string): string {
  return asset === "RUB" ? `${formatted}\u00a0₽` : `${formatted}\u00a0${asset}`;
}

/** Locale-aware formatting. Amounts stay exact decimal strings; only separators come from Intl. */
export function createFormatter(locale: Locale, supported: IntlSupport = intlSupported): Formatter {
  const separators = decimalSeparators(locale, supported);
  const tag = intlLocale(locale, supported);
  // Without native Kyrgyz data use numeric dates so no Russian month names leak into the Kyrgyz UI.
  const numericDates = locale === "ky" && tag !== "ky-KG";
  const dateFormat = new Intl.DateTimeFormat(tag, {
    day: numericDates ? "2-digit" : "numeric",
    month: numericDates ? "2-digit" : "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bishkek"
  });
  const decimal = (value: string, options: Omit<FormatOptions, "separators">) =>
    formatDecimal(value, { ...options, separators });

  const amount = (asset: string, value: string, precise = false) => {
    const meta = assetMetaOf(asset);
    if (!meta) return unreadable;
    const fractionDigits = precise ? meta.scale : meta.displayScale;
    return formattedOrDash(value, { fractionDigits, minFractionDigits: Math.min(2, fractionDigits) }, separators);
  };

  return {
    decimal,
    amount,
    money: (asset, value, precise = false) => withUnit(asset, amount(asset, value, precise)),
    signedLeg: (leg) => {
      const meta = assetMetaOf(leg.asset);
      if (!meta || (leg.direction !== "in" && leg.direction !== "out")) return withUnit(leg.asset, unreadable);
      const formatted = formattedOrDash(leg.direction === "out" ? `-${leg.amount}` : leg.amount, {
        fractionDigits: meta.displayScale,
        minFractionDigits: Math.min(2, meta.displayScale),
        signDisplay: "always"
      }, separators);
      return withUnit(leg.asset, formatted);
    },
    rate: (value) => {
      const digits = value.quote === "RUB" ? 2 : 6;
      const formatted = formattedOrDash(value.value, { fractionDigits: digits, minFractionDigits: 2 }, separators);
      const quote = value.quote === "RUB" ? "₽" : value.quote;
      return `1 ${value.base} = ${formatted}\u00a0${quote}`;
    },
    dateTime: (iso) => {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? unreadable : dateFormat.format(date);
    },
    epochMs: (at) => {
      const date = new Date(at);
      return Number.isNaN(date.getTime()) ? unreadable : dateFormat.format(date);
    },
    amountInput: (asset, value) => {
      const meta = assetMetaOf(asset);
      if (!meta) return value;
      try {
        const plain = formatDecimal(value, { fractionDigits: meta.scale, minFractionDigits: 0 });
        return plain.replace(/\u00a0/g, "").replace(",", separators.decimal);
      } catch (error) {
        if (error instanceof DecimalError) return value;
        throw error;
      }
    },
    parseAmountInput: (input) => normalizeAmountInput(input, separators)
  };
}
