export interface ServerConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  allowDevLogin: boolean;
  telegramBotToken?: string;
  sessionTtlSeconds: number;
  initDataMaxAgeSeconds: number;
  quoteTtlSeconds: number;
}

export type Environment = Readonly<Record<string, string | undefined>>;

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
    quoteTtlSeconds: integerSetting(env, "MINIAPP_QUOTE_TTL_SECONDS", 30, 10, 120)
  };
}
