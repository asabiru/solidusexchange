import { type AssetCode, assets } from "../shared/assets.js";
import type {
  AssetBalance,
  KycStatus,
  OperationDetail,
  OperationSummary,
  ProfileView,
  WalletView
} from "../shared/api.js";
import { fromUnits, toUnits } from "../shared/decimal.js";
import { valueInRub } from "./quotes.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const verifiedBalances: readonly { code: AssetCode; available: string; hold: string }[] = [
  { code: "RUB", available: "84200.00", hold: "0.00" },
  { code: "USDT", available: "482.180000", hold: "25.000000" },
  { code: "TON", available: "18.250000000", hold: "1.500000000" }
];

function sumRub(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + toUnits(value, assets.RUB.scale), 0n);
  return fromUnits(total, assets.RUB.scale);
}

export function walletView(
  kyc: KycStatus,
  entries: readonly { code: AssetCode; available: string; hold: string }[]
): WalletView {
  const balances: AssetBalance[] = entries.map((entry) => {
    const scale = assets[entry.code].scale;
    const total = fromUnits(toUnits(entry.available, scale) + toUnits(entry.hold, scale), scale);
    return { code: entry.code, available: entry.available, hold: entry.hold, valueRub: valueInRub(entry.code, total) };
  });
  return {
    kyc,
    totalRub: sumRub(balances.map((balance) => balance.valueRub)),
    availableRub: sumRub(balances.map((balance) => valueInRub(balance.code, balance.available))),
    holdRub: sumRub(balances.map((balance) => valueInRub(balance.code, balance.hold))),
    assets: balances
  };
}

function buildWallet(kyc: KycStatus): WalletView {
  const entries = verifiedBalances.map((entry) => ({
    code: entry.code,
    available: kyc === "verified" ? entry.available : fromUnits(0n, assets[entry.code].scale),
    hold: kyc === "verified" ? entry.hold : fromUnits(0n, assets[entry.code].scale)
  }));
  return walletView(kyc, entries);
}

