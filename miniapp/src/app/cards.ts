import { isDecimalString } from "../shared/decimal.js";
import type { CardBrand, CardKind, CardStatus, CardView } from "../shared/api.js";
import type { MessageKey } from "./i18n.js";
import { boundedRows, hasExactKeys, isEpochMs, isKycFlag, isRecord, type ServedKycRows } from "./served-views.js";

export interface CardBadge {
  label: MessageKey;
  tone: string;
}

const cardStatuses: Readonly<Record<CardStatus, CardBadge>> = Object.freeze({
  pending_activation: Object.freeze({ label: "cards.statusPendingActivation", tone: "warning" }),
  active: Object.freeze({ label: "cards.statusActive", tone: "success" }),
  frozen: Object.freeze({ label: "cards.statusFrozen", tone: "muted" }),
  blocked: Object.freeze({ label: "cards.statusBlocked", tone: "risk" }),
  expired: Object.freeze({ label: "cards.statusExpired", tone: "muted" }),
  terminated: Object.freeze({ label: "cards.statusTerminated", tone: "muted" })
});

const cardKinds: Readonly<Record<CardKind, CardBadge>> = Object.freeze({
  virtual: Object.freeze({ label: "cards.kindVirtual", tone: "muted" }),
  physical: Object.freeze({ label: "cards.kindPhysical", tone: "muted" })
});

const cardBrands: Readonly<Record<CardBrand, CardBadge>> = Object.freeze({
  mir: Object.freeze({ label: "cards.brandMir", tone: "muted" }),
  visa: Object.freeze({ label: "cards.brandVisa", tone: "muted" }),
  mastercard: Object.freeze({ label: "cards.brandMastercard", tone: "muted" })
});

/** Served status/kind/brand tags are untrusted: only declared members resolve. */
export function cardStatusBadge(status: string): CardBadge | undefined {
  return Object.hasOwn(cardStatuses, status) ? cardStatuses[status as CardStatus] : undefined;
}

export function cardKindBadge(kind: string): CardBadge | undefined {
  return Object.hasOwn(cardKinds, kind) ? cardKinds[kind as CardKind] : undefined;
}

export function cardBrandBadge(brand: string): CardBadge | undefined {
  return Object.hasOwn(cardBrands, brand) ? cardBrands[brand as CardBrand] : undefined;
}

const cardIdPattern = /^crd_[0-9a-f]{24}$/;
const cardTokenReferencePattern = /^tok_[0-9a-f]{24}$/;
const cardLast4Pattern = /^[0-9]{4}$/;
export const cardRubScale = 2;

const cardViewKeys = [
  "id",
  "brand",
  "kind",
  "status",
  "last4",
  "tokenReference",
  "asset",
  "monthlyLimit",
  "createdAt",
  "expiresAt",
  "updatedAt",
  "posting"
] as const;

function isCardRow(value: unknown): value is CardView {
  if (!isRecord(value) || !hasExactKeys(value, cardViewKeys)) return false;
  return (
    typeof value.id === "string"
    && cardIdPattern.test(value.id)
    && typeof value.brand === "string"
    && cardBrandBadge(value.brand) !== undefined
    && typeof value.kind === "string"
    && cardKindBadge(value.kind) !== undefined
    && typeof value.status === "string"
    && cardStatusBadge(value.status) !== undefined
    && typeof value.last4 === "string"
    && cardLast4Pattern.test(value.last4)
    && typeof value.tokenReference === "string"
    && cardTokenReferencePattern.test(value.tokenReference)
    && value.asset === "RUB"
    && typeof value.monthlyLimit === "string"
    && isDecimalString(value.monthlyLimit, cardRubScale)
    && isEpochMs(value.createdAt)
    && isEpochMs(value.expiresAt)
    && isEpochMs(value.updatedAt)
    && value.posting === "none"
  );
}

/** Validates the served cards view like the trades/checks adapters. */
export function cardsHistory(view: unknown): ServedKycRows<CardView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "kyc", "cards"])
    || view.mode !== "test"
    || !isKycFlag(view.kyc)
    || !Array.isArray(view.cards)
    || !(view.cards as readonly unknown[]).every(isCardRow)
  ) {
    return undefined;
  }
  return { kyc: view.kyc, ...boundedRows(view.cards as readonly CardView[]) };
}
