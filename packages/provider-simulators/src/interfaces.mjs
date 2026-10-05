/**
 * Provider-neutral adapter contracts. A real adapter is a separate,
 * separately approved package that exposes exactly these operations; it must
 * pass `assertProviderAdapter` and the shared callback verifier rules.
 *
 * Contracts: KycProviderAdapter (kyc.mjs), KytProviderAdapter (kyt.mjs),
 * BankPaymentAdapter (bank.mjs), LiquidityQuoteAdapter (quotes.mjs).
 */

export const ADAPTER_OPERATIONS = Object.freeze({
  kyc: Object.freeze(["submitApplicant", "getApplicantStatus"]),
  kyt: Object.freeze(["screenTransfer", "getAssessment"]),
  bank: Object.freeze(["createPaymentIntent", "getPaymentStatus"]),
  quote: Object.freeze(["requestQuote", "getQuote"]),
});

/** @typedef {keyof typeof ADAPTER_OPERATIONS} AdapterKind */

/**
 * Operation names that would imply money movement, execution or signing.
 * No adapter in this boundary may expose them.
 */
export const FORBIDDEN_OPERATION =
  /^(?:accept|approve|broadcast|capture|confirm|execute|fill|hedge|order|pay|payout|place|post|refund|release|settle|sign|submitOrder|trade|transfer|withdraw)(?![a-z])/;

/**
 * @param {AdapterKind} kind
 * @param {unknown} adapter
 */
export function assertProviderAdapter(kind, adapter) {
  if (!Object.hasOwn(ADAPTER_OPERATIONS, kind)) {
    throw new TypeError("unknown adapter kind");
  }
  if (adapter === null || typeof adapter !== "object") {
    throw new TypeError("adapter must be an object");
  }
  const record = /** @type {Record<string, unknown>} */ (adapter);
  if (typeof record.providerId !== "string" || !/^[a-z0-9-]{1,32}$/.test(record.providerId)) {
    throw new TypeError("adapter providerId must match ^[a-z0-9-]{1,32}$");
  }
  for (const operation of ADAPTER_OPERATIONS[kind]) {
    if (typeof record[operation] !== "function") {
      throw new TypeError(`${kind} adapter must implement ${operation}`);
    }
  }
  for (let target = record; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
    for (const name of Object.getOwnPropertyNames(target)) {
      if (FORBIDDEN_OPERATION.test(name)) {
        throw new TypeError(`${kind} adapter must not expose ${name}`);
      }
    }
  }
  return true;
}
