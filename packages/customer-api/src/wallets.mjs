import { createHash } from "node:crypto";

// Deterministic synthetic wallet source. A future wallet/ledger adapter
// replaces it behind `listFor(subject) -> Promise<WalletsView>`; payloads are
// frozen and derived from the subject only, so reads stay reproducible.
// Balances are decimal strings in asset scale; nothing here moves money.

export const WALLET_ASSETS = Object.freeze([
  Object.freeze({ code: "RUB", scale: 2 }),
  Object.freeze({ code: "TON", scale: 9 }),
  Object.freeze({ code: "USDT", scale: 6 })
]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-wallets-v1";
const WALLET_KEYS = Object.freeze(["wallet_id", "asset", "available", "hold"]);

/**
 * @typedef {object} WalletEntry
 * @property {string} wallet_id
 * @property {string} asset
 * @property {string} available
 * @property {string} hold
 */

/**
 * @typedef {object} WalletsView
 * @property {readonly WalletEntry[]} wallets
 */

/**
 * @typedef {object} WalletDirectory
 * @property {(subject: string) => Promise<WalletsView>} listFor
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

/**
 * @param {string} subject
 * @returns {WalletsView}
 */
function buildWalletsView(subject) {
  const wallets = WALLET_ASSETS.map(({ code, scale }) =>
    Object.freeze({
      wallet_id: `syn_wal_${digest(subject, `id:${code}`).toString("hex").slice(0, 12)}`,
      asset: code,
      available: decimal(units(subject, `available:${code}`, 10n ** BigInt(scale + 3)), scale),
      hold: decimal(units(subject, `hold:${code}`, 10n ** BigInt(scale + 1)), scale)
    })
  );
  return Object.freeze({ wallets: Object.freeze(wallets) });
}

/** @param {unknown} view */
export function validWalletsView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const keys = Object.keys(view);
  const wallets = /** @type {WalletsView} */ (view).wallets;
  return (
    keys.length === 1 &&
    keys[0] === "wallets" &&
    Array.isArray(wallets) &&
    wallets.every(
      (wallet) =>
        wallet !== null &&
        typeof wallet === "object" &&
        !Array.isArray(wallet) &&
        JSON.stringify(Object.keys(wallet).sort()) === JSON.stringify([...WALLET_KEYS].sort()) &&
        Object.values(wallet).every((value) => typeof value === "string")
    )
  );
}

/** @returns {WalletDirectory} */
export function createSyntheticWalletDirectory() {
  const cache = new Map();
  return Object.freeze({
    async listFor(subject) {
      let view = cache.get(subject);
      if (view === undefined) {
        view = buildWalletsView(subject);
        cache.set(subject, view);
      }
      return view;
    }
  });
}
