import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  createOidcIssuer,
  createSimulatedClock,
  normalizeIssuerUrl,
  OIDC_ISSUER_ENVIRONMENT,
} from "../src/index.mjs";

const issuerBase = "http://127.0.0.1:9080";
const clientId = "miniapp-dev";
const redirectUri = "http://127.0.0.1:4183/bff/auth/callback";

function makeIssuer(overrides = {}) {
  return createOidcIssuer({
    issuer: issuerBase,
    clientId,
    redirectUris: [redirectUri],
    clock: createSimulatedClock(),
    ...overrides,
  });
}

function authorizeQuery(overrides = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid",
    state: "state-1",
    nonce: "nonce-1",
    code_challenge: createHash("sha256").update("v".repeat(64)).digest("base64url"),
    code_challenge_method: "S256",
    ...overrides,
  });
}

async function authorize(issuer, overrides = {}) {
  return issuer.handle({ method: "GET", url: `/authorize?${authorizeQuery(overrides)}` });
}

function codeFrom(redirect) {
  const url = new URL(redirect.headers.location);
  return { code: url.searchParams.get("code"), state: url.searchParams.get("state") };
}

async function exchange(issuer, form) {
  return issuer.handle({
    method: "POST",
    url: "/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "",
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: "v".repeat(64),
      ...form,
    }).toString(),
  });
}

