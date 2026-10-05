import {
  PRICE_SCALE,
  assetScale,
  divideRounded,
  formatAmount,
  formatDecimal,
  parseAmount,
  parseDecimal,
  parsePositiveAmount,
} from "./decimal.mjs";
import {
  assertEpochSeconds,
  createSeededRandom,
  createSimulatedClock,
  toIsoSeconds,
} from "./deterministic.mjs";
import { ProviderError, invalidRequest } from "./errors.mjs";
import {
  createCallbackSigner,
  createCallbackVerifier,
  SIMULATOR_ENVIRONMENT,
} from "./signing.mjs";
import {
  exactKeys,
  IdempotencyRegistry,
  idempotencyKey,
  isIsoSeconds,
  isStringMatching,
  oneOf,
  outageError,
  SIM_ID,
  snapshotRequest,
} from "./simulator-core.mjs";

/** @import { JsonValue } from "./canonical-json.mjs" */

/**
 * Provider-neutral liquidity quote adapter (D-007: external, treasury or
 * hybrid liquidity is undecided). A quote is an indicative price only: this
 * interface has no accept, execute, order, hedge or settle operation, and a
 * quote never grants execution authority.
 *
 * @typedef {object} LiquidityQuoteAdapter
 * @property {string} providerId
 * @property {(request: QuoteRequest) => Promise<Quote>} requestQuote
 * @property {(quoteId: string) => Promise<Quote>} getQuote
 */

/**
 * @typedef {object} QuoteRequest
 * @property {QuotePair} pair
 * @property {"buy" | "sell"} side Customer buys or sells the base asset.
 * @property {string} base_amount Decimal string in the base asset scale.
 * @property {string} idempotency_key
 */

/** @typedef {"USDT/RUB" | "TON/RUB" | "TON/USDT"} QuotePair */

/**
 * @typedef {object} Quote
 * @property {string} schema
 * @property {"dev-simulator"} environment
 * @property {"quote"} domain
 * @property {string} quote_id
 * @property {QuotePair} pair
 * @property {string} base_asset
 * @property {string} quote_asset
 * @property {"buy" | "sell"} side
 * @property {string} base_amount
 * @property {string} mid_price
 * @property {string} price Side-adjusted price including the spread.
 * @property {number} spread_bps
 * @property {number} fee_bps
 * @property {string} quote_amount base_amount × price in the quote asset.
 * @property {string} fee_amount
 * @property {string} total_quote_amount buy: amount payable; sell: amount receivable.
 * @property {"quote_asset"} fee_asset
 * @property {"down" | "up"} rounding Customer-unfavourable direction is never hidden: see README.
 * @property {string} price_observed_at
 * @property {string} issued_at
 * @property {string} expires_at
 * @property {number} ttl_seconds
 * @property {"indicative"} status
 * @property {"not_supported"} execution
 */

export const QUOTE_SCENARIOS = Object.freeze({
  fresh_quote: { outage: false, issuedOffset: 0, priceAge: 2 },
  expired_quote: { outage: false, issuedOffset: -120, priceAge: 2 },
  stale_price: { outage: false, issuedOffset: 0, priceAge: 900 },
  provider_outage: { outage: true, issuedOffset: 0, priceAge: 0 },
});

/** @typedef {keyof typeof QUOTE_SCENARIOS} QuoteScenario */

const SCENARIO_NAMES = /** @type {QuoteScenario[]} */ (Object.keys(QUOTE_SCENARIOS));

/** Synthetic reference mid prices; not market data. */
export const SYNTHETIC_MID_PRICES = Object.freeze({
  "USDT/RUB": "90.00000000",
  "TON/RUB": "300.00000000",
  "TON/USDT": "3.20000000",
});
const PAIRS = /** @type {QuotePair[]} */ (Object.keys(SYNTHETIC_MID_PRICES));
const SIDES = /** @type {const} */ (["buy", "sell"]);

