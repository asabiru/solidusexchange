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

/**
 * A busy deterministic scenario exercising crossed books, partial fills on
 * both maker and taker sides, cancels, validation rejects, a self-trade
 * reject and a second instrument. Returns every emitted event in order —
 * the same stream `engine.journal()` should hold afterwards.
 *
 * @param {{ submitOrder: (input: unknown) => readonly unknown[], cancelOrder: (instrument: unknown, orderId: unknown) => readonly unknown[] }} engine
 */
export function mixedScenario(engine) {
  return [
    engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2", owner: "desk-a" })),
    engine.submitOrder(order(2, { side: "sell", price: "90", quantity: "3", owner: "desk-b" })),
    engine.submitOrder(order(3, { side: "sell", price: "91", quantity: "5", owner: "desk-c" })),
    engine.submitOrder(order(4, { side: "buy", price: "91", quantity: "4", owner: "desk-d" })),
    engine.submitOrder(order(5, { side: "buy", price: "88", quantity: "1" })),
    engine.submitOrder(order(6, { side: "buy", price: "89", quantity: "2" })),
    engine.cancelOrder("USDT/RUB", ord(6)),
    engine.submitOrder(order(7, { side: "sell", price: "88", quantity: "3", owner: "desk-a" })),
    engine.submitOrder(order(8, { side: "buy", price: "91", quantity: "3", owner: "desk-e" })),
    engine.submitOrder(order(9, { side: "sell", price: "92", quantity: "4", owner: "desk-a" })),
    engine.submitOrder(order(10, { side: "buy", price: "95", quantity: "10", owner: "desk-a" })),
    engine.cancelOrder("USDT/RUB", ord(5)),
    engine.submitOrder(order(11, { price: "junk" })),
    engine.submitOrder(order(20, { instrument: "TON/RUB", side: "sell", price: "150", quantity: "1" })),
    engine.submitOrder(order(21, { instrument: "TON/RUB", side: "buy", price: "150", quantity: "1" })),
    engine.cancelOrder("USDT/RUB", ord(99)),
  ].flat();
}
