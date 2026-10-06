import type { KycScenario, QuoteScenario } from "@solidchange/provider-simulators";
import type { QuoteSource } from "./provider-quotes.js";

export interface ServerConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  allowDevLogin: boolean;
  telegramBotToken?: string;
  sessionTtlSeconds: number;
  initDataMaxAgeSeconds: number;
  quoteTtlSeconds: number;
  quoteSource: QuoteSource;
  quoteSeed: string;
  quoteScenario: QuoteScenario;
  kycScenario: KycScenario;
  kycSeed: string;
  kycReviewTimeoutSeconds: number;
  customerApiUrl?: string;
  customerApiDevTokenKey?: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

const quoteSources: readonly QuoteSource[] = ["local", "provider-simulator"];
const quoteScenarios: readonly QuoteScenario[] = ["fresh_quote", "expired_quote", "stale_price", "provider_outage"];
const kycScenarios: readonly KycScenario[] = [
  "approve",
  "reject",
  "needs_more_data",
  "pending_timeout",
  "provider_outage",
  "duplicate_callback",
  "out_of_order_callback",
  "late_callback"
];
const seedPattern = /^[A-Za-z0-9._:-]{1,64}$/;
const devTokenKeyPattern = /^[0-9a-f]{64}$/;
const botTokenPattern = /^[0-9]{1,20}:[A-Za-z0-9_-]{30,64}$/;
const defaultOrigins = "http://127.0.0.1:4183,http://localhost:4183";

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}

function integerSetting(
  env: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseOrigins(value: string): readonly string[] {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error("MINIAPP_ALLOWED_ORIGINS must not be empty");
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("MINIAPP_ALLOWED_ORIGINS must contain absolute origins");
    }
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("MINIAPP_ALLOWED_ORIGINS entries must be exact HTTP(S) origins");
    }
    if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
      throw new Error("MINIAPP_ALLOWED_ORIGINS must use HTTPS outside loopback development");
    }
  }
  return Object.freeze(origins);
}

function oneOf<T extends string>(env: Environment, name: string, allowed: readonly T[], fallback: T): T {
  const value = env[name]?.trim() || fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseCustomerApi(env: Environment): { customerApiUrl?: string; customerApiDevTokenKey?: string } {
  const url = env.MINIAPP_CUSTOMER_API_URL?.trim() || undefined;
  const key = env.MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY?.trim() || undefined;
  if (url === undefined && key === undefined) return {};
  if (url === undefined || key === undefined) {
    throw new Error("MINIAPP_CUSTOMER_API_URL and MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY must be set together");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("MINIAPP_CUSTOMER_API_URL must be an absolute origin");
  }
  if (parsed.protocol !== "http:" || parsed.origin !== url || !isLoopbackHostname(parsed.hostname)) {
    throw new Error("MINIAPP_CUSTOMER_API_URL must be an exact loopback http origin; the dev customer API is never remote");
  }
  if (!devTokenKeyPattern.test(key)) {
    throw new Error("MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY must be 64 lowercase hex characters");
  }
  return { customerApiUrl: url, customerApiDevTokenKey: key };
}

function seedSetting(env: Environment, name: string, fallback: string): string {
  const value = env[name]?.trim() || fallback;
  if (!seedPattern.test(value)) throw new Error(`${name} must match ^[A-Za-z0-9._:-]{1,64}$`);
  return value;
}

export function loadServerConfig(env: Environment = process.env): ServerConfig {
  const host = env.MINIAPP_BFF_HOST?.trim() || "127.0.0.1";
  if (!isLoopbackHostname(host)) {
    throw new Error("MINIAPP_BFF_HOST must be a loopback address; the dev BFF is never exposed");
  }
  const telegramBotToken = env.MINIAPP_TELEGRAM_BOT_TOKEN?.trim() || undefined;
  if (telegramBotToken !== undefined && !botTokenPattern.test(telegramBotToken)) {
    throw new Error("MINIAPP_TELEGRAM_BOT_TOKEN has an unexpected format");
  }
  return {
    host,
    port: integerSetting(env, "MINIAPP_BFF_PORT", 4184, 1, 65_535),
    allowedOrigins: parseOrigins(env.MINIAPP_ALLOWED_ORIGINS ?? defaultOrigins),
    allowDevLogin: env.MINIAPP_ALLOW_DEV_LOGIN === "true",
    telegramBotToken,
    sessionTtlSeconds: integerSetting(env, "MINIAPP_SESSION_TTL_SECONDS", 1_800, 60, 3_600),
    initDataMaxAgeSeconds: integerSetting(env, "MINIAPP_INIT_DATA_MAX_AGE_SECONDS", 300, 30, 86_400),
    quoteTtlSeconds: integerSetting(env, "MINIAPP_QUOTE_TTL_SECONDS", 30, 10, 120),
    quoteSource: oneOf(env, "MINIAPP_QUOTE_SOURCE", quoteSources, "local"),
    quoteSeed: seedSetting(env, "MINIAPP_QUOTE_SEED", "miniapp-dev"),
    quoteScenario: oneOf(env, "MINIAPP_QUOTE_SCENARIO", quoteScenarios, "fresh_quote"),
    kycScenario: oneOf(env, "MINIAPP_KYC_SCENARIO", kycScenarios, "approve"),
    kycSeed: seedSetting(env, "MINIAPP_KYC_SEED", "miniapp-dev-kyc"),
    kycReviewTimeoutSeconds: integerSetting(env, "MINIAPP_KYC_REVIEW_TIMEOUT_SECONDS", 3_600, 600, 3_600),
    ...parseCustomerApi(env)
  };
}
