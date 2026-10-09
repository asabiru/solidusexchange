import { createHash } from "node:crypto";

// Deterministic synthetic card source. A future cards adapter replaces it
// behind `listFor(subject) -> Promise<CardsView>`; payloads are frozen and
// derived from the subject only, so reads stay reproducible. Every record is
// a test-mode payment card issued to the subject (the customer.cards.issue
// command's domain — a financial command that stays denied under the open
// issuer and geography decisions). Identifiers are masked on purpose: last4
// and the tokenized reference are the only PAN-adjacent data a customer API
// may ever expose, so a full card number can never appear here. monthly_limit
// is the card's RUB spend ceiling at scale 2 — an observed configuration,
// not an authorization: posting stays "none" and nothing here is a ledger
// entry or moves money. No I/O.

// The status set is the card lifecycle for an issued instrument: the card is
// issued awaiting customer activation (pending_activation), activated
// (active), placed on a customer-initiated reversible hold (frozen),
// blocked by the issuer or operations (blocked), or it terminates as expired
// or terminated. A settled/ledger-posting status would imply a money effect
// that posting "none" forbids.
export const CARD_STATUSES = Object.freeze([
  "pending_activation",
  "active",
  "frozen",
  "blocked",
  "expired",
  "terminated"
]);
export const CARD_BRANDS = Object.freeze(["visa", "mastercard", "mir"]);
export const CARD_KINDS = Object.freeze(["virtual", "physical"]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-cards-v1";
const VIEW_KEYS = Object.freeze(["mode", "cards"]);
const CARD_KEYS = Object.freeze([
  "card_id",
  "brand",
  "kind",
  "status",
  "last4",
  "token_reference",
  "asset",
  "monthly_limit",
  "created_at",
  "expires_at",
  "updated_at",
  "posting"
]);
const CARD_ID_PATTERN = /^crd_[0-9a-f]{24}$/u;
const ASSET_PATTERN = /^[A-Z0-9]{2,16}$/u;
const LAST4_PATTERN = /^[0-9]{4}$/u;
const TOKEN_REFERENCE_PATTERN = /^tok_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const RUB_SCALE = 2;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;
const YEAR_MS = 365 * 86_400_000;

/**
 * @typedef {object} CardView
 * @property {string} card_id
 * @property {string} brand
 * @property {string} kind
 * @property {string} status
 * @property {string} last4
 * @property {string} token_reference
 * @property {string} asset
 * @property {string} monthly_limit
 * @property {string} created_at
 * @property {string} expires_at
 * @property {string} updated_at
 * @property {string} posting
 */

/**
 * @typedef {object} CardsView
 * @property {string} mode
 * @property {readonly CardView[]} cards
 */

/**
 * @typedef {object} CardDirectory
 * @property {(subject: string) => Promise<CardsView>} listFor
 */

/**
 * @param {string} subject
 * @param {string} salt
 */
function digest(subject, salt) {
  return createHash("sha256").update(`${SIGNATURE_DOMAIN}\n${subject}\n${salt}`).digest();
}

/**
 * @param {string} subject
 * @param {string} salt
 * @param {bigint} bound
 */
function units(subject, salt, bound) {
  return digest(subject, salt).readBigUInt64BE(0) % bound;
}

/**
 * @param {bigint} value
 * @param {number} scale
 */
function decimal(value, scale) {
  const text = String(value).padStart(scale + 1, "0");
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

/** @param {string} text */
function parseUnits(text) {
  return BigInt(text.replace(".", ""));
}

/**
 * @param {string} subject
 * @param {number} index
 * @returns {CardView}
 */
function buildCard(subject, index) {
  const brand = CARD_BRANDS[Number(units(subject, `brand:${index}`, BigInt(CARD_BRANDS.length)))];
  const kind = CARD_KINDS[Number(units(subject, `kind:${index}`, BigInt(CARD_KINDS.length)))];
  const status = CARD_STATUSES[Number(units(subject, `status:${index}`, BigInt(CARD_STATUSES.length)))];
  const limitMinor = 500_000n + units(subject, `limit:${index}`, 4_500_001n);
  const createdMs = BASE_MS + index * STEP_MS + Number(units(subject, `created:${index}`, BigInt(STEP_MS)));
  // A card in force expires roughly three to four years after issuance; an
  // already-expired card carries a shorter past validity window and its last
  // observation is exactly the expiry transition.
  const expiresMs =
    status === "expired"
      ? createdMs + YEAR_MS + Number(units(subject, `expiry:${index}`, BigInt(YEAR_MS)))
      : createdMs + 3 * YEAR_MS + Number(units(subject, `expiry:${index}`, BigInt(YEAR_MS)));
  // A resting unactivated card has never changed; an expired one updates
  // exactly at its expiry; every other observation is its transition
  // timestamp (within a day of creation like the other reads).
  const updatedMs =
    status === "pending_activation"
      ? createdMs
      : status === "expired"
        ? expiresMs
        : createdMs + (10 + Number(units(subject, `updated:${index}`, 281n))) * 1_000;
  return Object.freeze({
    card_id: `crd_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    brand,
    kind,
    status,
    last4: String(units(subject, `last4:${index}`, 10_000n)).padStart(4, "0"),
    token_reference: `tok_${digest(subject, `token:${index}`).toString("hex").slice(0, 24)}`,
    asset: "RUB",
    monthly_limit: decimal(limitMinor, RUB_SCALE),
    created_at: new Date(createdMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
    updated_at: new Date(updatedMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {CardsView}
 */
function buildCardsView(subject) {
  const count = 1 + Number(units(subject, "count", 4n));
  const cards = Object.freeze(
    Array.from({ length: count }, (_value, index) => buildCard(subject, index)).reverse()
  );
  return Object.freeze({ mode: "test", cards });
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/**
 * Canonical non-negative decimal string with exactly `scale` fraction digits.
 *
 * @param {unknown} value
 * @param {number} scale
 */
function isScaledDecimal(value, scale) {
  return (
    typeof value === "string" &&
    new RegExp(`^(0|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u").test(value)
  );
}

/** @param {unknown} card */
function validCard(card) {
  if (card === null || typeof card !== "object" || Array.isArray(card)) {
    return false;
  }
  const candidate = /** @type {CardView} */ (card);
  if (JSON.stringify(Object.keys(card).sort()) !== JSON.stringify([...CARD_KEYS].sort())) {
    return false;
  }
  if (
    !CARD_ID_PATTERN.test(candidate.card_id) ||
    !CARD_BRANDS.includes(candidate.brand) ||
    !CARD_KINDS.includes(candidate.kind) ||
    !CARD_STATUSES.includes(candidate.status) ||
    !LAST4_PATTERN.test(candidate.last4) ||
    !TOKEN_REFERENCE_PATTERN.test(candidate.token_reference) ||
    !ASSET_PATTERN.test(candidate.asset) ||
    // Card spend limits settle against the subject's fiat balance: the only
    // settlement asset in this model is RUB at scale 2.
    candidate.asset !== "RUB" ||
    candidate.posting !== "none"
  ) {
    return false;
  }
  if (!isScaledDecimal(candidate.monthly_limit, RUB_SCALE) || parseUnits(candidate.monthly_limit) <= 0n) {
    return false;
  }
  if (
    !isIsoTimestamp(candidate.created_at) ||
    !isIsoTimestamp(candidate.expires_at) ||
    !isIsoTimestamp(candidate.updated_at)
  ) {
    return false;
  }
  const created = Date.parse(candidate.created_at);
  const expires = Date.parse(candidate.expires_at);
  const updated = Date.parse(candidate.updated_at);
  // Lifecycle coherence mirrors the synthetic build: a card cannot expire
  // before issuance, a resting unactivated card has never changed, an
  // expired card last changed exactly at its expiry, and every other
  // observation updates strictly after creation.
  if (expires <= created) {
    return false;
  }
  if (candidate.status === "pending_activation") {
    return updated === created;
  }
  if (candidate.status === "expired") {
    return updated === expires;
  }
  return updated > created;
}

/** @param {unknown} view */
export function validCardsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {CardsView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (candidate.mode !== "test" || !Array.isArray(candidate.cards)) {
    return false;
  }
  return candidate.cards.every(validCard);
}

/** @returns {CardDirectory} */
export function createSyntheticCardDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildCardsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
