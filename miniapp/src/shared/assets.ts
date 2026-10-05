export type AssetCode = "RUB" | "USDT" | "TON";

export interface AssetMeta {
  code: AssetCode;
  name: string;
  symbol: string;
  scale: number;
  displayScale: number;
  network: string;
}

export const assetCodes: readonly AssetCode[] = Object.freeze(["RUB", "USDT", "TON"]);

export const assets: Readonly<Record<AssetCode, AssetMeta>> = Object.freeze({
  RUB: Object.freeze({
    code: "RUB",
    name: "Российский рубль",
    symbol: "₽",
    scale: 2,
    displayScale: 2,
    network: "Фиатный счёт"
  }),
  USDT: Object.freeze({
    code: "USDT",
    name: "Tether USD",
    symbol: "₮",
    scale: 6,
    displayScale: 2,
    network: "TON · тестовая сеть"
  }),
  TON: Object.freeze({
    code: "TON",
    name: "Toncoin",
    symbol: "T",
    scale: 9,
    displayScale: 4,
    network: "TON · тестовая сеть"
  })
});

export function isAssetCode(value: string): value is AssetCode {
  return value === "RUB" || value === "USDT" || value === "TON";
}
