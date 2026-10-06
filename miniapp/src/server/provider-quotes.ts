import { createHash } from "node:crypto";
import {
  type QuotePair,
  type QuoteRequest,
  type QuoteScenario,
  type SimulatorQuote,
  ProviderError,
  assessQuote,
  createNonceStore,
  createQuoteSimulator,
  createQuoteVerifier,
  createVerificationKeyring,
  generateSimulatorKey,
  verificationKeyOf
} from "@solidchange/provider-simulators";
import type { QuotePreview } from "../shared/api.js";
import { type AssetCode, assets, isAssetCode } from "../shared/assets.js";
import { DecimalError, fromUnits, toUnits } from "../shared/decimal.js";
import { QuoteError, type QuoteContext, type QuoteInput, simulateQuote } from "./quotes.js";

export type QuoteSource = "local" | "provider-simulator";

export interface QuoteProvider {
  readonly source: QuoteSource;
  preview(input: QuoteInput, context: QuoteContext & { subject: string }): Promise<QuotePreview>;
}

export interface SimulatorQuoteProviderOptions {
  seed: string;
  ttlSeconds: number;
  clock: () => number;
  scenario?: QuoteScenario;
}

const pairs: readonly QuotePair[] = ["USDT/RUB", "TON/RUB", "TON/USDT"];
const nonceStoreEntries = 10_000;
/**
 * Every preview stores a quote and a signature nonce; rotating the simulator
 * before its replay cache fills keeps memory bounded and stops one subject
 * from exhausting quotes for everyone.
 */
const previewsPerGeneration = 5_000;

interface RoutedQuote {
  pair: QuotePair;
  side: "buy" | "sell";
}

export function routeQuote(from: AssetCode, to: AssetCode): RoutedQuote | undefined {
  for (const pair of pairs) {
    if (pair === `${from}/${to}`) return { pair, side: "sell" };
    if (pair === `${to}/${from}`) return { pair, side: "buy" };
  }
  return undefined;
}

export function createLocalQuoteProvider(): QuoteProvider {
  return Object.freeze({
    source: "local" as const,
    preview: async (input: QuoteInput, context: QuoteContext) => simulateQuote(input, context)
  });
}

function parseAmount(asset: AssetCode, value: string): bigint {
  try {
    return toUnits(value, assets[asset].scale);
  } catch (error) {
    if (error instanceof DecimalError) throw new QuoteError("invalid_amount");
    throw error;
  }
}

function idempotencyKey(subject: string, request: Omit<QuoteRequest, "idempotency_key">, bucket: number): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([subject, request.pair, request.side, request.base_amount ?? null, request.quote_amount ?? null, bucket]))
    .digest("hex");
  return `miniapp:${digest.slice(0, 40)}`;
}

function toPreview(
  quote: SimulatorQuote,
  routed: RoutedQuote,
  from: AssetCode,
  to: AssetCode,
  context: QuoteContext
): QuotePreview {
  const buy = routed.side === "buy";
  const amountIn = buy ? quote.total_quote_amount : quote.base_amount;
  const insufficientBalance = context.available === undefined
    ? false
    : parseAmount(from, amountIn) > parseAmount(from, context.available);
  return Object.freeze({
    id: quote.quote_id,
    from,
    to,
    amountIn,
    fee: quote.fee_amount,
    feeAsset: buy ? from : to,
    feeBps: quote.fee_bps,
    spreadBps: quote.spread_bps,
    netIn: buy ? quote.quote_amount : quote.base_amount,
    amountOut: buy ? quote.base_amount : quote.total_quote_amount,
    total: amountIn,
    rate: Object.freeze({
      base: (buy ? to : from),
      quote: (buy ? from : to),
      value: quote.price
    }),
    issuedAt: Date.parse(quote.issued_at),
    expiresAt: Date.parse(quote.expires_at),
    ttlSeconds: quote.ttl_seconds,
    serverTime: context.nowMs,
    insufficientBalance,
    kycRequired: context.kycRequired,
    executable: false,
    executionUnavailableReason: "dev_test_version"
  });
}

