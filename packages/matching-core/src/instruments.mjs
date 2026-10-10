import { PRICE_SCALE } from "./decimal.mjs";

/**
 * Instrument registry. Instruments reuse the exchange `BASE/QUOTE` pair
 * naming shared by the quote simulator and the customer exchange-orders
 * contract (packages/customer-api/src/exchange-orders.mjs ORDER_PAIRS):
 * USDT/RUB, TON/RUB, TON/USDT with the same per-asset scales and the shared
 * price scale of 8.
 *
 * @typedef {object} InstrumentDefinition
 * @property {string} instrument Canonical pair name, e.g. "USDT/RUB".
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {number} base_scale Quantity scale of the base asset.
 * @property {number} quote_scale Quote-asset scale (reserved; prices use price_scale).
 * @property {number} price_scale Price scale for the pair.
 */

export const INSTRUMENTS = Object.freeze([
  Object.freeze({ instrument: "USDT/RUB", base_asset: "USDT", quote_asset: "RUB", base_scale: 6, quote_scale: 2, price_scale: PRICE_SCALE }),
  Object.freeze({ instrument: "TON/RUB", base_asset: "TON", quote_asset: "RUB", base_scale: 9, quote_scale: 2, price_scale: PRICE_SCALE }),
  Object.freeze({ instrument: "TON/USDT", base_asset: "TON", quote_asset: "USDT", base_scale: 9, quote_scale: 6, price_scale: PRICE_SCALE }),
]);

const ASSET_CODE = /^[A-Z][A-Z0-9]{0,11}$/;
const SCALE_MIN = 0;
const SCALE_MAX = 18;

/**
 * @param {unknown} definition
 * @returns {definition is InstrumentDefinition}
 */
export function validInstrumentDefinition(definition) {
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
    return false;
  }
  const candidate = /** @type {InstrumentDefinition} */ (definition);
  const keys = Object.keys(definition).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["base_asset", "base_scale", "instrument", "price_scale", "quote_asset", "quote_scale"].sort())) {
    return false;
  }
  if (
    typeof candidate.instrument !== "string" ||
    typeof candidate.base_asset !== "string" ||
    typeof candidate.quote_asset !== "string" ||
    candidate.instrument !== `${candidate.base_asset}/${candidate.quote_asset}` ||
    !ASSET_CODE.test(candidate.base_asset) ||
    !ASSET_CODE.test(candidate.quote_asset) ||
    candidate.base_asset === candidate.quote_asset
  ) {
    return false;
  }
  for (const scale of [candidate.base_scale, candidate.quote_scale, candidate.price_scale]) {
    if (!Number.isSafeInteger(scale) || scale < SCALE_MIN || scale > SCALE_MAX) {
      return false;
    }
  }
  return true;
}

/**
 * Validates a custom instrument list and returns a frozen lookup. The
 * default registry is {@link INSTRUMENTS}; custom engines may pass their own
 * as long as every entry is a well-formed pair definition and names do not
 * repeat.
 *
 * @param {readonly unknown[]} definitions
 * @returns {ReadonlyMap<string, InstrumentDefinition>}
 */
export function instrumentIndex(definitions) {
  const index = new Map();
  for (const definition of definitions) {
    if (!validInstrumentDefinition(definition)) {
      throw new TypeError("instrument definitions must be well-formed BASE/QUOTE pairs");
    }
    const { instrument } = /** @type {InstrumentDefinition} */ (definition);
    if (index.has(instrument)) {
      throw new TypeError(`duplicate instrument definition: ${instrument}`);
    }
    index.set(instrument, Object.freeze({ .../** @type {InstrumentDefinition} */ (definition) }));
  }
  return index;
}
