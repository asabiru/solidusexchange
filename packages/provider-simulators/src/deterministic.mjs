import { createHash, createHmac } from "node:crypto";

/** 2026-01-01T00:00:00Z: fixed simulator epoch, never the wall clock. */
export const DEFAULT_EPOCH_SECONDS = 1_767_225_600;

const SEED_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const LABEL_PATTERN = /^[a-z0-9._:-]{1,64}$/;
const MAX_EPOCH_SECONDS = 253_402_300_799;

/**
 * @typedef {object} SeededRandom
 * @property {string} seed
 * @property {(label: string, length: number) => Buffer} bytes
 * @property {(label: string, length: number) => string} hex
 * @property {(label: string, min: number, max: number) => number} int
 * @property {(prefix: string, label: string) => string} id
 */

/**
 * Deterministic HMAC-SHA256 stream. The same seed and the same sequence of
 * calls always yield the same values; nothing reads ambient entropy.
 *
 * @param {string} seed
 * @returns {SeededRandom}
 */
export function createSeededRandom(seed) {
  if (typeof seed !== "string" || !SEED_PATTERN.test(seed)) {
    throw new TypeError("seed must match ^[A-Za-z0-9._:-]{1,128}$");
  }
  const key = createHash("sha256")
    .update(`solidchange-sim-seed-v1\n${seed}`)
    .digest();
  let counter = 0;

  /**
   * @param {string} label
   * @param {number} length
   */
  function bytes(label, length) {
    if (typeof label !== "string" || !LABEL_PATTERN.test(label)) {
      throw new TypeError("random label must match ^[a-z0-9._:-]{1,64}$");
    }
    if (!Number.isSafeInteger(length) || length < 1 || length > 1024) {
      throw new RangeError("random length must be between 1 and 1024 bytes");
    }
    const draw = counter;
    counter += 1;
    const blocks = [];
    for (let block = 0; block * 32 < length; block += 1) {
      blocks.push(
        createHmac("sha256", key)
          .update(`${label}\n${draw}\n${block}`)
          .digest(),
      );
    }
    return Buffer.concat(blocks).subarray(0, length);
  }

  return Object.freeze({
    seed,
    bytes,
    /**
     * @param {string} label
     * @param {number} length
     */
    hex(label, length) {
      return bytes(label, length).toString("hex");
    },
    /**
     * Uniform integer in the inclusive range, by rejection sampling.
     *
     * @param {string} label
     * @param {number} min
     * @param {number} max
     */
    int(label, min, max) {
      if (
        !Number.isSafeInteger(min) ||
        !Number.isSafeInteger(max) ||
        max < min ||
        max - min >= 2 ** 32
      ) {
        throw new RangeError("invalid integer range");
      }
      const span = max - min + 1;
      const limit = Math.floor(2 ** 32 / span) * span;
      for (;;) {
        const value = bytes(label, 4).readUInt32BE(0);
        if (value < limit) {
          return min + (value % span);
        }
      }
    },
    /**
     * @param {string} prefix
     * @param {string} label
     */
    id(prefix, label) {
      return `${prefix}_${bytes(label, 16).toString("hex")}`;
    },
  });
}

/**
 * @typedef {object} SimulatedClock
 * @property {() => number} now Current simulated time, integer epoch seconds.
 * @property {(seconds: number) => number} advance
 */

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
 * @param {number} epochSeconds
 * @returns {string} Canonical UTC timestamp with second precision.
 */
export function toIsoSeconds(epochSeconds) {
  assertEpochSeconds(epochSeconds, "timestamp");
  return new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");
}