export const QUOTE_SCHEMA = "solidchange.sim.quote.v1";
const QUOTE_KEYS = [
  "base_amount",
  "base_asset",
  "domain",
  "environment",
  "execution",
  "expires_at",
  "fee_amount",
  "fee_asset",
  "fee_bps",
  "issued_at",
  "mid_price",
  "pair",
  "price",
  "price_observed_at",
  "quote_amount",
  "quote_asset",
  "quote_id",
  "rounding",
  "schema",
  "side",
  "spread_bps",
  "status",
  "total_quote_amount",
  "ttl_seconds",
];

/**
 * Recomputes every derived amount from the quote inputs.
 *
 * @param {{ pair: QuotePair, side: "buy" | "sell", baseAmount: bigint, mid: bigint, spreadBps: number, feeBps: number }} input
 */
export function computeQuoteAmounts({ pair, side, baseAmount, mid, spreadBps, feeBps }) {
  const [base, quote] = /** @type {[string, string]} */ (pair.split("/"));
  const baseScale = assetScale(base);
  const quoteScale = assetScale(quote);
  const buy = side === "buy";
  const price = buy
    ? divideRounded(mid * BigInt(20_000 + spreadBps), 20_000n, "up")
    : divideRounded(mid * BigInt(20_000 - spreadBps), 20_000n, "down");
  const quoteUnits = divideRounded(
    baseAmount * price * 10n ** BigInt(quoteScale),
    10n ** BigInt(baseScale + PRICE_SCALE),
    buy ? "up" : "down",
  );
  const fee = divideRounded(quoteUnits * BigInt(feeBps), 10_000n, "up");
  const total = buy ? quoteUnits + fee : quoteUnits - fee;
  return { base, quote, price, quoteUnits, fee, total };
}

/**
 * @param {Record<string, JsonValue>} payload
 * @returns {string | null}
 */
export function validateSignedQuote(payload) {
  const keys = exactKeys(payload, QUOTE_KEYS);
  if (keys) {
    return keys;
  }
  if (
    payload.schema !== QUOTE_SCHEMA ||
    payload.status !== "indicative" ||
    payload.execution !== "not_supported" ||
    payload.fee_asset !== "quote_asset"
  ) {
    return "quote must be an indicative, non-executable simulator quote";
  }
  if (!isStringMatching(payload.quote_id, SIM_ID)) {
    return "invalid quote_id";
  }
  const pair = /** @type {QuotePair} */ (payload.pair);
  const side = /** @type {"buy" | "sell"} */ (payload.side);
  if (!PAIRS.includes(pair) || !SIDES.includes(side)) {
    return "invalid pair or side";
  }
  const [base, quote] = pair.split("/");
  if (payload.base_asset !== base || payload.quote_asset !== quote) {
    return "assets do not match pair";
  }
  if (payload.rounding !== (side === "buy" ? "up" : "down")) {
    return "rounding does not match side";
  }
  for (const field of ["price_observed_at", "issued_at", "expires_at"]) {
    if (!isIsoSeconds(payload[field])) {
      return `invalid ${field}`;
    }
  }
  const issued = Date.parse(String(payload.issued_at)) / 1000;
  const expires = Date.parse(String(payload.expires_at)) / 1000;
  const observed = Date.parse(String(payload.price_observed_at)) / 1000;
  const ttl = payload.ttl_seconds;
  if (typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 300 || expires - issued !== ttl) {
    return "invalid ttl";
  }
  if (observed > issued) {
    return "price observed after issue";
  }
  const spread = payload.spread_bps;
  const fee = payload.fee_bps;
  if (!isBps(spread) || !isBps(fee)) {
    return "invalid spread or fee";
  }
  try {
    const amounts = computeQuoteAmounts({
      pair,
      side,
      baseAmount: parsePositiveAmount(base, payload.base_amount),
      mid: parseDecimal(payload.mid_price, PRICE_SCALE),
      spreadBps: /** @type {number} */ (spread),
      feeBps: /** @type {number} */ (fee),
    });
    if (
      payload.price !== formatDecimal(amounts.price, PRICE_SCALE) ||
      payload.quote_amount !== formatAmount(quote, amounts.quoteUnits) ||
      payload.fee_amount !== formatAmount(quote, amounts.fee) ||
      payload.total_quote_amount !== formatAmount(quote, amounts.total) ||
      parseAmount(quote, payload.total_quote_amount) === 0n
    ) {
      return "derived amounts do not match";
    }
  } catch {
    return "invalid amounts";
  }
  return null;
}

