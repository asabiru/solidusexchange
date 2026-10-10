/**
 * @param {number} value
 * @returns {string} Deterministic `ord_` order id.
 */
export function ord(value) {
  return `ord_${value.toString(16).padStart(24, "0")}`;
}

/**
 * @param {number} value
 * @returns {string} Deterministic `fll_` fill id.
 */
export function fll(value) {
  return `fll_${value.toString(16).padStart(24, "0")}`;
}

/**
 * @param {string | number} orderId
 * @param {Record<string, unknown>} [fields]
 */
export function order(orderId, fields = {}) {
  return {
    order_id: typeof orderId === "string" ? orderId : ord(orderId),
    instrument: "USDT/RUB",
    side: "buy",
    price: "90.00000000",
    quantity: "1.000000",
    ...fields,
  };
}
