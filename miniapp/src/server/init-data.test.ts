import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  dataCheckString,
  maxInitDataLength,
  signInitData,
  verifyInitData,
  webAppSecretKey
} from "./init-data.js";

const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
const otherToken = "100000002:" + "AnotherSyntheticTokenForTests_0000";
const nowMs = 1_790_000_000_000;
const nowSeconds = Math.floor(nowMs / 1_000);
const options = { nowMs, maxAgeSeconds: 300 };
const user = JSON.stringify({ id: 900000001, first_name: "Test", language_code: "ru" });

function fields(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map(Object.entries({
    auth_date: String(nowSeconds - 10),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user,
    ...overrides
  }));
}

function referenceHash(values: Map<string, string>, token: string): string {
  const lines = [...values.keys()].sort().map((key) => `${key}=${values.get(key)}`);
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return createHmac("sha256", secret).update(lines.join("\n")).digest("hex");
}

function hashOf(raw: string): string {
  return new URLSearchParams(raw).get("hash") ?? "";
}

describe("Telegram initData verification", () => {
  it("accepts initData signed per the documented WebAppData algorithm", () => {
    const values = fields();
    const raw = signInitData(values, syntheticToken);
    assert.equal(hashOf(raw), referenceHash(values, syntheticToken));
    const result = verifyInitData(raw, syntheticToken, options);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.user.id, 900000001);
      assert.equal(result.value.authDate, nowSeconds - 10);
      assert.equal(result.value.fields.get("user"), user);
    }
  });

  it("derives the secret key as HMAC_SHA256(key=WebAppData, message=bot_token)", () => {
    const expected = createHmac("sha256", "WebAppData").update(syntheticToken).digest("hex");
    assert.equal(webAppSecretKey(syntheticToken).toString("hex"), expected);
    const wrongDirection = createHmac("sha256", syntheticToken).update("WebAppData").digest("hex");
    assert.notEqual(webAppSecretKey(syntheticToken).toString("hex"), wrongDirection);
  });

  it("builds the data-check-string from sorted fields excluding hash", () => {
    const values = new Map([["user", "u"], ["auth_date", "1"], ["hash", "x"], ["chat_type", "private"]]);
    assert.equal(dataCheckString(values), "auth_date=1\nchat_type=private\nuser=u");
  });

  it("accepts fields in any order and URLSearchParams encoding", () => {
    const values = fields({ start_param: "promo code+1" });
    const hash = referenceHash(values, syntheticToken);
    const params = new URLSearchParams([["hash", hash], ...[...values.entries()].reverse()]);
    assert.equal(verifyInitData(params.toString(), syntheticToken, options).ok, true);
  });

  it("rejects a tampered field", () => {
    const raw = signInitData(fields(), syntheticToken);
    const tampered = raw.replace(encodeURIComponent("900000001"), encodeURIComponent("900000002"));
    assert.notEqual(tampered, raw);
    assert.deepEqual(verifyInitData(tampered, syntheticToken, options), { ok: false, reason: "invalid_hash" });
  });

  it("rejects an added field that was not signed", () => {
    const raw = `${signInitData(fields(), syntheticToken)}&start_param=injected`;
    assert.deepEqual(verifyInitData(raw, syntheticToken, options), { ok: false, reason: "invalid_hash" });
  });

  it("rejects initData signed with a different bot token", () => {
    const raw = signInitData(fields(), otherToken);
    assert.deepEqual(verifyInitData(raw, syntheticToken, options), { ok: false, reason: "invalid_hash" });
  });

  it("rejects stale auth_date beyond the maximum age", () => {
    const raw = signInitData(fields({ auth_date: String(nowSeconds - 301) }), syntheticToken);
    assert.deepEqual(verifyInitData(raw, syntheticToken, options), { ok: false, reason: "stale_auth_date" });
    const boundary = signInitData(fields({ auth_date: String(nowSeconds - 300) }), syntheticToken);
    assert.equal(verifyInitData(boundary, syntheticToken, options).ok, true);
  });

  it("rejects auth_date from the future beyond clock skew", () => {
    const raw = signInitData(fields({ auth_date: String(nowSeconds + 3_600) }), syntheticToken);
    assert.deepEqual(verifyInitData(raw, syntheticToken, options), { ok: false, reason: "future_auth_date" });
  });

  it("rejects missing or non-numeric auth_date even when signed", () => {
    const values = fields();
    values.delete("auth_date");
    assert.deepEqual(
      verifyInitData(signInitData(values, syntheticToken), syntheticToken, options),
      { ok: false, reason: "missing_auth_date" }
    );
    const nonNumeric = signInitData(fields({ auth_date: "1e9" }), syntheticToken);
    assert.deepEqual(verifyInitData(nonNumeric, syntheticToken, options), { ok: false, reason: "malformed" });
  });

  it("rejects duplicate keys, including percent-encoded duplicates", () => {
    const raw = signInitData(fields(), syntheticToken);
    const duplicateUser = `${raw}&user=${encodeURIComponent(user)}`;
    assert.deepEqual(verifyInitData(duplicateUser, syntheticToken, options), { ok: false, reason: "duplicate_key" });
    const encodedDuplicate = `${raw}&us%65r=x`;
    assert.deepEqual(verifyInitData(encodedDuplicate, syntheticToken, options), { ok: false, reason: "duplicate_key" });
    const duplicateDate = `auth_date=1&${raw}`;
    assert.deepEqual(verifyInitData(duplicateDate, syntheticToken, options), { ok: false, reason: "duplicate_key" });
  });

  it("rejects a duplicate hash even when one copy is valid", () => {
    const raw = signInitData(fields(), syntheticToken);
    const hash = hashOf(raw);
    assert.deepEqual(verifyInitData(`${raw}&hash=${hash}`, syntheticToken, options), { ok: false, reason: "duplicate_hash" });
    assert.deepEqual(verifyInitData(`hash=${hash}&${raw}`, syntheticToken, options), { ok: false, reason: "duplicate_hash" });
  });

  it("rejects missing hash", () => {
    const raw = signInitData(fields(), syntheticToken).replace(/&hash=[0-9a-f]+$/, "");
    assert.deepEqual(verifyInitData(raw, syntheticToken, options), { ok: false, reason: "missing_hash" });
  });

  it("does not treat differently cased keys as the hash field", () => {
    const raw = signInitData(fields(), syntheticToken);
    const hash = hashOf(raw);
    const renamed = raw.replace(`hash=${hash}`, `HASH=${hash}`);
    assert.deepEqual(verifyInitData(renamed, syntheticToken, options), { ok: false, reason: "missing_hash" });
  });

  it("accepts only the canonical lowercase hex hash", () => {
    const raw = signInitData(fields(), syntheticToken);
    const hash = hashOf(raw);
    const upper = raw.replace(hash, hash.toUpperCase());
    assert.deepEqual(verifyInitData(upper, syntheticToken, options), { ok: false, reason: "invalid_hash" });
    const mixed = raw.replace(hash, hash.slice(0, 32).toUpperCase() + hash.slice(32));
    assert.deepEqual(verifyInitData(mixed, syntheticToken, options), { ok: false, reason: "invalid_hash" });
    for (const broken of ["", hash.slice(0, 63), `${hash}0`, `${hash.slice(0, 63)}g`]) {
      const candidate = raw.replace(`hash=${hash}`, `hash=${broken}`);
      assert.deepEqual(verifyInitData(candidate, syntheticToken, options), { ok: false, reason: "invalid_hash" }, broken);
    }
  });

  it("rejects malformed and oversized input", () => {
    for (const raw of ["", "&", "user", "=x", "a=%E0%A4%A", "bad-key=1", "a=1&&b=2"]) {
      assert.deepEqual(verifyInitData(raw, syntheticToken, options), { ok: false, reason: "malformed" }, raw);
    }
    const oversized = `a=${"x".repeat(maxInitDataLength)}`;
    assert.deepEqual(verifyInitData(oversized, syntheticToken, options), { ok: false, reason: "too_large" });
  });

  it("requires a signed user object with a positive integer id", () => {
    for (const value of ["not-json", "[]", "{}", JSON.stringify({ id: "1" }), JSON.stringify({ id: -1 }), JSON.stringify({ id: 1.5 })]) {
      const raw = signInitData(fields({ user: value }), syntheticToken);
      assert.deepEqual(verifyInitData(raw, syntheticToken, options), { ok: false, reason: "invalid_user" }, value);
    }
  });

  it("refuses to run without a bot token", () => {
    assert.throws(() => verifyInitData("a=1", "", options));
    assert.throws(() => signInitData(fields(), ""));
  });
});
