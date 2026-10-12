import { createHash } from "node:crypto";

// Deterministic synthetic deposit-address source. A future wallet/custody
// adapter replaces it behind `listFor(subject) -> Promise<DepositAddressesView>`;
// payloads are frozen and derived from the subject only, so reads stay
// reproducible. Every record is a test-mode receiving endpoint on the
// custody-dev-v1 asset/network allowlist — posting stays "none" and nothing
// here is a ledger entry, a custody intent or key material: the served
// addresses are opaque testnet-looking strings derived from a signature
// domain, never real wallet addresses. No I/O.

// The status set is deliberately single-valued: the dev slice serves only the
// subject's current receiving addresses — no rotation or disabled lifecycle
// is modelled, so anything else fails closed.
export const DEPOSIT_ADDRESS_STATUSES = Object.freeze(["active"]);

// The asset/network pairs mirror the custody-dev-v1 allowlist in
// packages/custody-core/custody-policy.json exactly (same set the miniapp
// screening targets offer).
export const DEPOSIT_ADDRESS_TARGETS = Object.freeze([
  Object.freeze({ asset: "TON", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TON_TESTNET" }),
  Object.freeze({ asset: "USDT", network: "TRON_TESTNET" })
]);

const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-deposit-addresses-v1";
const VIEW_KEYS = Object.freeze(["deposit_addresses", "mode"]);
const DEPOSIT_ADDRESS_KEYS = Object.freeze([
  "address",
  "asset",
  "created_at",
  "deposit_address_id",
  "network",
  "posting",
  "status"
]);
const DEPOSIT_ADDRESS_ID_PATTERN = /^dpa_[0-9a-f]{24}$/u;
const ASSET_PATTERN = /^[A-Z0-9]{2,16}$/u;
const TESTNET_PATTERN = /^[A-Z0-9]+_TESTNET$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const BASE_MS = Date.parse("2026-09-01T00:00:00.000Z");
const STEP_MS = 86_400_000;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TON_TESTNET_TAG = 0x91;
const TON_TESTNET_ADDRESS_PATTERN = /^kQ[A-Za-z0-9_-]{46}$/u;
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

/**
 * @typedef {object} DepositAddressView
 * @property {string} deposit_address_id
 * @property {string} asset
 * @property {string} network
 * @property {string} address
 * @property {string} status
 * @property {string} created_at
 * @property {string} posting
 */

/**
 * @typedef {object} DepositAddressesView
 * @property {string} mode
 * @property {readonly DepositAddressView[]} deposit_addresses
 */

/**
 * @typedef {object} DepositAddressDirectory
 * @property {(subject: string) => Promise<DepositAddressesView>} listFor
 */

/**
 * @param {string} subject
 * @param {string} salt
 */
function digest(subject, salt) {
  return createHash("sha256").update(`${SIGNATURE_DOMAIN}\n${subject}\n${salt}`).digest();
}

/**
 * CRC-16/XModem over the given bytes; matches the user-friendly address
 * checksum in miniapp/src/server/address-screening.ts.
 * @param {Uint8Array} bytes
 */
function crc16(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Testnet-looking TON user-friendly address (bounceable testnet tag,
 * workchain 0, 32-byte digest, CRC-16) — a sha256-derived string that shares
 * only the shape of a real testnet address.
 * @param {string} subject
 * @param {string} salt
 */
function tonTestnetAddress(subject, salt) {
  const body = Buffer.concat([
    Buffer.from([TON_TESTNET_TAG, 0x00]),
    digest(subject, salt).subarray(0, 32)
  ]);
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16BE(crc16(body), 0);
  return Buffer.concat([body, checksum]).toString("base64url");
}

/**
 * Base58Check TRON address (0x41 prefix + 20-byte digest + double-SHA-256
 * checksum); testnet and mainnet share the syntax, the value is synthetic.
 * @param {string} subject
 * @param {string} salt
 */
function tronAddress(subject, salt) {
  const payload = Buffer.concat([Buffer.from([0x41]), digest(subject, salt).subarray(0, 20)]);
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
  const bytes = Buffer.concat([payload, checksum.subarray(0, 4)]);
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  // A 25-byte payload that starts with 0x41 always encodes with a leading "T".
  return encoded;
}

/**
 * @param {string} subject
 * @param {number} index
 * @returns {DepositAddressView}
 */
function buildDepositAddress(subject, index) {
  const target = DEPOSIT_ADDRESS_TARGETS[index];
  const address =
    target.network === "TON_TESTNET"
      ? tonTestnetAddress(subject, `address:${index}`)
      : tronAddress(subject, `address:${index}`);
  const createdMs = BASE_MS + index * STEP_MS;
  return Object.freeze({
    deposit_address_id: `dpa_${digest(subject, `id:${index}`).toString("hex").slice(0, 24)}`,
    asset: target.asset,
    network: target.network,
    address,
    status: "active",
    created_at: new Date(createdMs).toISOString(),
    posting: "none"
  });
}

/**
 * @param {string} subject
 * @returns {DepositAddressesView}
 */
function buildDepositAddressesView(subject) {
  const deposit_addresses = Object.freeze(
    DEPOSIT_ADDRESS_TARGETS.map((_target, index) => buildDepositAddress(subject, index))
  );
  return Object.freeze({ mode: "test", deposit_addresses });
}

/** @param {unknown} value */
function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

/** @param {unknown} view */
export function validDepositAddressesView(view) {
  if (view === null || typeof view !== "object" || Array.isArray(view)) {
    return false;
  }
  const candidate = /** @type {DepositAddressesView} */ (view);
  if (JSON.stringify(Object.keys(view).sort()) !== JSON.stringify([...VIEW_KEYS].sort())) {
    return false;
  }
  if (
    candidate.mode !== "test" ||
    !Array.isArray(candidate.deposit_addresses) ||
    // The set is exactly the allowlisted receiving targets: one entry per
    // (asset, network) pair — a duplicate or a missing pair fails closed.
    candidate.deposit_addresses.length !== DEPOSIT_ADDRESS_TARGETS.length
  ) {
    return false;
  }
  const seen = new Set();
  for (const entry of candidate.deposit_addresses) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...DEPOSIT_ADDRESS_KEYS].sort()) ||
      !Object.values(entry).every((value) => typeof value === "string") ||
      !DEPOSIT_ADDRESS_ID_PATTERN.test(entry.deposit_address_id) ||
      !ASSET_PATTERN.test(entry.asset) ||
      !TESTNET_PATTERN.test(entry.network) ||
      !DEPOSIT_ADDRESS_TARGETS.some(
        (target) => target.asset === entry.asset && target.network === entry.network
      ) ||
      seen.has(`${entry.asset}/${entry.network}`) ||
      !(
        (entry.network === "TON_TESTNET" && TON_TESTNET_ADDRESS_PATTERN.test(entry.address)) ||
        (entry.network === "TRON_TESTNET" && TRON_ADDRESS_PATTERN.test(entry.address))
      ) ||
      !DEPOSIT_ADDRESS_STATUSES.includes(entry.status) ||
      !isIsoTimestamp(entry.created_at) ||
      entry.posting !== "none"
    ) {
      return false;
    }
    seen.add(`${entry.asset}/${entry.network}`);
  }
  return true;
}

/** @returns {DepositAddressDirectory} */
export function createSyntheticDepositAddressDirectory() {
  // No per-subject memo: views are pure functions of the subject, and a
  // retained cache would grow without bound across distinct subjects.
  return Object.freeze({
    async listFor(subject) {
      return buildDepositAddressesView(subject);
    }
  });
}
