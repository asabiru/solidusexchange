import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canonicalStringify,
  createCallbackSigner,
  createCallbackVerifier,
  createKycCallbackVerifier,
  createKycSimulator,
  createNonceStore,
  createSeededRandom,
  createSimulatedClock,
  createVerificationKeyring,
  DEFAULT_MAX_AGE_SECONDS,
  DEFAULT_MAX_FUTURE_SECONDS,
  generateSimulatorKey,
  SIGNATURE_HEADERS,
  verificationKeyOf,
} from "../src/index.mjs";
import { freshKey, keyringOf, nextNonce, signRaw } from "./helpers.mjs";

const ALGORITHMS = ["ed25519", "hmac-sha256"];

async function kycDelivery(key) {
  const clock = createSimulatedClock();
  const simulator = createKycSimulator({ seed: "signing", key, clock, defaultScenario: "approve" });
  await simulator.submitApplicant({ applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-signing-1" });
  clock.advance(3600);
  const [first] = simulator.drainCallbacks();
  return first;
}

function verifierFor(key, options = {}) {
  return createKycCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore(), ...options });
}

const withHeader = (headers, name, value) => ({ ...headers, [name]: value });

for (const algorithm of ALGORITHMS) {
  describe(`callback verifier (${algorithm})`, () => {
    test("accepts a genuine delivery once and rejects its replay", async () => {
      const key = freshKey(algorithm);
      const delivery = await kycDelivery(key);
      const verify = verifierFor(key);
      const result = verify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt });
      assert.equal(result.ok, true);
      assert.equal(result.payload.domain, "kyc");
      assert.deepEqual(verify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt + 1 }), { ok: false, reason: "replayed_nonce" });
    });

    test("rejects tampered bodies and signatures", async () => {
      const key = freshKey(algorithm);
      const delivery = await kycDelivery(key);
      const verify = verifierFor(key);
      const now = delivery.deliverAt;
      const tampered = Buffer.from(delivery.body);
      tampered[tampered.length - 3] ^= 1;
      assert.equal(verify({ headers: delivery.headers, body: tampered, now }).reason, "signature_mismatch");
      const signature = delivery.headers[SIGNATURE_HEADERS.signature];
      const flipped = signature.slice(0, 5) + (signature[5] === "A" ? "B" : "A") + signature.slice(6);
      assert.equal(verify({ headers: withHeader(delivery.headers, SIGNATURE_HEADERS.signature, flipped), body: delivery.body, now }).reason, "signature_mismatch");
      const otherNonce = withHeader(delivery.headers, SIGNATURE_HEADERS.nonce, nextNonce());
      assert.equal(verify({ headers: otherNonce, body: delivery.body, now }).reason, "signature_mismatch");
      const otherTime = withHeader(delivery.headers, SIGNATURE_HEADERS.timestamp, String(now - 1));
      assert.equal(verify({ headers: otherTime, body: delivery.body, now }).reason, "signature_mismatch");
    });

    test("rejects a wrong key with the same key id and an unknown key id", async () => {
      const key = freshKey(algorithm);
      const impostor = freshKey(algorithm);
      const delivery = await kycDelivery(impostor);
      assert.equal(verifierFor(key)({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt }).reason, "signature_mismatch");
      const stranger = freshKey(algorithm, "sim-key-2");
      const other = await kycDelivery(stranger);
      assert.equal(verifierFor(key)({ headers: other.headers, body: other.body, now: other.deliverAt }).reason, "unknown_key_id");
    });

    test("rejects stale and future timestamps at the exact boundaries", async () => {
      const key = freshKey(algorithm);
      const delivery = await kycDelivery(key);
      const signedAt = delivery.deliverAt;
      assert.equal(verifierFor(key)({ headers: delivery.headers, body: delivery.body, now: signedAt + DEFAULT_MAX_AGE_SECONDS }).ok, true);
      assert.equal(verifierFor(key)({ headers: delivery.headers, body: delivery.body, now: signedAt + DEFAULT_MAX_AGE_SECONDS + 1 }).reason, "stale_timestamp");
      assert.equal(verifierFor(key)({ headers: delivery.headers, body: delivery.body, now: signedAt - DEFAULT_MAX_FUTURE_SECONDS }).ok, true);
      assert.equal(verifierFor(key)({ headers: delivery.headers, body: delivery.body, now: signedAt - DEFAULT_MAX_FUTURE_SECONDS - 1 }).reason, "future_timestamp");
      assert.equal(verifierFor(key, { maxAgeSeconds: 10 })({ headers: delivery.headers, body: delivery.body, now: signedAt + 11 }).reason, "stale_timestamp");
    });

    test("signature of one domain does not verify in another", async () => {
      const key = freshKey(algorithm);
      const delivery = await kycDelivery(key);
      const kytVerify = createCallbackVerifier({ domain: "kyt", keyring: keyringOf(key), nonceStore: createNonceStore(), validatePayload: () => null });
      assert.equal(kytVerify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt }).reason, "signature_mismatch");
    });
  });
}

