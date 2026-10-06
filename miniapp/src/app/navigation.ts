import type { AssetCode } from "../shared/assets";

export type Tab = "home" | "exchange" | "qr" | "activity" | "profile";

export type SheetRequest =
  | { kind: "asset"; asset: AssetCode }
  | { kind: "deposit"; asset?: AssetCode }
  | { kind: "withdraw"; asset?: AssetCode }
  | { kind: "kyc-required" }
  | { kind: "kyc" }
  | { kind: "limits" }
  | { kind: "security" }
  | { kind: "support" }
  | { kind: "operation"; id: string }
  | { kind: "qr-manual" }
  | { kind: "qr-image" }
  | { kind: "notifications" };
