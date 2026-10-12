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

  test("merges configured idTokenClaims into every minted id_token", async () => {
    const issuer = makeIssuer({
      idTokenClaims: {
        groups: ["compliance"],
        email: "operator@example.test",
        name: "Dev Operator",
      },
    });
    const granted = await authorize(issuer);
    const { code } = codeFrom(granted);
    const reply = await exchange(issuer, { code });
    assert.equal(reply.status, 200);
    const body = JSON.parse(reply.body);
    const decodedClaims = JSON.parse(
      Buffer.from(body.id_token.split(".")[1], "base64url").toString(),
    );
    assert.deepEqual(decodedClaims.groups, ["compliance"]);
    assert.equal(decodedClaims.email, "operator@example.test");
    assert.equal(decodedClaims.name, "Dev Operator");
    // Reserved claims are untouched.
    assert.equal(decodedClaims.iss, issuerBase);
    assert.equal(decodedClaims.sub, "dev-customer-1");
  });

  test("refuses idTokenClaims that override reserved claims or are not JSON", () => {
    for (const reserved of ["iss", "sub", "aud", "exp", "iat", "nbf", "nonce", "at_hash", "azp"]) {
      assert.throws(
        () => makeIssuer({ idTokenClaims: { [reserved]: "x" } }),
        /reserved claim/,
        reserved,
      );
    }
    assert.throws(() => makeIssuer({ idTokenClaims: { groups: () => [] } }), TypeError);
    assert.throws(() => makeIssuer({ idTokenClaims: { n: Number.POSITIVE_INFINITY } }), TypeError);
    assert.throws(() => makeIssuer({ idTokenClaims: "not-an-object" }), TypeError);
    assert.throws(() => makeIssuer({ idTokenClaims: { deep: { x: "a".repeat(5_000) } } }), TypeError);
  });
});