describe("callback verifier input hardening", () => {
  test("cross-algorithm signatures fail on length before verification", async () => {
    const edKey = freshKey("ed25519");
    const hmacKey = freshKey("hmac-sha256");
    const delivery = await kycDelivery(hmacKey);
    assert.equal(verifierFor(edKey)({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt }).reason, "invalid_signature_encoding");
    const edDelivery = await kycDelivery(edKey);
    assert.equal(verifierFor(hmacKey)({ headers: edDelivery.headers, body: edDelivery.body, now: edDelivery.deliverAt }).reason, "invalid_signature_encoding");
  });

  test("rejects non-byte bodies and oversized bodies", async () => {
    const key = freshKey();
    const delivery = await kycDelivery(key);
    const verify = verifierFor(key);
    const now = delivery.deliverAt;
    for (const body of [delivery.body.toString("utf8"), JSON.parse(delivery.body.toString("utf8")), null, undefined, [...delivery.body], delivery.body.buffer]) {
      assert.equal(verify({ headers: delivery.headers, body, now }).reason, "invalid_body_type");
    }
    assert.equal(verify({ headers: delivery.headers, body: Buffer.alloc(16 * 1024 + 1, 0x20), now }).reason, "body_too_large");
    assert.equal(verifierFor(key, { maxBodyBytes: 64 })({ headers: delivery.headers, body: delivery.body, now }).reason, "body_too_large");
  });

  test("rejects malformed header containers and header values", async () => {
    const key = freshKey();
    const delivery = await kycDelivery(key);
    const verify = verifierFor(key);
    const now = delivery.deliverAt;
    const headers = delivery.headers;
    const cases = [
      [null, "invalid_headers"],
      ["x-sim-key-id: sim-key-1", "invalid_headers"],
      [Object.entries(headers), "invalid_headers"],
      [new Map(Object.entries(headers)), "invalid_headers"],
      [withHeader(headers, SIGNATURE_HEADERS.nonce, [headers[SIGNATURE_HEADERS.nonce]]), "invalid_headers"],
      [withHeader(headers, "x sim", "1"), "invalid_headers"],
      [withHeader(headers, "x-sim-n\u00f6nce", "1"), "invalid_headers"],
      [withHeader(headers, "x-extra", "a".repeat(257)), "invalid_headers"],
      [{ ...headers, "X-Sim-Nonce": headers[SIGNATURE_HEADERS.nonce] }, "duplicate_header"],
      [{ ...headers, "X-SIM-SIGNATURE": "v1=AAAA" }, "duplicate_header"],
      [Object.fromEntries(Object.entries(headers).filter(([name]) => name !== SIGNATURE_HEADERS.nonce)), "missing_header"],
      [Object.fromEntries(Object.entries(headers).filter(([name]) => name !== SIGNATURE_HEADERS.signature)), "missing_header"],
    ];
    const accessor = { ...headers };
    Object.defineProperty(accessor, SIGNATURE_HEADERS.nonce, { enumerable: true, get: () => headers[SIGNATURE_HEADERS.nonce] });
    cases.push([accessor, "invalid_headers"]);
    for (const [value, reason] of cases) {
      assert.equal(verify({ headers: value, body: delivery.body, now }).reason, reason, String(reason));
    }
  });

  test("header names are case-insensitive but values are exact", async () => {
    const key = freshKey();
    const delivery = await kycDelivery(key);
    const upper = Object.fromEntries(Object.entries(delivery.headers).map(([name, value]) => [name.toUpperCase(), value]));
    assert.equal(verifierFor(key)({ headers: upper, body: delivery.body, now: delivery.deliverAt }).ok, true);
    const now = delivery.deliverAt;
    const verify = verifierFor(key);
    const id = delivery.headers[SIGNATURE_HEADERS.keyId];
    for (const value of [id.toUpperCase(), ` ${id}`, `${id} `, `${id}\u200b`, "", "-sim"]) {
      assert.equal(verify({ headers: withHeader(delivery.headers, SIGNATURE_HEADERS.keyId, value), body: delivery.body, now }).reason, "invalid_key_id", JSON.stringify(value));
    }
    const time = delivery.headers[SIGNATURE_HEADERS.timestamp];
    for (const value of [`+${time}`, `0${time}`, ` ${time}`, `${time} `, `${time}.0`, "1.7e9", `${time}\n`, "-1", "", "\u0661\u0667", `${time}000`, "0x10"]) {
      assert.equal(verify({ headers: withHeader(delivery.headers, SIGNATURE_HEADERS.timestamp, value), body: delivery.body, now }).reason, "invalid_timestamp", JSON.stringify(value));
    }
    const nonce = delivery.headers[SIGNATURE_HEADERS.nonce];
    for (const value of [nonce.toUpperCase(), nonce.slice(1), `${nonce}0`, ` ${nonce}`, `${nonce.slice(0, 31)}g`, ""]) {
      assert.equal(verify({ headers: withHeader(delivery.headers, SIGNATURE_HEADERS.nonce, value), body: delivery.body, now }).reason, "invalid_nonce", JSON.stringify(value));
    }
  });

  test("signature encodings other than canonical unpadded base64url are rejected", async () => {
    const key = freshKey();
    const delivery = await kycDelivery(key);
    const verify = verifierFor(key);
    const now = delivery.deliverAt;
    const signature = delivery.headers[SIGNATURE_HEADERS.signature];
    const raw = Buffer.from(signature.slice(3), "base64url");
    const lastIndex = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(signature.at(-1));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const nonCanonicalTail = signature.slice(0, -1) + alphabet[(lastIndex & ~0b11) | ((lastIndex + 1) & 0b11)];
    const variants = [
      `v1=${raw.toString("base64")}`,
      `${signature}==`,
      `${signature}=`,
      `V1=${signature.slice(3)}`,
      `v2=${signature.slice(3)}`,
      `v1:${signature.slice(3)}`,
      `v1= ${signature.slice(3)}`,
      `${signature} `,
      ` ${signature}`,
      `v1=${raw.toString("hex")}`,
      `v1=${signature.slice(3, -1)}`,
      `${signature}A`,
      `v1=${signature.slice(3).replace(/./, "\uff21")}`,
      `v1=${signature.slice(3)},v1=${signature.slice(3)}`,
      nonCanonicalTail,
      "",
    ];
    for (const value of variants) {
      assert.equal(verify({ headers: withHeader(delivery.headers, SIGNATURE_HEADERS.signature, value), body: delivery.body, now }).reason, "invalid_signature_encoding", JSON.stringify(value));
    }
  });

  test("signed but non-canonical or malformed bodies are rejected after authentication", async () => {
    for (const algorithm of ALGORITHMS) {
      const key = freshKey(algorithm);
      const delivery = await kycDelivery(key);
      const now = delivery.deliverAt;
      const canonical = delivery.body.toString("utf8");
      const payload = JSON.parse(canonical);
      const reordered = `{${Object.entries(payload).reverse().map(([name, value]) => `${JSON.stringify(name)}:${JSON.stringify(value)}`).join(",")}}`;
      const firstKey = Object.keys(payload).sort()[0];
      const cases = [
        [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), delivery.body]), "byte_order_mark"],
        [Buffer.concat([delivery.body.subarray(0, 10), Buffer.from([0xc0, 0xaf]), delivery.body.subarray(10)]), "invalid_utf8"],
        [JSON.stringify(payload, null, 2), "non_canonical_json"],
        [`${canonical}\n`, "non_canonical_json"],
        [` ${canonical}`, "non_canonical_json"],
        [reordered, "non_canonical_json"],
        [canonical.replace(`"${firstKey}"`, `"\\u00${firstKey.charCodeAt(0).toString(16)}${firstKey.slice(1)}"`), "non_canonical_json"],
        [canonical.replace('"sequence":1', '"sequence":1.0'), "non_canonical_json"],
        [canonical.replace('"sequence":1', '"sequence":1e0'), "non_canonical_json"],
        [canonical.replace('"basic"', '"b\\u0061sic"'), "non_canonical_json"],
        [canonical.replace('"basic"', '"BASIC"'), "invalid_payload"],
        [canonical.replace('"sim-applicant-1"', '"sim-applicant-e\u0301"'), "non_canonical_json"],
        [canonical.replace('"sim-applicant-1"', '"sim-\uff41pplicant-1"'), "invalid_payload"],
        [canonical.replace('"sim-applicant-1"', '"sim-applicant-\\ud800"'), "lone_surrogate"],
        [canonical.replace('{"applicant_ref"', '{"applicant_ref":"sim-x","applicant_ref"'), "duplicate_key"],
        [canonical.replace('{"applicant_ref"', '{"applicant_ref":"sim-x","\\u0061pplicant_ref"'), "duplicate_key"],
        [canonical.replace("}", ",}"), "invalid_json"],
        ["[]", "invalid_json"],
        [`${"[".repeat(20)}${"]".repeat(20)}`, "nesting_too_deep"],
        [canonicalStringify({ ...payload, domain: "kyt" }), "domain_mismatch"],
        [canonicalStringify({ ...payload, environment: "production" }), "domain_mismatch"],
        [canonicalStringify({ ...payload, extra: "x" }), "invalid_payload"],
        [canonicalStringify({ ...payload, status: "approved", reason_codes: ["SIM_DATA_MISMATCH"] }), "invalid_payload"],
      ];
      for (const [body, reason] of cases) {
        const signed = signRaw({ key, domain: "kyc", body, timestamp: now, nonce: nextNonce() });
        const result = verifierFor(key)({ headers: signed.headers, body: signed.body, now });
        assert.equal(result.reason, reason, `${algorithm} ${String(body).slice(0, 60)}`);
      }
      const control = signRaw({ key, domain: "kyc", body: canonical, timestamp: now, nonce: nextNonce() });
      assert.equal(verifierFor(key)({ headers: control.headers, body: control.body, now }).ok, true);
    }
  });

  test("the nonce store fails closed when full and forgets expired nonces", async () => {
    const key = freshKey();
    const store = createNonceStore({ maxEntries: 1 });
    const verify = verifierFor(key, { nonceStore: store });
    const clock = createSimulatedClock();
    const simulator = createKycSimulator({ seed: "nonce", key, clock, defaultScenario: "approve" });
    await simulator.submitApplicant({ applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-nonce-1" });
    clock.advance(3600);
    const [first, second] = simulator.drainCallbacks();
    assert.equal(verify({ headers: first.headers, body: first.body, now: first.deliverAt }).ok, true);
    assert.equal(verify({ headers: second.headers, body: second.body, now: second.deliverAt }).reason, "nonce_store_full");
    assert.equal(store.size(), 1);
    assert.equal(store.record("f".repeat(32), 10, 1), "full");
    assert.equal(store.record("e".repeat(32), first.deliverAt + 10_000, first.deliverAt + 5000), "recorded");
    assert.throws(() => createNonceStore({ maxEntries: 0 }), RangeError);
  });

  test("verifier and keyring construction fail closed", () => {
    const key = freshKey();
    assert.throws(() => createCallbackVerifier({ domain: "kyc", keyring: new Map(), nonceStore: createNonceStore(), validatePayload: () => null }), TypeError);
    assert.throws(() => createCallbackVerifier({ domain: "payments", keyring: keyringOf(key), nonceStore: createNonceStore(), validatePayload: () => null }), TypeError);
    assert.throws(() => createCallbackVerifier({ domain: "kyc", keyring: keyringOf(key), nonceStore: createNonceStore() }), TypeError);
    assert.throws(() => verifierFor(key, { maxAgeSeconds: 0 }), RangeError);
    assert.throws(() => verifierFor(key, { maxBodyBytes: 2 * 1024 * 1024 }), RangeError);
    assert.throws(() => createVerificationKeyring([verificationKeyOf(key), verificationKeyOf(key)]), /duplicate key id/);
    assert.throws(() => createVerificationKeyring([{ keyId: "sim-key-1", algorithm: "ed25519", key: key.signingKey }]), /public Ed25519/);
    assert.throws(() => createVerificationKeyring([{ keyId: "sim-key-1", algorithm: "rsa", key: key.verificationKey }]), /unsupported/);
    assert.throws(() => generateSimulatorKey({ keyId: "Sim Key" }), TypeError);
    assert.throws(() => generateSimulatorKey({ keyId: "sim-key", algorithm: "hmac-md5" }), TypeError);
    assert.throws(() => verifierFor(key)({ headers: {}, body: Buffer.alloc(0), now: 1.5 }), RangeError);
  });

  test("signers only sign simulator payloads of their own domain", () => {
    const key = freshKey();
    const signer = createCallbackSigner({ key, domain: "kyc", random: createSeededRandom("signer") });
    assert.throws(() => signer.sign({ domain: "kyt", environment: "dev-simulator" }, 1), TypeError);
    assert.throws(() => signer.sign({ domain: "kyc", environment: "production" }, 1), TypeError);
    assert.throws(() => signer.sign({ domain: "kyc", environment: "dev-simulator", amount: 1.5 }, 1), /safe integers/);
    const signed = signer.sign({ domain: "kyc", environment: "dev-simulator" }, 1_767_225_600);
    assert.equal(signed.body.toString("utf8"), '{"domain":"kyc","environment":"dev-simulator"}');
    assert.match(signed.headers[SIGNATURE_HEADERS.signature], /^v1=[A-Za-z0-9_-]{86}$/);
  });
});
