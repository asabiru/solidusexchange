import type { AssetCode } from "./assets.js";

export type ScreeningNetwork = "TON_TESTNET" | "TRON_TESTNET";
export type ScreeningAsset = Extract<AssetCode, "TON" | "USDT">;

export interface ScreeningTarget {
  id: string;
  asset: ScreeningAsset;
  network: ScreeningNetwork;
  label: string;
  networkLabel: string;
  placeholder: string;
}

/** Testnet-only asset/network pairs offered for the test-mode address check. */
export const screeningTargets: readonly ScreeningTarget[] = Object.freeze([
  Object.freeze({
    id: "ton-testnet",
    asset: "TON",
    network: "TON_TESTNET",
    label: "TON",
    networkLabel: "TON · тестовая сеть",
    placeholder: "kQ… или 0Q…"
  }),
  Object.freeze({
    id: "usdt-ton-testnet",
    asset: "USDT",
    network: "TON_TESTNET",
    label: "USDT · TON",
    networkLabel: "TON · тестовая сеть",
    placeholder: "kQ… или 0Q…"
  }),
  Object.freeze({
    id: "usdt-tron-testnet",
    asset: "USDT",
    network: "TRON_TESTNET",
    label: "USDT · TRON",
    networkLabel: "TRON · тестовая сеть",
    placeholder: "T…"
  })
] satisfies ScreeningTarget[]);

export function screeningTargetOf(asset: string, network: string): ScreeningTarget | undefined {
  return screeningTargets.find((target) => target.asset === asset && target.network === network);
}