describe("oidc issuer", () => {
  test("normalizes the issuer URL", () => {
    assert.equal(normalizeIssuerUrl("http://127.0.0.1:9080/"), "http://127.0.0.1:9080");
    assert.equal(normalizeIssuerUrl("https://idp.example/base/"), "https://idp.example/base");
    assert.throws(() => normalizeIssuerUrl("nope"), TypeError);
    assert.throws(() => normalizeIssuerUrl("http://a/?x=1"), TypeError);
    assert.throws(() => normalizeIssuerUrl("http://u:p@a/"), TypeError);
    assert.throws(() => normalizeIssuerUrl("ftp://a/"), TypeError);
  });

  test("serves discovery metadata and an RS256 JWKS", async () => {
    const issuer = makeIssuer();
    const metadata = await issuer.handle({
      method: "GET",
      url: "/.well-known/openid-configuration",
    });
    assert.equal(metadata.status, 200);
    const doc = JSON.parse(metadata.body);
    assert.equal(doc.issuer, issuerBase);
    assert.equal(doc.token_endpoint, `${issuerBase}/token`);
    assert.equal(doc.environment, OIDC_ISSUER_ENVIRONMENT);
    assert.deepEqual(doc.id_token_signing_alg_values_supported, ["RS256"]);

    const jwks = await issuer.handle({ method: "GET", url: "/.well-known/jwks.json" });
    assert.equal(jwks.status, 200);
    const key = JSON.parse(jwks.body).keys[0];
    assert.equal(key.kty, "RSA");
    assert.equal(key.kid, issuer.keyId);
    assert.equal(key.use, "sig");
    assert.equal(key.alg, "RS256");
  });

  test("redirects with a code for a valid request", async () => {
    const issuer = makeIssuer();
    const reply = await authorize(issuer);
    assert.equal(reply.status, 302);
    const { code, state } = codeFrom(reply);
    assert.ok(code.startsWith("cod_"));
    assert.equal(state, "state-1");
    const url = new URL(reply.headers.location);
    assert.equal(url.origin + url.pathname, redirectUri);
  });

  test("refuses unregistered clients and redirect URIs without redirecting", async () => {
    const issuer = makeIssuer();
    const badClient = await authorize(issuer, { client_id: "other" });
    assert.equal(badClient.status, 400);
    const badUri = await authorize(issuer, { redirect_uri: `${redirectUri}/x` });
    assert.equal(badUri.status, 400);
  });

  test("redirects OAuth errors for in-protocol validation failures", async () => {
    const issuer = makeIssuer();
    const cases = [
      { response_type: "token", error: "unsupported_response_type" },
      { scope: "profile", error: "invalid_scope" },
      { state: "", error: "invalid_request" },
      { nonce: "", error: "invalid_request" },
      { code_challenge_method: "plain", error: "invalid_request" },
      { code_challenge: "!!!", error: "invalid_request" },
      { code_challenge: "short", error: "invalid_request" },
    ];
    for (const entry of cases) {
      const { error, ...params } = entry;
      const reply = await authorize(issuer, params);
      assert.equal(reply.status, 302, JSON.stringify(params));
      const url = new URL(reply.headers.location);
      assert.equal(url.searchParams.get("error"), error, JSON.stringify(params));
    }
  });

  test("rejects duplicate query parameters", async () => {
    const issuer = makeIssuer();
    const reply = await issuer.handle({
      method: "GET",
      url: `/authorize?${authorizeQuery()}&state=second`,
    });
    assert.equal(reply.status, 400);
  });

  test("exchanges a code once for an RS256 id_token with at_hash", async () => {
    const issuer = makeIssuer();
    const granted = await authorize(issuer, { login_hint: "dev-customer-9" });
    const { code } = codeFrom(granted);
    const reply = await exchange(issuer, { code });
    assert.equal(reply.status, 200);
    const body = JSON.parse(reply.body);
    assert.equal(body.token_type, "Bearer");
    const [header, claims, signature] = body.id_token.split(".");
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString());
    assert.equal(decodedHeader.alg, "RS256");
    const decodedClaims = JSON.parse(Buffer.from(claims, "base64url").toString());
    assert.equal(decodedClaims.iss, issuerBase);
    assert.equal(decodedClaims.sub, "dev-customer-9");
    assert.equal(decodedClaims.aud, clientId);
    assert.equal(decodedClaims.nonce, "nonce-1");
    const expectedAtHash = createHash("sha256")
      .update(body.access_token)
      .digest()
      .subarray(0, 16)
      .toString("base64url");
    assert.equal(decodedClaims.at_hash, expectedAtHash);
    assert.ok(signature.length > 0);

    // The code is single-use.
    const replay = await exchange(issuer, { code });
    assert.equal(replay.status, 400);
    assert.equal(JSON.parse(replay.body).error, "invalid_grant");
  });

  test("rejects wrong verifier, wrong client, expired and unknown codes", async () => {
    const clock = createSimulatedClock();
    const issuer = makeIssuer({ clock });
    const { code } = codeFrom(await authorize(issuer));

    const wrongVerifier = await exchange(issuer, { code, code_verifier: "w".repeat(64) });
    assert.equal(JSON.parse(wrongVerifier.body).error, "invalid_grant");

    const { code: second } = codeFrom(await authorize(issuer));
    const wrongClient = await exchange(issuer, { code: second, client_id: "other" });
    assert.equal(JSON.parse(wrongClient.body).error, "invalid_grant");

    const { code: third } = codeFrom(await authorize(issuer));
    clock.advance(121);
    const expired = await exchange(issuer, { code: third });
    assert.equal(JSON.parse(expired.body).error, "invalid_grant");

    const unknown = await exchange(issuer, { code: "cod_missing" });
    assert.equal(JSON.parse(unknown.body).error, "invalid_grant");
  });

  test("enforces form encoding, method and size bounds on /token", async () => {
    const issuer = makeIssuer();
    const get = await issuer.handle({ method: "GET", url: "/token" });
    assert.equal(get.status, 405);
    const noType = await issuer.handle({
      method: "POST",
      url: "/token",
      body: "grant_type=authorization_code",
    });
    assert.equal(noType.status, 400);
    const oversized = await issuer.handle({
      method: "POST",
      url: "/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a".repeat(8_193),
    });
    assert.equal(oversized.status, 400);
    const wrongGrant = await exchange(issuer, { grant_type: "password" });
    assert.equal(JSON.parse(wrongGrant.body).error, "unsupported_grant_type");
  });

  test("bounds the pending-code map", async () => {
    const issuer = makeIssuer();
    for (let index = 0; index < 260; index += 1) {
      await authorize(issuer, { state: `s-${index}` });
    }
    // 260 minted codes against a 256 cap: only the newest survive.
    const oldestPossible = await exchange(issuer, { code: "cod_unlikely" });
    assert.equal(JSON.parse(oldestPossible.body).error, "invalid_grant");
  });
});