describe("oidc issuer adversarial pins (wave-65)", () => {
  test("refuses absolute-form and scheme-relative URLs naming another authority", async () => {
    const issuer = makeIssuer();
    const { code } = codeFrom(await authorize(issuer));
    const foreignToken = await issuer.handle({
      method: "POST",
      url: "http://evil.example/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: "v".repeat(64),
      }).toString(),
    });
    assert.equal(foreignToken.status, 404);
    const foreignAuthorize = await issuer.handle({
      method: "GET",
      url: `http://evil.example/authorize?${authorizeQuery()}`,
    });
    assert.equal(foreignAuthorize.status, 404);
    const schemeRelativeJwks = await issuer.handle({
      method: "GET",
      url: "//evil.example/.well-known/jwks.json",
    });
    assert.equal(schemeRelativeJwks.status, 404);
    // Same-origin absolute-form remains legal.
    const sameOrigin = await issuer.handle({
      method: "GET",
      url: `${issuerBase}/.well-known/jwks.json`,
    });
    assert.equal(sameOrigin.status, 200);
  });

  test("serves endpoints only under the declared issuer path prefix", async () => {
    const issuer = makeIssuer({ issuer: `${issuerBase}/base` });
    const metadata = await issuer.handle({
      method: "GET",
      url: "/base/.well-known/openid-configuration",
    });
    assert.equal(metadata.status, 200);
    assert.equal(
      JSON.parse(metadata.body).authorization_endpoint,
      `${issuerBase}/base/authorize`,
    );
    const granted = await issuer.handle({
      method: "GET",
      url: `/base/authorize?${authorizeQuery()}`,
    });
    assert.equal(granted.status, 302);
    const { code } = codeFrom(granted);
    const outside = await issuer.handle({
      method: "GET",
      url: `/authorize?${authorizeQuery()}`,
    });
    assert.equal(outside.status, 404);
    const exchangeReply = await issuer.handle({
      method: "POST",
      url: "/base/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: "v".repeat(64),
      }).toString(),
    });
    assert.equal(exchangeReply.status, 200);
    const wrongPrefix = await issuer.handle({
      method: "GET",
      url: `/baseX/authorize?${authorizeQuery()}`,
    });
    assert.equal(wrongPrefix.status, 404);
    const baseOnly = await issuer.handle({ method: "GET", url: "/base" });
    assert.equal(baseOnly.status, 404);
    const foreignPrefixed = await issuer.handle({
      method: "GET",
      url: `http://evil.example/base/authorize?${authorizeQuery()}`,
    });
    assert.equal(foreignPrefixed.status, 404);
  });

  test("rejects duplicated form parameters on /token as invalid_request", async () => {
    const issuer = makeIssuer();
    const { code } = codeFrom(await authorize(issuer));
    const duplicatedGrant = await issuer.handle({
      method: "POST",
      url: "/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&grant_type=password",
    });
    assert.equal(JSON.parse(duplicatedGrant.body).error, "invalid_request");
    const duplicatedCode = await issuer.handle({
      method: "POST",
      url: "/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `${new URLSearchParams({
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: "v".repeat(64),
      })}&code=${code}&code=${code}`,
    });
    assert.equal(JSON.parse(duplicatedCode.body).error, "invalid_request");
  });

  test("the duplicate sentinel cannot collide with a configured client id", async () => {
    const issuer = makeIssuer({ clientId: "duplicate" });
    const granted = await issuer.handle({
      method: "GET",
      url: `/authorize?${authorizeQuery({ client_id: "duplicate" })}`,
    });
    assert.equal(granted.status, 302);
    const { code } = codeFrom(granted);
    const reply = await issuer.handle({
      method: "POST",
      url: "/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=duplicate&client_id=extra&code_verifier=${"v".repeat(64)}`,
    });
    assert.equal(JSON.parse(reply.body).error, "invalid_request");
  });

  test("requires the exact form content type, matched case-insensitively", async () => {
    const issuer = makeIssuer();
    const mintAndExchange = async (contentType) => {
      const { code } = codeFrom(await authorize(issuer));
      return issuer.handle({
        method: "POST",
        url: "/token",
        headers: { "content-type": contentType },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: "v".repeat(64),
        }).toString(),
      });
    };
    assert.equal((await mintAndExchange("application/x-www-form-urlencodedjunk")).status, 400);
    assert.equal((await mintAndExchange("application/x-www-form-urlencoded-x")).status, 400);
    assert.equal((await mintAndExchange("application/x-www-form-urlencoded; charset=utf-8")).status, 200);
    assert.equal((await mintAndExchange("APPLICATION/X-WWW-FORM-URLENCODED")).status, 200);
  });

  test("an oversized state is never reflected into the error redirect", async () => {
    const issuer = makeIssuer();
    const longState = "s".repeat(200);
    const protocolError = await authorize(issuer, { response_type: "token", state: longState });
    assert.equal(protocolError.status, 302);
    const url = new URL(protocolError.headers.location);
    assert.equal(url.searchParams.get("error"), "unsupported_response_type");
    assert.equal(url.searchParams.get("state"), null);
    assert.ok(protocolError.headers.location.length < redirectUri.length + 200);
    const validationError = await authorize(issuer, { state: longState });
    assert.equal(validationError.status, 302);
    const url2 = new URL(validationError.headers.location);
    assert.equal(url2.searchParams.get("error"), "invalid_request");
    assert.equal(url2.searchParams.get("state"), null);
  });

  test("answers 405 with an allow header on the wrong method", async () => {
    const issuer = makeIssuer();
    for (const path of ["/authorize", "/.well-known/jwks.json", "/.well-known/openid-configuration"]) {
      const reply = await issuer.handle({ method: "POST", url: path });
      assert.equal(reply.status, 405, path);
      assert.equal(reply.headers.allow, "GET", path);
    }
    const get = await issuer.handle({ method: "GET", url: "/token" });
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, "POST");
  });

  test("error bodies stay in the OAuth taxonomy without internals", async () => {
    const issuer = makeIssuer();
    const bodies = [
      await issuer.handle({ method: "GET", url: "/unrelated" }),
      await issuer.handle({ method: "GET", url: "/authorize" }),
      await issuer.handle({ method: "GET", url: "/token" }),
      await issuer.handle({ method: "POST", url: "/token" }),
      await authorize(issuer, { client_id: "nobody" }),
    ];
    for (const reply of bodies) {
      const parsed = JSON.parse(reply.body);
      assert.ok(
        Object.keys(parsed).every((key) => key === "error" || key === "state"),
        reply.body,
      );
      assert.match(parsed.error, /^[a-z_]+$/);
    }
  });

  test("codes stay single-use under concurrent exchange", async () => {
    const issuer = makeIssuer();
    const { code } = codeFrom(await authorize(issuer));
    const [first, second] = await Promise.all([
      exchange(issuer, { code }),
      exchange(issuer, { code }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 400]);
  });

  test("expired and consumed codes are indistinguishable", async () => {
    const clock = createSimulatedClock();
    const issuer = makeIssuer({ clock });
    const { code: consumed } = codeFrom(await authorize(issuer));
    await exchange(issuer, { code: consumed });
    const replay = (await exchange(issuer, { code: consumed })).body;
    const { code: expiring } = codeFrom(await authorize(issuer));
    clock.advance(121);
    const expired = (await exchange(issuer, { code: expiring })).body;
    const unknown = (await exchange(issuer, { code: "cod_never_minted" })).body;
    assert.equal(replay, expired);
    assert.equal(expired, unknown);
  });

  test("the pending map sweeps expiry before capping live entries", async () => {
    const clock = createSimulatedClock();
    const issuer = makeIssuer({ clock });
    const batchA = [];
    for (let index = 0; index < 128; index += 1) {
      batchA.push(codeFrom(await authorize(issuer, { state: `a-${index}` })).code);
    }
    clock.advance(121);
    const batchB = [];
    for (let index = 0; index < 128; index += 1) {
      batchB.push(codeFrom(await authorize(issuer, { state: `b-${index}` })).code);
    }
    for (let index = 0; index < 4; index += 1) {
      await authorize(issuer, { state: `c-${index}` });
    }
    // Expired batch A was swept without evicting live batch B.
    assert.equal((await exchange(issuer, { code: batchB[0] })).status, 200);
    const a0 = await exchange(issuer, { code: batchA[0] });
    assert.equal(JSON.parse(a0.body).error, "invalid_grant");
    // Beyond the cap the oldest live entries evict first.
    const codes = [];
    for (let index = 0; index < 300; index += 1) {
      codes.push(codeFrom(await authorize(issuer, { state: `d-${index}` })).code);
    }
    const oldest = await exchange(issuer, { code: codes[0] });
    assert.equal(JSON.parse(oldest.body).error, "invalid_grant");
    assert.equal((await exchange(issuer, { code: codes[299] })).status, 200);
  });

  test("the code expiry boundary is exact", async () => {
    const clock = createSimulatedClock();
    const issuer = makeIssuer({ clock });
    const { code: alive } = codeFrom(await authorize(issuer));
    clock.advance(119);
    assert.equal((await exchange(issuer, { code: alive })).status, 200);
    const { code: boundary } = codeFrom(await authorize(issuer));
    clock.advance(120);
    const expired = await exchange(issuer, { code: boundary });
    assert.equal(JSON.parse(expired.body).error, "invalid_grant");
  });

  test("login_hint outside the subject pattern falls back to the default", async () => {
    const issuer = makeIssuer();
    for (const hint of ["not a subject!!", "x".repeat(200), "-leading", ""] ) {
      const granted = await authorize(issuer, { login_hint: hint });
      assert.equal(granted.status, 302, JSON.stringify(hint));
      const { code } = codeFrom(granted);
      const reply = await exchange(issuer, { code });
      const claims = JSON.parse(
        Buffer.from(JSON.parse(reply.body).id_token.split(".")[1], "base64url").toString(),
      );
      assert.equal(claims.sub, "dev-customer-1", JSON.stringify(hint));
    }
    const hinted = await authorize(issuer, { login_hint: "dev-customer-42" });
    const { code } = codeFrom(hinted);
    const claims = JSON.parse(
      Buffer.from(JSON.parse((await exchange(issuer, { code })).body).id_token.split(".")[1], "base64url").toString(),
    );
    assert.equal(claims.sub, "dev-customer-42");
  });

  test("a duplicated nonce is refused like a duplicated state", async () => {
    const issuer = makeIssuer();
    const reply = await issuer.handle({
      method: "GET",
      url: `/authorize?${authorizeQuery()}&nonce=second`,
    });
    assert.equal(reply.status, 400);
    assert.equal(JSON.parse(reply.body).error, "invalid_request");
  });
});