/** @param {JsonValue} value */
function isBps(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000;
}

/**
 * @param {Omit<import("./signing.mjs").CallbackVerifierOptions, "domain" | "validatePayload">} options
 */
export function createQuoteVerifier(options) {
  return createCallbackVerifier({ ...options, domain: "quote", validatePayload: validateSignedQuote });
}

/**
 * Display freshness only. A "displayable" quote is still not executable:
 * execution needs limits, AML/KYT, hold, approval, ledger and reconciliation,
 * none of which exist here.
 *
 * @param {Quote | Record<string, JsonValue>} quote
 * @param {{ now: number, maxPriceAgeSeconds?: number }} options
 * @returns {{ displayable: boolean, reason: null | "invalid_quote" | "not_yet_valid" | "expired" | "stale_price", executable: false }}
 */
export function assessQuote(quote, { now, maxPriceAgeSeconds = 60 }) {
  assertEpochSeconds(now, "now");
  const problem = validateSignedQuote(/** @type {Record<string, JsonValue>} */ (quote));
  if (problem !== null) {
    return { displayable: false, reason: "invalid_quote", executable: false };
  }
  const issued = Date.parse(String(quote.issued_at)) / 1000;
  const expires = Date.parse(String(quote.expires_at)) / 1000;
  const observed = Date.parse(String(quote.price_observed_at)) / 1000;
  if (now < issued) {
    return { displayable: false, reason: "not_yet_valid", executable: false };
  }
  if (now >= expires) {
    return { displayable: false, reason: "expired", executable: false };
  }
  if (issued - observed > maxPriceAgeSeconds) {
    return { displayable: false, reason: "stale_price", executable: false };
  }
  return { displayable: true, reason: null, executable: false };
}

/**
 * @typedef {object} QuoteSimulatorOptions
 * @property {string} seed
 * @property {import("./signing.mjs").SimulatorKey} key
 * @property {import("./deterministic.mjs").SimulatedClock} [clock]
 * @property {Partial<Record<QuotePair, QuoteScenario>>} [scenarios] pair → scenario.
 * @property {QuoteScenario} [defaultScenario]
 * @property {number} [ttlSeconds]
 * @property {number} [spreadBps]
 * @property {number} [feeBps]
 */

/**
 * Deterministic quote simulator. Synthetic mid prices are jittered by the
 * seed; outputs are indicative and signed, never executable.
 *
 * @param {QuoteSimulatorOptions} options
 */
