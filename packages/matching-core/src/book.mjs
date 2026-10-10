import { formatScaledDecimal } from "./decimal.mjs";

/**
 * In-memory limit order book for one instrument: price levels sorted by
 * price/time priority, FIFO within a level. The book only stores and orders
 * resting orders; matching decisions and event emission live in engine.mjs.
 *
 * @typedef {object} RestingOrder
 * @property {string} order_id
 * @property {"buy" | "sell"} side
 * @property {string | undefined} owner
 * @property {string} price Canonical exact-scale price string.
 * @property {bigint} price_units
 * @property {string} quantity Canonical exact-scale original quantity.
 * @property {bigint} quantity_units Original quantity.
 * @property {bigint} remaining_units
 *
 * @typedef {object} BookLevel
 * @property {bigint} price_units
 * @property {RestingOrder[]} queue FIFO orders at this price.
 *
 * @typedef {object} DepthLevel
 * @property {string} price Exact-scale canonical price.
 * @property {string} quantity Exact-scale aggregated remaining quantity.
 * @property {number} order_count Resting orders aggregated at the level.
 */

/**
 * Binary-search insertion index for `priceUnits` inside an ascending
 * array of level price units.
 *
 * @param {bigint[]} sorted
 * @param {bigint} priceUnits
 * @returns {number}
 */
function insertionIndex(sorted, priceUnits) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < priceUnits) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * @param {string} instrument
 * @param {number} baseScale
 * @param {number} priceScale
 */
export function createOrderBook(instrument, baseScale, priceScale) {
  /** @type {{ buy: Map<string, BookLevel>, sell: Map<string, BookLevel> }} */
  const levels = { buy: new Map(), sell: new Map() };
  /** @type {{ buy: bigint[], sell: bigint[] }} */
  const sortedUnits = { buy: [], sell: [] };
  /** @type {Map<string, RestingOrder>} */
  const resting = new Map();

  /**
   * @param {"buy" | "sell"} side
   * @returns {BookLevel | undefined}
   */
  function bestLevel(side) {
    const units = sortedUnits[side];
    if (units.length === 0) {
      return undefined;
    }
    const best = side === "buy" ? units[units.length - 1] : units[0];
    return levels[side].get(formatScaledDecimal(best, priceScale));
  }

  /**
   * @param {"buy" | "sell"} side
   * @param {BookLevel} level
   */
  function dropLevel(side, level) {
    const units = sortedUnits[side];
    const at = units.indexOf(level.price_units);
    if (at !== -1) {
      units.splice(at, 1);
    }
    levels[side].delete(formatScaledDecimal(level.price_units, priceScale));
  }

  return Object.freeze({
    instrument,
    /**
     * @param {RestingOrder} order
     */
    addResting(order) {
      const key = formatScaledDecimal(order.price_units, priceScale);
      const sideLevels = levels[order.side];
      let level = sideLevels.get(key);
      if (level === undefined) {
        level = { price_units: order.price_units, queue: [] };
        sideLevels.set(key, level);
        const units = sortedUnits[order.side];
        units.splice(insertionIndex(units, order.price_units), 0, order.price_units);
      }
      level.queue.push(order);
      resting.set(order.order_id, order);
    },
    /**
     * Head order of the best price level on `side` (price/time priority).
     *
     * @param {"buy" | "sell"} side
     * @returns {RestingOrder | undefined}
     */
    bestHead(side) {
      const level = bestLevel(side);
      return level === undefined ? undefined : level.queue[0];
    },
    /**
     * Removes the head order of the best price level on `side` and drops the
     * level when it empties.
     *
     * @param {"buy" | "sell"} side
     */
    shiftBest(side) {
      const level = bestLevel(side);
      if (level === undefined) {
        return;
      }
      const head = level.queue.shift();
      if (head !== undefined) {
        resting.delete(head.order_id);
      }
      if (level.queue.length === 0) {
        dropLevel(side, level);
      }
    },
    /**
     * @param {string} orderId
     * @returns {RestingOrder | undefined}
     */
    restingOrder(orderId) {
      return resting.get(orderId);
    },
    /**
     * Removes a resting order anywhere in the book (cancel path, O(depth)).
     *
     * @param {RestingOrder} order
     * @returns {boolean}
     */
    remove(order) {
      if (resting.delete(order.order_id) !== true) {
        return false;
      }
      const level = levels[order.side].get(formatScaledDecimal(order.price_units, priceScale));
      if (level === undefined) {
        return false;
      }
      const at = level.queue.indexOf(order);
      if (at !== -1) {
        level.queue.splice(at, 1);
      }
      if (level.queue.length === 0) {
        dropLevel(order.side, level);
      }
      return true;
    },
    /**
     * Aggregated market depth, best price first on each side.
     *
     * @returns {{ instrument: string, bids: readonly DepthLevel[], asks: readonly DepthLevel[] }}
     */
    snapshot() {
      const depth = (/** @type {"buy" | "sell"} */ side, /** @type {boolean} */ descending) => {
        const units = sortedUnits[side];
        const ordered = descending ? [...units].reverse() : units;
        return Object.freeze(
          ordered.map((priceUnits) => {
            const level = /** @type {BookLevel} */ (
              levels[side].get(formatScaledDecimal(priceUnits, priceScale))
            );
            const quantity = level.queue.reduce((sum, order) => sum + order.remaining_units, 0n);
            return Object.freeze({
              price: formatScaledDecimal(priceUnits, priceScale),
              quantity: formatScaledDecimal(quantity, baseScale),
              order_count: level.queue.length,
            });
          }),
        );
      };
      return Object.freeze({
        instrument,
        bids: depth("buy", true),
        asks: depth("sell", false),
      });
    },
  });
}