/**
 * Read-only quote preview backed by the provider-neutral liquidity quote
 * simulator. Every quote crosses the simulator's signed-delivery boundary and
 * is re-verified before it is shown; quotes stay indicative and are never
 * accepted, executed or settled.
 */
export function createSimulatorQuoteProvider(options: SimulatorQuoteProviderOptions): QuoteProvider {
  const nowSeconds = () => Math.floor(options.clock() / 1_000);

  function createGeneration(index: number) {
    const key = generateSimulatorKey({ keyId: "miniapp-bff-quote", algorithm: "ed25519" });
    const simulator = createQuoteSimulator({
      seed: index === 0 ? options.seed : `${options.seed}:g${index}`,
      key,
      ttlSeconds: options.ttlSeconds,
      defaultScenario: options.scenario ?? "fresh_quote",
      clock: Object.freeze({
        now: nowSeconds,
        advance(): number {
          throw new Error("the BFF quote clock follows the server clock");
        }
      })
    });
    const verify = createQuoteVerifier({
      keyring: createVerificationKeyring([verificationKeyOf(key)]),
      nonceStore: createNonceStore({ maxEntries: nonceStoreEntries })
    });
    return { index, simulator, verify, previews: 0 };
  }

  let generation = createGeneration(0);

  function currentGeneration() {
    if (generation.previews >= previewsPerGeneration) generation = createGeneration(generation.index + 1);
    generation.previews += 1;
    return generation;
  }

  async function preview(input: QuoteInput, context: QuoteContext & { subject: string }): Promise<QuotePreview> {
    if (!isAssetCode(input.from) || !isAssetCode(input.to)) throw new QuoteError("invalid_pair");
    const from = input.from;
    const to = input.to;
    const routed = routeQuote(from, to);
    if (!routed) throw new QuoteError("invalid_pair");
    const units = parseAmount(from, input.amount);
    if (units <= 0n) throw new QuoteError("invalid_amount");
    const amount = fromUnits(units, assets[from].scale);
    const request: Omit<QuoteRequest, "idempotency_key"> = routed.side === "buy"
      ? { pair: routed.pair, side: "buy", quote_amount: amount }
      : { pair: routed.pair, side: "sell", base_amount: amount };
    const now = nowSeconds();
    const { simulator, verify } = currentGeneration();

    let quoteId: string;
    try {
      const requested = await simulator.requestQuote({
        ...request,
        idempotency_key: idempotencyKey(context.subject, request, Math.floor(now / options.ttlSeconds))
      });
      quoteId = requested.quote_id;
    } catch (error) {
      if (error instanceof ProviderError) {
        if (error.code === "provider_unavailable") throw new QuoteError("quote_unavailable", "provider_outage");
        if (error.code === "invalid_request") throw new QuoteError("amount_too_small");
        throw new QuoteError("quote_unavailable", "invalid_quote");
      }
      throw error;
    }

    const delivery = simulator.exportSignedQuote(quoteId);
    const verified = verify({ headers: delivery.headers, body: delivery.body, now });
    if (!verified.ok) throw new QuoteError("quote_unavailable", "invalid_quote");
    const quote = verified.payload as unknown as SimulatorQuote;
    if (
      quote.quote_id !== quoteId
      || quote.pair !== routed.pair
      || quote.side !== routed.side
      || quote.status !== "indicative"
      || quote.execution !== "not_supported"
    ) {
      throw new QuoteError("quote_unavailable", "invalid_quote");
    }
    const assessment = assessQuote(verified.payload, { now });
    if (assessment.reason === "stale_price") throw new QuoteError("quote_unavailable", "stale_price");
    if (!assessment.displayable && assessment.reason !== "expired") {
      throw new QuoteError("quote_unavailable", "invalid_quote");
    }
    return toPreview(quote, routed, from, to, context);
  }

  return Object.freeze({ source: "provider-simulator" as const, preview });
}
