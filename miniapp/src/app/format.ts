import type { ExchangeRate, OperationLeg, OperationStatus } from "../shared/api";
import { type AssetCode, assets } from "../shared/assets";
import { formatDecimal } from "../shared/decimal";

export function amount(asset: AssetCode, value: string, precise = false): string {
  const meta = assets[asset];
  const fractionDigits = precise ? meta.scale : meta.displayScale;
  return formatDecimal(value, {
    fractionDigits,
    minFractionDigits: Math.min(2, fractionDigits)
  });
}

export function money(asset: AssetCode, value: string, precise = false): string {
  const formatted = amount(asset, value, precise);
  return asset === "RUB" ? `${formatted}\u00a0₽` : `${formatted}\u00a0${asset}`;
}

export function signedLeg(leg: OperationLeg): string {
  const signed = leg.direction === "out" ? `-${leg.amount}` : leg.amount;
  const meta = assets[leg.asset];
  const formatted = formatDecimal(signed, {
    fractionDigits: meta.displayScale,
    minFractionDigits: Math.min(2, meta.displayScale),
    signDisplay: "always"
  });
  return leg.asset === "RUB" ? `${formatted}\u00a0₽` : `${formatted}\u00a0${leg.asset}`;
}

export function rate(value: ExchangeRate): string {
  const digits = value.quote === "RUB" ? 2 : 6;
  const formatted = formatDecimal(value.value, { fractionDigits: digits, minFractionDigits: 2 });
  const quote = value.quote === "RUB" ? "₽" : value.quote;
  return `1 ${value.base} = ${formatted}\u00a0${quote}`;
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bishkek"
});

export function dateTime(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export const statusLabels: Readonly<Record<OperationStatus, string>> = {
  completed: "Завершено",
  "in-review": "Проверка AML",
  "needs-action": "Нужны данные",
  failed: "Отклонено"
};
