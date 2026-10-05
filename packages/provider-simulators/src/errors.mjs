/**
 * Provider-neutral error raised by adapters and simulators.
 *
 * `retryable` describes transport semantics only; the caller still decides
 * whether a retry is allowed by its own policy.
 */
export class ProviderError extends Error {
  /**
   * @param {ProviderErrorCode} code
   * @param {string} message
   * @param {{ retryable?: boolean }} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProviderError";
    /** @type {ProviderErrorCode} */
    this.code = code;
    this.retryable = options.retryable === true;
  }
}

/**
 * @typedef {"provider_unavailable"
 *   | "idempotency_conflict"
 *   | "invalid_request"
 *   | "not_found"
 *   | "scenario_not_configured"} ProviderErrorCode
 */

/**
 * @param {string} message
 * @returns {never}
 */
export function invalidRequest(message) {
  throw new ProviderError("invalid_request", message);
}
