/**
 * Input snapshotting, mirroring packages/financial-core/src/ledger.mjs and
 * custody-core entry points: values crossing the engine boundary are
 * structured-cloned before validation so getter or Proxy tricks cannot
 * change a field between checks and use.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function snapshotPlainData(value) {
  try {
    return structuredClone(value);
  } catch {
    throw new TypeError("input must be plain structured-cloneable data");
  }
}
