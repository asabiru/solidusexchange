/**
 * Deterministic time source for the matching engine. The engine never reads
 * the wall clock; callers inject a clock, and the default is a fixed
 * simulated epoch, so the same input sequence replays to byte-identical
 * events. Mirrors packages/provider-simulators/src/deterministic.mjs.
 */

/** 2026-01-01T00:00:00Z: fixed simulator epoch, never the wall clock. */
export const DEFAULT_EPOCH_SECONDS = 1_767_225_600;

const MAX_EPOCH_SECONDS = 253_402_300_799;

/**
 * @typedef {object} SimulatedClock
 * @property {() => number} now Current simulated time, integer epoch seconds.
 * @property {(seconds: number) => number} advance
 */

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {asserts value is number}
 */
export function assertEpochSeconds(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_EPOCH_SECONDS
  ) {
    throw new RangeError(`${label} must be integer epoch seconds`);
  }
}

/**
 * @param {number} [startEpochSeconds]
 * @returns {SimulatedClock}
 */
export function createSimulatedClock(startEpochSeconds = DEFAULT_EPOCH_SECONDS) {
  assertEpochSeconds(startEpochSeconds, "clock start");
  let current = startEpochSeconds;
  return Object.freeze({
    now: () => current,
    /** @param {number} seconds */
    advance(seconds) {
      if (!Number.isSafeInteger(seconds) || seconds < 0) {
        throw new RangeError("clock can only advance by a non-negative integer");
      }
      assertEpochSeconds(current + seconds, "clock time");
      current += seconds;
      return current;
    },
  });
}

/**
 * @param {number} epochSeconds
 * @returns {string} Canonical UTC timestamp with second precision.
 */
export function toIsoSeconds(epochSeconds) {
  assertEpochSeconds(epochSeconds, "timestamp");
  return new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");
}