export function createQuoteSimulator(options) {
  const random = createSeededRandom(options.seed);
  const clock = options.clock ?? createSimulatedClock();
  const ttlSeconds = options.ttlSeconds ?? 30;
  const spreadBps = options.spreadBps ?? 50;
  const feeBps = options.feeBps ?? 30;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 300) {
    throw new RangeError("ttlSeconds must be an integer between 5 and 300");
  }
  if (!isBps(spreadBps) || !isBps(feeBps)) {
    throw new RangeError("spreadBps and feeBps must be integers between 0 and 1000");
  }
  /** @type {Record<string, QuoteScenario>} */
  const scenarios = Object.create(null);
  for (const [pair, scenario] of Object.entries(options.scenarios ?? {})) {
    if (!PAIRS.includes(/** @type {QuotePair} */ (pair)) || !SCENARIO_NAMES.includes(scenario)) {
      throw new TypeError(`invalid quote scenario mapping for ${pair}`);
    }
    scenarios[pair] = scenario;
  }
  const fallback = options.defaultScenario ?? "fresh_quote";
  if (!SCENARIO_NAMES.includes(fallback)) {
    throw new TypeError("unknown default quote scenario");
  }
  const signer = createCallbackSigner({ key: options.key, domain: "quote", random });
  /** @type {IdempotencyRegistry<Quote>} */
  const idempotency = new IdempotencyRegistry();
  /** @type {Map<string, Quote>} */
  const quotes = new Map();

  /** @type {LiquidityQuoteAdapter & { exportSignedQuote: (quoteId: string) => import("./signing.mjs").SignedDelivery }} */
  const simulator = {
    providerId: "simulator",

    async requestQuote(request) {
      const input = snapshotRequest(request, ["pair", "side", "base_amount", "idempotency_key"]);
      const pair = oneOf(input.pair, PAIRS, "pair");
      const side = oneOf(input.side, SIDES, "side");
      const [base, quote] = /** @type {[string, string]} */ (pair.split("/"));
      let baseAmount;
      try {
        baseAmount = parsePositiveAmount(base, input.base_amount);
      } catch (error) {
        throw new ProviderError("invalid_request", `base_amount: ${/** @type {Error} */ (error).message}`);
      }
      const key = idempotencyKey(input.idempotency_key);
      const scenario = Object.hasOwn(scenarios, pair) ? scenarios[pair] : fallback;
      const plan = QUOTE_SCENARIOS[scenario];
      if (plan.outage) {
        throw outageError(5);
      }
      return idempotency.run(key, input, () => {
        const now = clock.now();
        const issuedAt = now + plan.issuedOffset;
        const reference = parseDecimal(SYNTHETIC_MID_PRICES[pair], PRICE_SCALE);
        const jitterBps = random.int("quote-mid-jitter", -25, 25);
        const mid = divideRounded(reference * BigInt(10_000 + jitterBps), 10_000n, "half_even");
        const amounts = computeQuoteAmounts({ pair, side, baseAmount, mid, spreadBps, feeBps });
        if (amounts.quoteUnits === 0n || amounts.total === 0n) {
          invalidRequest("base_amount is too small to quote");
        }
        /** @type {Quote} */
        const result = {
          schema: QUOTE_SCHEMA,
          environment: SIMULATOR_ENVIRONMENT,
          domain: "quote",
          quote_id: random.id("quote", "quote-id"),
          pair,
          base_asset: base,
          quote_asset: quote,
          side,
          base_amount: formatAmount(base, baseAmount),
          mid_price: formatDecimal(mid, PRICE_SCALE),
          price: formatDecimal(amounts.price, PRICE_SCALE),
          spread_bps: spreadBps,
          fee_bps: feeBps,
          quote_amount: formatAmount(quote, amounts.quoteUnits),
          fee_amount: formatAmount(quote, amounts.fee),
          total_quote_amount: formatAmount(quote, amounts.total),
          fee_asset: "quote_asset",
          rounding: side === "buy" ? "up" : "down",
          price_observed_at: toIsoSeconds(issuedAt - plan.priceAge),
          issued_at: toIsoSeconds(issuedAt),
          expires_at: toIsoSeconds(issuedAt + ttlSeconds),
          ttl_seconds: ttlSeconds,
          status: "indicative",
          execution: "not_supported",
        };
        quotes.set(result.quote_id, result);
        return result;
      });
    },

    async getQuote(quoteId) {
      const quote = quotes.get(quoteId);
      if (!quote) {
        throw new ProviderError("not_found", "unknown quote");
      }
      return structuredClone(quote);
    },

    exportSignedQuote(quoteId) {
      const quote = quotes.get(quoteId);
      if (!quote) {
        throw new ProviderError("not_found", "unknown quote");
      }
      return signer.sign(
        /** @type {Record<string, JsonValue>} */ (/** @type {unknown} */ (quote)),
        Date.parse(quote.issued_at) / 1000,
      );
    },
  };
  return Object.freeze(simulator);
}