const operations: readonly OperationDetail[] = [
  {
    id: "op-89104",
    reference: "SCX-89104",
    kind: "exchange",
    status: "completed",
    title: "Покупка USDT",
    channel: "Баланс RUB",
    createdAt: "2026-10-05T06:42:00Z",
    legs: [
      { asset: "USDT", amount: "120.000000", direction: "in" },
      { asset: "RUB", amount: "11028.00", direction: "out" }
    ],
    fee: { asset: "RUB", amount: "69.50" },
    rate: { base: "USDT", quote: "RUB", value: "91.32000000" },
    note: "Синтетическая операция для демонстрации интерфейса.",
    timeline: [
      { title: "Котировка зафиксирована", detail: "Курс и комиссия показаны до подтверждения", at: "2026-10-05T06:42:00Z", state: "done" },
      { title: "Средства зарезервированы", detail: "Сумма к списанию переведена в hold", at: "2026-10-05T06:42:05Z", state: "done" },
      { title: "Обмен завершён", detail: "USDT зачислены на баланс", at: "2026-10-05T06:43:00Z", state: "done" }
    ]
  },
  {
    id: "op-89071",
    reference: "SCX-89071",
    kind: "withdrawal",
    status: "in-review",
    title: "Вывод USDT",
    channel: "TON · тестовая сеть",
    createdAt: "2026-10-05T03:14:00Z",
    legs: [{ asset: "USDT", amount: "350.000000", direction: "out" }],
    fee: { asset: "USDT", amount: "1.000000" },
    note: "Синтетический пример: в тестовой версии вывод не исполняется.",
    timeline: [
      { title: "Заявка создана", detail: "Адрес из whitelist", at: "2026-10-05T03:14:00Z", state: "done" },
      { title: "Средства зарезервированы", detail: "Сумма и комиссия в hold", at: "2026-10-05T03:14:02Z", state: "done" },
      { title: "Проверка AML/KYT", detail: "Обычно занимает до 30 минут", state: "current" },
      { title: "Отправка в сеть", detail: "После завершения проверки", state: "pending" }
    ]
  },
  {
    id: "op-88990",
    reference: "SCX-88990",
    kind: "deposit",
    status: "needs-action",
    title: "Пополнение RUB",
    channel: "Банк",
    createdAt: "2026-10-04T12:10:00Z",
    legs: [{ asset: "RUB", amount: "25000.00", direction: "in" }],
    note: "Синтетический пример: требуется подтвердить источник средств.",
    timeline: [
      { title: "Платёж получен", detail: "Банковский перевод", at: "2026-10-04T12:10:00Z", state: "done" },
      { title: "Нужны данные", detail: "Подтвердите, что платёж отправлен с вашего счёта", state: "blocked" },
      { title: "Зачисление", detail: "После проверки реквизитов", state: "pending" }
    ]
  },
  {
    id: "op-88812",
    reference: "SCX-88812",
    kind: "exchange",
    status: "completed",
    title: "Обмен USDT на TON",
    channel: "Баланс USDT",
    createdAt: "2026-10-03T15:20:00Z",
    legs: [
      { asset: "TON", amount: "16.100000000", direction: "in" },
      { asset: "USDT", amount: "50.000000", direction: "out" }
    ],
    fee: { asset: "USDT", amount: "0.150000" },
    rate: { base: "USDT", quote: "TON", value: "0.32200000" },
    note: "Синтетическая операция для демонстрации интерфейса.",
    timeline: [
      { title: "Котировка зафиксирована", detail: "Курс и комиссия показаны до подтверждения", at: "2026-10-03T15:20:00Z", state: "done" },
      { title: "Обмен завершён", detail: "TON зачислены на баланс", at: "2026-10-03T15:20:40Z", state: "done" }
    ]
  },
  {
    id: "op-88644",
    reference: "SCX-88644",
    kind: "qr",
    status: "completed",
    title: "Оплата по QR",
    channel: "Тестовый получатель",
    createdAt: "2026-10-02T09:05:00Z",
    legs: [{ asset: "RUB", amount: "1250.00", direction: "out" }],
    fee: { asset: "RUB", amount: "0.00" },
    note: "Синтетическая операция: получатель вымышленный.",
    timeline: [
      { title: "Реквизиты проверены", detail: "Получатель, сумма и комиссия показаны", at: "2026-10-02T09:05:00Z", state: "done" },
      { title: "Оплата завершена", detail: "Чек сформирован", at: "2026-10-02T09:05:10Z", state: "done" }
    ]
  },
  {
    id: "op-88501",
    reference: "SCX-88501",
    kind: "deposit",
    status: "completed",
    title: "Пополнение TON",
    channel: "TON · тестовая сеть",
    createdAt: "2026-09-30T17:45:00Z",
    legs: [{ asset: "TON", amount: "20.000000000", direction: "in" }],
    note: "Синтетическая операция для демонстрации интерфейса.",
    timeline: [
      { title: "Транзакция обнаружена", detail: "Ожидание подтверждений сети", at: "2026-09-30T17:40:00Z", state: "done" },
      { title: "Проверка KYT", detail: "Риск низкий", at: "2026-09-30T17:44:00Z", state: "done" },
      { title: "Зачислено", detail: "TON доступны на балансе", at: "2026-09-30T17:45:00Z", state: "done" }
    ]
  },
  {
    id: "op-88410",
    reference: "SCX-88410",
    kind: "withdrawal",
    status: "failed",
    title: "Вывод RUB",
    channel: "Банк",
    createdAt: "2026-09-28T08:30:00Z",
    legs: [{ asset: "RUB", amount: "5000.00", direction: "out" }],
    note: "Синтетический пример: реквизиты третьего лица не принимаются, средства возвращены.",
    timeline: [
      { title: "Заявка создана", detail: "Банковский счёт", at: "2026-09-28T08:30:00Z", state: "done" },
      { title: "Отклонено", detail: "Можно выводить только на свои реквизиты", at: "2026-09-28T08:41:00Z", state: "blocked" },
      { title: "Средства возвращены", detail: "Hold снят", at: "2026-09-28T08:41:30Z", state: "done" }
    ]
  }
];

