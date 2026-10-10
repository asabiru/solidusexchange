import type { CardBrand, CardKind, CardsView, CardStatus, CardView, KycStatus } from "../shared/api.js";

export const cardIdPattern = /^crd_[0-9a-f]{24}$/;
export const cardTokenReferencePattern = /^tok_[0-9a-f]{24}$/;
export const cardLast4Pattern = /^[0-9]{4}$/;
export const cardRubScale = 2;
export const cardBrands: readonly CardBrand[] = Object.freeze(["visa", "mastercard", "mir"]);
export const cardKinds: readonly CardKind[] = Object.freeze(["virtual", "physical"]);
export const cardStatuses: readonly CardStatus[] = Object.freeze([
  "pending_activation",
  "active",
  "frozen",
  "blocked",
  "expired",
  "terminated"
]);

export function isCardBrand(value: unknown): value is CardBrand {
  return typeof value === "string" && (cardBrands as readonly string[]).includes(value);
}

export function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && (cardKinds as readonly string[]).includes(value);
}

export function isCardStatus(value: unknown): value is CardStatus {
  return typeof value === "string" && (cardStatuses as readonly string[]).includes(value);
}

/** The customer-api cards contract entry shape (snake_case field names). */
export interface ContractCard {
  card_id: string;
  brand: CardBrand;
  kind: CardKind;
  status: CardStatus;
  last4: string;
  token_reference: string;
  asset: "RUB";
  monthly_limit: string;
  created_at: string;
  expires_at: string;
  updated_at: string;
  posting: "none";
}

/**
 * Adapts validated customer-api card entries into the app's cards view:
 * card_id becomes id, token_reference/monthly_limit become camelCase and
 * the ISO timestamps parse to milliseconds. The masked identifiers (last4,
 * token_reference) are the only card data the contract ever exposes, so the
 * app view can never carry a full PAN either. The app keeps its own kyc flag
 * — the contract view has no session-state counterpart.
 */
export function contractCardsView(cards: readonly ContractCard[], kyc: KycStatus): CardsView {
  return {
    mode: "test",
    kyc,
    cards: cards.map((card) => ({
      id: card.card_id,
      brand: card.brand,
      kind: card.kind,
      status: card.status,
      last4: card.last4,
      tokenReference: card.token_reference,
      asset: card.asset,
      monthlyLimit: card.monthly_limit,
      createdAt: Date.parse(card.created_at),
      expiresAt: Date.parse(card.expires_at),
      updatedAt: Date.parse(card.updated_at),
      posting: "none"
    }))
  };
}

const syntheticCards: readonly CardView[] = Object.freeze([
  Object.freeze({
    id: "crd_a1b2c3d4e5f6a7b8c9d0e1f2",
    brand: "mir",
    kind: "physical",
    status: "active",
    last4: "4832",
    tokenReference: "tok_a1b2c3d4e5f6a7b8c9d0e1f2",
    asset: "RUB",
    monthlyLimit: "250000.00",
    createdAt: Date.parse("2026-09-12T10:00:00.000Z"),
    expiresAt: Date.parse("2029-09-12T00:00:00.000Z"),
    updatedAt: Date.parse("2026-09-12T10:05:00.000Z"),
    posting: "none"
  }),
  Object.freeze({
    id: "crd_f1e2d3c4b5a6f7e8d9c0b1a2",
    brand: "visa",
    kind: "virtual",
    status: "pending_activation",
    last4: "7716",
    tokenReference: "tok_f1e2d3c4b5a6f7e8d9c0b1a2",
    asset: "RUB",
    monthlyLimit: "100000.00",
    createdAt: Date.parse("2026-10-08T09:15:00.000Z"),
    expiresAt: Date.parse("2029-10-08T09:15:00.000Z"),
    updatedAt: Date.parse("2026-10-08T09:15:00.000Z"),
    posting: "none"
  })
]);

const views: Readonly<Record<KycStatus, CardsView>> = Object.freeze({
  verified: Object.freeze({ mode: "test", kyc: "verified", cards: syntheticCards }),
  "kyc-gated": Object.freeze({ mode: "test", kyc: "kyc-gated", cards: Object.freeze([]) })
});

/**
 * The local synthetic cards list: a verified session sees the frozen
 * test-mode card observations (masked identifiers only — the view can never
 * carry a full PAN); a gated session sees the same shape emptied in place
 * (like the payments gated view). Observational only — every entry carries
 * posting "none", no card command is served and nothing here moves money.
 */
export function cardsView(kyc: KycStatus): CardsView {
  return views[kyc];
}
