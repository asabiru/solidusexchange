import { createHmac, timingSafeEqual } from "node:crypto";

export const maxInitDataLength = 4_096;
export const futureSkewSeconds = 60;

const hashPattern = /^[0-9a-f]{64}$/;
const keyPattern = /^[A-Za-z0-9_]{1,64}$/;
const authDatePattern = /^[1-9][0-9]{0,11}$/;

export type InitDataRejection =
  | "malformed"
  | "too_large"
  | "missing_hash"
  | "duplicate_hash"
  | "duplicate_key"
  | "invalid_hash"
  | "missing_auth_date"
  | "stale_auth_date"
  | "future_auth_date"
  | "invalid_user";

export interface TelegramUser {
  id: number;
  languageCode?: string;
}

export interface VerifiedInitData {
  authDate: number;
  user: TelegramUser;
  fields: ReadonlyMap<string, string>;
}

export type InitDataResult =
  | { ok: true; value: VerifiedInitData }
  | { ok: false; reason: InitDataRejection };

export interface VerifyOptions {
  nowMs: number;
  maxAgeSeconds: number;
}

function decodeComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return undefined;
  }
}

function reject(reason: InitDataRejection): InitDataResult {
  return { ok: false, reason };
}

export function webAppSecretKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

export function dataCheckString(fields: ReadonlyMap<string, string>): string {
  return [...fields.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function initDataDigest(fields: ReadonlyMap<string, string>, botToken: string): Buffer {
  return createHmac("sha256", webAppSecretKey(botToken))
    .update(dataCheckString(fields))
    .digest();
}

export function signInitData(fields: ReadonlyMap<string, string>, botToken: string): string {
  if (!botToken) throw new Error("A bot token is required to sign initData");
  const encoded = [...fields.entries()]
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  encoded.push(`hash=${initDataDigest(fields, botToken).toString("hex")}`);
  return encoded.join("&");
}

function parseUser(value: string | undefined): TelegramUser | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id <= 0) {
    return undefined;
  }
  return {
    id: record.id,
    languageCode: typeof record.language_code === "string" ? record.language_code : undefined
  };
}

export function verifyInitData(
  raw: string,
  botToken: string,
  options: VerifyOptions
): InitDataResult {
  if (!botToken) throw new Error("A bot token is required to verify initData");
  if (raw.length > maxInitDataLength) return reject("too_large");
  if (raw.length === 0) return reject("malformed");

  const fields = new Map<string, string>();
  for (const segment of raw.split("&")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) return reject("malformed");
    const key = decodeComponent(segment.slice(0, separator));
    const value = decodeComponent(segment.slice(separator + 1));
    if (key === undefined || value === undefined || !keyPattern.test(key)) {
      return reject("malformed");
    }
    if (fields.has(key)) return reject(key === "hash" ? "duplicate_hash" : "duplicate_key");
    fields.set(key, value);
  }

  const hash = fields.get("hash");
  if (hash === undefined) return reject("missing_hash");
  if (!hashPattern.test(hash)) return reject("invalid_hash");
  const expected = initDataDigest(fields, botToken);
  if (!timingSafeEqual(Buffer.from(hash, "hex"), expected)) return reject("invalid_hash");

  const authDateText = fields.get("auth_date");
  if (authDateText === undefined) return reject("missing_auth_date");
  if (!authDatePattern.test(authDateText)) return reject("malformed");
  const authDate = Number(authDateText);
  const nowSeconds = Math.floor(options.nowMs / 1_000);
  if (authDate > nowSeconds + futureSkewSeconds) return reject("future_auth_date");
  if (nowSeconds - authDate > options.maxAgeSeconds) return reject("stale_auth_date");

  const user = parseUser(fields.get("user"));
  if (!user) return reject("invalid_user");
  return { ok: true, value: { authDate, user, fields } };
}