function summary(operation: OperationDetail): OperationSummary {
  const { id, reference, kind, status, title, channel, createdAt, legs } = operation;
  return { id, reference, kind, status, title, channel, createdAt, legs };
}

const profiles: Readonly<Record<KycStatus, Omit<ProfileView, "displayName" | "customerRef" | "apiAccess">>> = {
  verified: {
    kyc: {
      state: "verified",
      level: "Standard · синтетический",
      detail: "Личность подтверждена в тестовом сценарии. Реальная проверка не выполнялась.",
      steps: [
        { title: "Документ и селфи", detail: "Проверка успешно завершена", state: "done" },
        { title: "Телефон и email", detail: "Оба контакта подтверждены", state: "done" }
      ]
    },
    limits: limitsNotConfigured(),
    fees: fees(),
    security: security()
  },
  "kyc-gated": {
    kyc: {
      state: "kyc-gated",
      level: "Не пройдена",
      detail: "Проверка открывает обмен и вывод, защищает аккаунт и обычно занимает до 10 минут.",
      steps: [
        { title: "Подтвердить контакты", detail: "Телефон и email", state: "required" },
        { title: "Документ и селфи", detail: "Паспортные данные и проверка лица", state: "required" }
      ]
    },
    limits: limitsNotConfigured(),
    fees: fees(),
    security: security()
  }
};

function limitsNotConfigured(): ProfileView["limits"] {
  return {
    status: "not_configured",
    decision: "D-014",
    message: "Лимиты не настроены: точные значения ожидают утверждения (D-014). Без утверждённого профиля лимитов операции не исполняются."
  };
}

function fees(): ProfileView["fees"] {
  return [
    { title: "Обмен", value: "Фиксируется в котировке · симулятор 0,30% + спред 0,50%" },
    { title: "Пополнение", value: "Недоступно в тестовой версии" },
    { title: "Вывод", value: "Недоступно в тестовой версии" }
  ];
}

function security(): ProfileView["security"] {
  return [
    { title: "Подтверждение действий", detail: "MFA и повторное подтверждение — в следующих версиях", status: "placeholder" },
    { title: "Активные сессии", detail: "Управление сессиями появится позже", status: "placeholder" },
    { title: "Whitelist адресов", detail: "24-часовая задержка для нового адреса — в разработке", status: "placeholder" }
  ];
}

const wallets: Readonly<Record<KycStatus, WalletView>> = deepFreeze({
  verified: buildWallet("verified"),
  "kyc-gated": buildWallet("kyc-gated")
});

deepFreeze(operations);
deepFreeze(profiles);

export const syntheticData = Object.freeze({
  wallet(kyc: KycStatus): WalletView {
    return wallets[kyc];
  },
  available(kyc: KycStatus, asset: AssetCode): string {
    const balance = wallets[kyc].assets.find((entry) => entry.code === asset);
    return balance?.available ?? fromUnits(0n, assets[asset].scale);
  },
  operations(kyc: KycStatus): readonly OperationSummary[] {
    return kyc === "verified" ? operations.map(summary) : [];
  },
  operation(kyc: KycStatus, id: string): OperationDetail | undefined {
    return kyc === "verified" ? operations.find((operation) => operation.id === id) : undefined;
  },
  profile(kyc: KycStatus, displayName: string, customerRef: string): Omit<ProfileView, "apiAccess"> {
    return { displayName, customerRef, ...profiles[kyc] };
  }
});
