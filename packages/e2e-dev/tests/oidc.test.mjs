import assert from "node:assert/strict";
import { createHash, createPublicKey, createSign, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { after, before, describe, test } from "node:test";

import { createOidcIssuer, OIDC_MAX_PENDING_CODES } from "../../provider-simulators/src/index.mjs";
import { loadServerConfig as loadBackofficeConfig } from "../../../backoffice/.server-dist/server/config.js";
import { createBackofficeServer } from "../../../backoffice/.server-dist/server/server.js";
import { loadServerConfig } from "../../../miniapp/.server-dist/server/config.js";
import { createMiniappServer } from "../../../miniapp/.server-dist/server/server.js";
import { closeServer, listen } from "./stack.mjs";

// OIDC arm of the dev stack: a REAL provider-simulators OIDC issuer hosted on
// node:http beside an in-process miniapp BFF configured through the
// MINIAPP_OIDC_* env pair. Exercises the full authorization-code + PKCE flow
// — login redirect, transaction cookie, issuer authorize, callback token
// exchange, id_token verification and session mint — plus the fail-closed
// paths (state mismatch, expired code, replayed code, issuer error).

const origin = "http://127.0.0.1:4183";
const clientId = "miniapp-dev";

let now;
let issuer;
let issuerBase;
let issuerServer;
let miniapp;
let miniappBase;

before(async () => {
  now = Date.now();
  issuerServer = createServer();
  // Port first, issuer second: the issuer's own URL is its `iss`.
  await new Promise((resolve) => issuerServer.listen(0, "127.0.0.1", resolve));
  issuerBase = `http://127.0.0.1:${issuerServer.address().port}`;
  issuer = createOidcIssuer({
    issuer: issuerBase,
    clientId,
    redirectUris: [`${origin}/bff/auth/callback`],
    clock: { now: () => Math.floor(now / 1000) },
  });
  issuerServer.on("request", (request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      void issuer
        .handle({
          method: request.method ?? "GET",
          url: request.url ?? "/",
          headers: request.headers,
          body: body || undefined,
        })
        .then((reply) => {
          response.writeHead(reply.status, { ...reply.headers });
          response.end(reply.body);
        });
    });
  });
  const config = loadServerConfig({
    MINIAPP_ALLOW_DEV_LOGIN: "true",
    MINIAPP_ALLOWED_ORIGINS: origin,
    MINIAPP_OIDC_ISSUER_URL: issuerBase,
    MINIAPP_OIDC_CLIENT_ID: clientId,
  });
  miniapp = createMiniappServer(config, { clock: () => now });
  miniappBase = await listen(miniapp);
});

after(async () => {
  if (miniapp) await closeServer(miniapp);
  if (issuerServer) await closeServer(issuerServer);
});

function setCookies(response, name) {
  const getter = response.headers.getSetCookie?.bind(response.headers);
  const list = getter ? getter() : (response.headers.get("set-cookie") ?? "").split(/,(?=solidchange_)/);
  return list.filter((cookie) => cookie.startsWith(`${name}=`));
}

async function loginStart() {
  const response = await fetch(`${miniappBase}/bff/auth/login`, { redirect: "manual" });
  assert.equal(response.status, 302);
  const authorize = new URL(response.headers.get("location") ?? "");
  assert.equal(authorize.origin + authorize.pathname, `${issuerBase}/authorize`);
  const tx = setCookies(response, "solidchange_ma_oidc_tx")[0];
  assert.ok(tx, "transaction cookie expected");
  return { authorize, tx: tx.split(";")[0] };
}

async function issuerGrant(authorize) {
  const granted = await fetch(authorize, { redirect: "manual" });
  assert.equal(granted.status, 302);
  return new URL(granted.headers.get("location") ?? "");
}

async function callbackOf(callbackUrl, tx, headers = {}) {
  return fetch(`${miniappBase}${callbackUrl.pathname}${callbackUrl.search}`, {
    redirect: "manual",
    headers: { cookie: tx, ...headers },
  });
}

describe("oidc dev login", () => {
  test("full authorization-code + PKCE flow mints a working session", async () => {
    const { authorize, tx } = await loginStart();
    assert.equal(authorize.searchParams.get("response_type"), "code");
    assert.equal(authorize.searchParams.get("client_id"), clientId);
    assert.equal(authorize.searchParams.get("redirect_uri"), `${origin}/bff/auth/callback`);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorize.searchParams.get("nonce"));

    const callback = await issuerGrant(authorize);
    assert.equal(callback.origin + callback.pathname, `${origin}/bff/auth/callback`);

    const response = await callbackOf(callback, tx, { "sec-fetch-site": "cross-site" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), origin);
    const session = setCookies(response, "solidchange_ma_session")[0];
    assert.ok(session, "session cookie expected");

    const profile = await fetch(`${miniappBase}/bff/profile`, {
      headers: { cookie: session.split(";")[0] },
    });
    assert.equal(profile.status, 200);
    const sessionView = await fetch(`${miniappBase}/bff/session`, {
      headers: { cookie: session.split(";")[0] },
    }).then((response) => response.json());
    assert.equal(sessionView.authenticated, true);
    assert.equal(sessionView.source, "dev-synthetic");
    const expectedSubject = `dev-${createHash("sha256")
      .update("solidchange-miniapp-oidc|dev-customer-1")
      .digest("hex")
      .slice(0, 16)}`;
    assert.equal(sessionView.customerRef, `SC-DEV-${expectedSubject.slice(-5).toUpperCase()}`);
  });

  test("issuer error, state mismatch and missing transaction cookie fail closed", async () => {
    const expectFailed = (response) => {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `${origin}/?error=auth_failed`);
      assert.equal(setCookies(response, "solidchange_ma_session").length, 0);
    };

    expectFailed(
      await fetch(`${miniappBase}/bff/auth/callback?error=access_denied&state=s`, {
        redirect: "manual",
      })
    );

    const { authorize, tx } = await loginStart();
    const callback = await issuerGrant(authorize);
    const foreignTx = "solidchange_ma_oidc_tx=foreign.foreign";
    expectFailed(await callbackOf(callback, foreignTx));
    expectFailed(
      await fetch(`${miniappBase}${callback.pathname}${callback.search}`, { redirect: "manual" })
    );

    // Tampered state in the callback even with the right cookie.
    const { authorize: authorizeB, tx: txB } = await loginStart();
    const callbackB = await issuerGrant(authorizeB);
    callbackB.searchParams.set("state", "tampered");
    expectFailed(await callbackOf(callbackB, txB));
  });

  test("expired and replayed codes fail closed at token exchange", async () => {
    const expectFailed = (response) => {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `${origin}/?error=auth_failed`);
      assert.equal(setCookies(response, "solidchange_ma_session").length, 0);
    };

    // Expired: the issuer's clock moved past the code TTL before exchange.
    const { authorize, tx } = await loginStart();
    const callback = await issuerGrant(authorize);
    const code = callback.searchParams.get("code");
    now += 121_000;
    try {
      expectFailed(await callbackOf(callback, tx));
    } finally {
      now -= 121_000;
    }

    // Replayed: a successful flow, then the same callback again — the pending
    // entry is single-use even though the tx cookie is still presented.
    const second = await loginStart();
    const callbackB = await issuerGrant(second.authorize);
    const first = await callbackOf(callbackB, second.tx);
    assert.equal(first.headers.get("location"), origin);
    expectFailed(await callbackOf(callbackB, second.tx));

    // And the issuer itself refuses the same code on a fresh exchange.
    const replayedExchange = await issuer.handle({
      method: "POST",
      url: "/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/bff/auth/callback`,
        client_id: clientId,
        code_verifier: "v".repeat(64),
      }).toString(),
    });
    assert.equal(replayedExchange.status, 400);
  });

  test("an unconfigured BFF has no auth routes", async () => {
    const config = loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" });
    const isolated = createMiniappServer(config, { clock: () => now });
    const base = await listen(isolated);
    try {
      const login = await fetch(`${base}/bff/auth/login`, { redirect: "manual" });
      assert.equal(login.status, 404);
      const callback = await fetch(`${base}/bff/auth/callback?code=c&state=s`, {
        redirect: "manual",
      });
      assert.equal(callback.status, 404);
    } finally {
      await closeServer(isolated);
    }
  });
});

describe("oidc hostile issuer (wave-65)", () => {
  // A fully attacker-controlled issuer: own RSA key, answers /authorize by
  // echoing the state and capturing the nonce, /token with arbitrary
  // id_tokens, /.well-known/jwks.json with its own key.
  function makeEvilIssuer(tokenFor) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    const state = { nonce: "", jwksText: null, iss: "", hits: { token: 0 } };
    const signClaims = (claims, header = {}) => {
      const head = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT", kid: "evil", ...header })
      ).toString("base64url");
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(privateKey, "base64url");
      return `${head}.${payload}.${signature}`;
    };
    const server = createServer();
    server.on("request", (request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk.toString("utf8"); });
      request.on("end", () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/authorize") {
          state.nonce = url.searchParams.get("nonce") ?? "";
          const redirect = new URL(`${origin}/bff/auth/callback`);
          redirect.searchParams.set("code", "evil-code");
          redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
          response.writeHead(302, { location: redirect.toString() });
          response.end();
          return;
        }
        if (request.method === "POST" && url.pathname === "/token") {
          state.hits.token += 1;
          const produced = tokenFor(signClaims, state);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(typeof produced === "string" ? produced : JSON.stringify(produced));
          return;
        }
        if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(state.jwksText ?? JSON.stringify({ keys: [{ kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e }] }));
          return;
        }
        response.writeHead(404);
        response.end();
      });
    });
    return { server, state, jwk };
  }

  function claimsFor(iss, nonce, over = {}) {
    const now = Math.floor(Date.now() / 1_000);
    return { iss, sub: "dev-customer-1", aud: clientId, exp: now + 300, iat: now, nonce, ...over };
  }

  const atHashOf = (accessToken) =>
    createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url");

  // Spins up the evil issuer plus a BFF configured against it, drives a full
  // login, and returns the callback response.
  async function driveEvilFlow(tokenFor, decorate, mutateCallback) {
    const { server, state, jwk } = makeEvilIssuer(tokenFor);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const evilBase = `http://127.0.0.1:${server.address().port}`;
    state.iss = evilBase;
    if (decorate) decorate(state, jwk, evilBase);
    const config = loadServerConfig({
      MINIAPP_ALLOW_DEV_LOGIN: "true",
      MINIAPP_ALLOWED_ORIGINS: origin,
      MINIAPP_OIDC_ISSUER_URL: evilBase,
      MINIAPP_OIDC_CLIENT_ID: clientId,
    });
    const bff = createMiniappServer(config, { clock: () => Date.now() });
    const base = await listen(bff);
    try {
      const login = await fetch(`${base}/bff/auth/login`, { redirect: "manual" });
      const tx = setCookies(login, "solidchange_ma_oidc_tx")[0].split(";")[0];
      const granted = await fetch(new URL(login.headers.get("location") ?? ""), { redirect: "manual" });
      const callback = new URL(granted.headers.get("location") ?? "");
      if (mutateCallback) mutateCallback(callback);
      return await fetch(`${base}${callback.pathname}${callback.search}`, {
        redirect: "manual",
        headers: { cookie: tx },
      });
    } finally {
      await closeServer(bff);
      await closeServer(server);
    }
  }

  const expectFailed = (response) => {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${origin}/?error=auth_failed`);
    assert.equal(setCookies(response, "solidchange_ma_session").length, 0);
  };

  // Signs `claims` under a second, unadvertised key — the JWKS document keeps
  // naming the honest `kid: "evil"` key, so the signature cannot verify.
  function foreignSigned(claims, kid = "evil") {
    const { privateKey: foreignKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(foreignKey, "base64url");
    return `${header}.${payload}.${signature}`;
  }

  test("hostile token responses fail closed on the wired path", async () => {
    const cases = {
      at_hash_absent: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce)),
      }),
      at_hash_wrong: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, { at_hash: "AAAA" })),
      }),
      token_type_mac: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "MAC",
        id_token: signClaims(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      nonce_mismatch: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, "foreign-nonce", { at_hash: atHashOf("sat_evil") })),
      }),
      iss_mismatch: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(`${state.iss}/`, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      aud_foreign: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, {
          aud: "other-client",
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      azp_foreign: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, {
          aud: [clientId, "other"],
          azp: "other",
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      exp_expired: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, {
          exp: Math.floor(Date.now() / 1_000) - 1,
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      iat_future: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, {
          iat: Math.floor(Date.now() / 1_000) + 3_600,
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      nbf_future: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, {
          nbf: Math.floor(Date.now() / 1_000) + 3_600,
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      sub_absent: (signClaims, state) => {
        const { sub: _sub, ...rest } = claimsFor(state.iss, state.nonce, {
          at_hash: atHashOf("sat_evil"),
        });
        return { access_token: "sat_evil", token_type: "Bearer", id_token: signClaims(rest) };
      },
      exp_absent: (signClaims, state) => {
        const { exp: _exp, ...rest } = claimsFor(state.iss, state.nonce, {
          at_hash: atHashOf("sat_evil"),
        });
        return { access_token: "sat_evil", token_type: "Bearer", id_token: signClaims(rest) };
      },
      iat_absent: (signClaims, state) => {
        const { iat: _iat, ...rest } = claimsFor(state.iss, state.nonce, {
          at_hash: atHashOf("sat_evil"),
        });
        return { access_token: "sat_evil", token_type: "Bearer", id_token: signClaims(rest) };
      },
      // A well-formed token signed under a key the JWKS never advertises:
      // skipping the signature check would mint a session here.
      bad_signature: (_signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: foreignSigned(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      // Non-RS256 alg in the protected header — the signature itself is a
      // valid RS256 one, so only the header pin refuses it.
      header_alg_hs256: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }), { alg: "HS256" }),
      }),
      // A key-carrying header must be refused before signature verification.
      header_jwk: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }), {
          jwk: { kty: "RSA", n: "00", e: "AQAB" },
        }),
      }),
      // Duplicate members inside the token RESPONSE body: a last-wins JSON
      // parse takes the second (honest) id_token — only the duplicate-member
      // guard refuses it.
      token_response_dup_member: (signClaims, state) => JSON.stringify({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: "garbage",
      }).replace(/}$/, `,"id_token":${JSON.stringify(signClaims(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })))}}`),
    };
    for (const [name, tokenFor] of Object.entries(cases)) {
      try {
        expectFailed(await driveEvilFlow(tokenFor));
      } catch (cause) {
        throw new Error(`${name}: ${cause}`);
      }
    }
  });

  test("a duplicate-member JWKS document fails closed", async () => {
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    });
    const response = await driveEvilFlow(tokenFor, (state, jwk) => {
      // `e` duplicated — a naive last-wins parse takes AQAB and verifies.
      state.jwksText = `{"keys":[{"kty":"RSA","kid":"evil","e":"AQ","e":"${jwk.e}","n":"${jwk.n}","use":"sig"}]}`;
    });
    expectFailed(response);
  });

  test("hostile JWKS documents fail closed on the wired path", async () => {
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    });
    const keyEntry = (jwk, over = {}) =>
      JSON.stringify({ kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e, ...over });
    const cases = {
      // Two entries under one kid — key selection must be unambiguous.
      dup_kid: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk)},${keyEntry(jwk)}]}`;
      },
      use_enc: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { use: "enc" })}]}`;
      },
      alg_hs256: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { alg: "HS256" })}]}`;
      },
      // A key carrying private material must never be accepted from JWKS.
      private_member: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { d: "000000" })}]}`;
      },
      wrong_key_ops: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { key_ops: ["sign"] })}]}`;
      },
      // A 1024-bit modulus — under the floor every real verifier enforces.
      rsa_1024: (state, _jwk, _base, tokenForInner) => {
        const small = generateKeyPairSync("rsa", { modulusLength: 1024 });
        const smallJwk = small.publicKey.export({ format: "jwk" });
        state.jwksText = `{"keys":[${keyEntry(smallJwk)}]}`;
        state.signWith = small.privateKey;
      },
      // e = 1: the PKCS#1 v1.5 encoded message is its own signature.
      exponent_1: (state, jwk) => {
        state.jwksText = `{"keys":[{"kty":"RSA","kid":"evil","e":"AQ","n":"${jwk.n}","use":"sig"}]}`;
        state.exponentOne = true;
      },
    };
    for (const [name, decorate] of Object.entries(cases)) {
      try {
        const signing = (signClaims, state) => {
          if (state.exponentOne) {
            const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "evil" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify(
              claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }),
            )).toString("base64url");
            const digestInfo = Buffer.concat([
              Buffer.from("3031300d060960864801650304020105000420", "hex"),
              createHash("sha256").update(`${head}.${payload}`).digest(),
            ]);
            const modulusBytes = Buffer.from(state.jwkN, "base64url").byteLength;
            const em = Buffer.concat([
              Buffer.from([0, 1]),
              Buffer.alloc(modulusBytes - 3 - digestInfo.length, 0xff),
              Buffer.from([0]),
              digestInfo,
            ]);
            return {
              access_token: "sat_evil",
              token_type: "Bearer",
              id_token: `${head}.${payload}.${em.toString("base64url")}`,
            };
          }
          if (state.signWith) {
            const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "evil" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify(
              claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }),
            )).toString("base64url");
            const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(state.signWith, "base64url");
            return { access_token: "sat_evil", token_type: "Bearer", id_token: `${head}.${payload}.${signature}` };
          }
          return tokenFor(signClaims, state);
        };
        const response = await driveEvilFlow(signing, (state, jwk) => {
          state.jwkN = jwk.n;
          decorate(state, jwk);
        });
        expectFailed(response);
      } catch (cause) {
        throw new Error(`${name}: ${cause}`);
      }
    }
  });

  test("kid must select the verification key, not just any advertised key", async () => {
    // JWKS advertises two keys. Two directions must both fail: a token naming
    // kid "evil" signed by the second key (a verifier that tries every
    // advertised key admits it), and a token naming kid "other" signed by the
    // first key (a verifier that takes the first key ignoring kid admits it).
    const twoKeyDecorate = (state, jwk) => {
      const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
      state.keyB = second.privateKey;
      const jwkB = second.publicKey.export({ format: "jwk" });
      state.jwksText = JSON.stringify({ keys: [
        { kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e },
        { kty: "RSA", kid: "other", use: "sig", alg: "RS256", n: jwkB.n, e: jwkB.e },
      ]});
    };
    const forged = (kid, signWith) => (_signClaims, state) => {
      const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(
        claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }),
      )).toString("base64url");
      const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(signWith(state), "base64url");
      return { access_token: "sat_evil", token_type: "Bearer", id_token: `${head}.${payload}.${signature}` };
    };
    expectFailed(await driveEvilFlow(
      forged("evil", (state) => state.keyB),
      twoKeyDecorate,
    ));
    expectFailed(await driveEvilFlow(
      forged("other", (state) => state.keyA),
      (state) => {
        const first = generateKeyPairSync("rsa", { modulusLength: 2048 });
        state.keyA = first.privateKey;
        const jwkA = first.publicKey.export({ format: "jwk" });
        const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const jwkB = second.publicKey.export({ format: "jwk" });
        state.jwksText = JSON.stringify({ keys: [
          { kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwkA.n, e: jwkA.e },
          { kty: "RSA", kid: "other", use: "sig", alg: "RS256", n: jwkB.n, e: jwkB.e },
        ]});
      },
    ));
  });

  test("an honest forged token still mints a session for its own sub only", async () => {
    const response = await driveEvilFlow((signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(claimsFor(state.iss, state.nonce, {
        sub: "odd chars ~!@#$%^&*()",
        at_hash: atHashOf("sat_evil"),
      })),
    }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), origin);
    const session = setCookies(response, "solidchange_ma_session")[0];
    assert.ok(session, "session cookie expected");
  });

  test("the error parameter wins over a valid code without an exchange", async () => {
    let seen;
    const response = await driveEvilFlow(
      (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(claimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      (state) => {
        seen = state;
      },
      (callback) => {
        callback.searchParams.set("error", "access_denied");
      },
    );
    expectFailed(response);
    // The error branch runs before the code is traded: no token request.
    assert.equal(seen.hits.token, 0);
  });
});

describe("oidc wiring edges (wave-65)", () => {
  test("unconfigured auth routes are byte-identical to unknown routes", async () => {
    const config = loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" });
    const isolated = createMiniappServer(config, { clock: () => now });
    const base = await listen(isolated);
    try {
      for (const path of ["/bff/auth/login", "/bff/auth/callback?code=x&state=y"]) {
        const auth = await fetch(`${base}${path}`, { redirect: "manual" });
        const unknown = await fetch(`${base}/bff/no-such-route`, { redirect: "manual" });
        assert.equal(auth.status, 404, path);
        assert.equal(await auth.text(), await unknown.text(), path);
      }
    } finally {
      await closeServer(isolated);
    }
  });

  test("callback guards: duplicate params, device header, error reflection", async () => {
    const { tx } = await loginStart();
    const duplicate = await fetch(`${miniappBase}/bff/auth/callback?code=a&code=b&state=s`, {
      redirect: "manual",
      headers: { cookie: tx },
    });
    assert.equal(duplicate.headers.get("location"), `${origin}/?error=auth_failed`);
    const device = await fetch(`${miniappBase}/bff/auth/callback?code=a&state=s`, {
      redirect: "manual",
      headers: { cookie: tx, "x-device-id": "a5f8c1d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d" },
    });
    assert.equal(device.status, 400);
    const injected = await fetch(
      `${miniappBase}/bff/auth/callback?error=${encodeURIComponent("\r\nx-injected: y")}&state=s`,
      { redirect: "manual", headers: { cookie: tx } },
    );
    assert.equal(injected.headers.get("location"), `${origin}/?error=auth_failed`);
  });

  test("the transaction cookie is scoped to the auth subtree", async () => {
    const { tx } = await loginStart();
    const login = await fetch(`${miniappBase}/bff/auth/login`, { redirect: "manual" });
    const raw = setCookies(login, "solidchange_ma_oidc_tx")[0];
    assert.match(raw, /Path=\/bff\/auth/);
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /SameSite=Lax/);
    assert.ok(tx);
  });

  test("login keeps working for cross-site fetches by design", async () => {
    const login = await fetch(`${miniappBase}/bff/auth/login`, {
      redirect: "manual",
      headers: { "sec-fetch-site": "cross-site" },
    });
    assert.equal(login.status, 302);
    assert.equal(new URL(login.headers.get("location") ?? "").pathname, "/authorize");
  });

  test("concurrent callbacks race for a single pending entry", async () => {
    const { authorize, tx } = await loginStart();
    const callback = await issuerGrant(authorize);
    const [first, second] = await Promise.all([
      callbackOf(callback, tx),
      callbackOf(callback, tx),
    ]);
    const locations = [
      first.headers.get("location"),
      second.headers.get("location"),
    ].sort();
    assert.deepEqual(locations, [`${origin}/?error=auth_failed`, origin].sort());
  });

  test("the issuer mount answers no non-issuer paths", async () => {
    for (const [method, url] of [
      ["GET", "/"],
      ["GET", "/favicon.ico"],
      ["POST", "/unrelated"],
      ["GET", "/login"],
      ["GET", "/admin/token"],
    ]) {
      const reply = await issuer.handle({ method, url });
      assert.equal(reply.status, 404, `${method} ${url}`);
    }
    for (const [method, url] of [
      ["PUT", "/token"],
      ["DELETE", "/authorize"],
      ["PATCH", "/.well-known/jwks.json"],
    ]) {
      const reply = await issuer.handle({ method, url });
      assert.equal(reply.status, 405, `${method} ${url}`);
    }
    // Absolute-form naming a foreign authority is refused end-to-end.
    const { authorize, tx } = await loginStart();
    const callback = await issuerGrant(authorize);
    const code = callback.searchParams.get("code");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/bff/auth/callback`,
      client_id: clientId,
      code_verifier: "v".repeat(64),
    }).toString();
    const port = issuerServer.address().port;
    const reply = await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "http://evil.example/token",
        agent: false,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
        },
      }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end(body);
    });
    assert.equal(reply.status, 404);
    assert.ok(tx);
  });
});

// The issuer simulator is product code too: the arm asserts its own contract
// directly — authorize-side guards, token-side binding, bounded pending map,
// minted-token contents (verified against the LIVE JWKS, not just decoded),
// discovery documents and the idTokenClaims constructor bounds.
describe("oidc issuer contract (wave-71)", () => {
  const callbackUri = `${origin}/bff/auth/callback`;
  const challengeOf = (verifier) => createHash("sha256").update(verifier).digest("base64url");

  async function authorizeReply(over = {}, extra = "") {
    const verifier = "v".repeat(64);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callbackUri,
      scope: "openid",
      state: "st",
      nonce: "nn",
      code_challenge: challengeOf(verifier),
      code_challenge_method: "S256",
      ...over,
    });
    const reply = await issuer.handle({ method: "GET", url: `/authorize?${params}${extra}` });
    return { reply, verifier };
  }

  async function grantCode(over = {}) {
    const { reply, verifier } = await authorizeReply(over);
    assert.equal(reply.status, 302);
    const location = new URL(reply.headers.location);
    const code = location.searchParams.get("code");
    assert.ok(code);
    return { code, verifier, location };
  }

  async function exchange(body, contentType = "application/x-www-form-urlencoded") {
    return issuer.handle({
      method: "POST",
      url: "/token",
      headers: { "content-type": contentType },
      body,
    });
  }

  async function exchangeCode(code, verifier, over = {}) {
    return exchange(new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUri,
      client_id: clientId,
      code_verifier: verifier,
      ...over,
    }).toString());
  }

  test("an expired authorization code cannot be exchanged", async () => {
    // Straight at /token: past the code TTL the grant itself must be
    // invalid_grant — driving the full BFF flow would let the id_token's
    // iat/exp checks mask a broken code-expiry check.
    const { code, verifier } = await grantCode();
    now += 121_000;
    try {
      const reply = await exchangeCode(code, verifier);
      assert.equal(reply.status, 400);
      assert.equal(JSON.parse(reply.body).error, "invalid_grant");
    } finally {
      now -= 121_000;
    }
  });

  test("the token endpoint binds code, verifier, redirect_uri and client_id", async () => {
    const errorOf = async (reply) => JSON.parse(reply.body).error;

    // Wrong PKCE verifier: challenge was minted for "v"*64, not "w"*64.
    {
      const { code } = await grantCode();
      const reply = await exchangeCode(code, "w".repeat(64));
      assert.equal(reply.status, 400);
      assert.equal(await errorOf(reply), "invalid_grant");
    }
    // Wrong redirect_uri at exchange time.
    {
      const { code, verifier } = await grantCode();
      const reply = await exchangeCode(code, verifier, { redirect_uri: `${origin}/bff/auth/other` });
      assert.equal(reply.status, 400);
      assert.equal(await errorOf(reply), "invalid_grant");
    }
    // Wrong client_id at exchange time.
    {
      const { code, verifier } = await grantCode();
      const reply = await exchangeCode(code, verifier, { client_id: "other-client" });
      assert.equal(reply.status, 400);
      assert.equal(await errorOf(reply), "invalid_grant");
    }
    // A duplicated code parameter is an invalid request, not an ambiguous one.
    {
      const { code, verifier } = await grantCode();
      const reply = await exchange(
        `grant_type=authorization_code&code=${code}&code=${code}` +
        `&redirect_uri=${encodeURIComponent(callbackUri)}&client_id=${clientId}&code_verifier=${verifier}`,
      );
      assert.equal(reply.status, 400);
      assert.equal(await errorOf(reply), "invalid_request");
    }
    // Non-form content types and oversized bodies are refused before parsing.
    {
      const { code, verifier } = await grantCode();
      const reply = await exchange(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUri,
          client_id: clientId,
          code_verifier: verifier,
        }).toString(),
        "application/json",
      );
      assert.equal(reply.status, 400);
      assert.equal(await errorOf(reply), "invalid_request");
    }
    {
      const { code, verifier } = await grantCode();
      const reply = await exchange(
        `grant_type=authorization_code&code=${code}` +
        `&redirect_uri=${encodeURIComponent(callbackUri)}&client_id=${clientId}` +
        `&code_verifier=${verifier}&pad=${"p".repeat(9 * 1024)}`,
      );
      assert.equal(reply.status, 400);
      assert.equal(await errorOf(reply), "invalid_request");
    }
    // A non-code grant is a vocabulary error, not a silent fallback.
    {
      const reply = await exchange(
        "grant_type=password&username=u&password=p",
      );
      assert.equal(reply.status, 400);
      assert.equal(await errorOf(reply), "unsupported_grant_type");
    }
  });

  test("the authorize endpoint enforces client, redirect registry and PKCE", async () => {
    // A foreign client is refused outright — no redirect, JSON error.
    {
      const { reply } = await authorizeReply({ client_id: "other-client" });
      assert.equal(reply.status, 400);
      assert.equal(JSON.parse(reply.body).error, "unauthorized_client");
      assert.equal(reply.headers.location, undefined);
    }
    // An unregistered redirect_uri is refused outright — never redirected to.
    {
      const { reply } = await authorizeReply({ redirect_uri: `${origin}/bff/auth/other` });
      assert.equal(reply.status, 400);
      assert.equal(JSON.parse(reply.body).error, "invalid_request");
      assert.equal(reply.headers.location, undefined);
    }
    // response_type, scope and PKCE failures redirect back with the error and
    // the (bounded) state echoed.
    for (const [name, over, error] of [
      ["response_type", { response_type: "token" }, "unsupported_response_type"],
      ["scope", { scope: "profile" }, "invalid_scope"],
      ["challenge_method", { code_challenge_method: "plain" }, "invalid_request"],
      ["challenge_short", { code_challenge: "short" }, "invalid_request"],
      ["nonce_long", { nonce: "n".repeat(129) }, "invalid_request"],
    ]) {
      const { reply } = await authorizeReply(over);
      assert.equal(reply.status, 302, name);
      const location = new URL(reply.headers.location);
      assert.equal(location.origin + location.pathname, callbackUri, name);
      assert.equal(location.searchParams.get("error"), error, name);
      assert.equal(location.searchParams.get("state"), "st", name);
      assert.equal(location.searchParams.get("code"), null, name);
    }
    // An over-long state fails closed and is NOT reflected into the redirect.
    {
      const { reply } = await authorizeReply({ state: "s".repeat(129) });
      assert.equal(reply.status, 302);
      const location = new URL(reply.headers.location);
      assert.equal(location.searchParams.get("error"), "invalid_request");
      assert.equal(location.searchParams.get("state"), null);
    }
    // A duplicated parameter is a 400 JSON error, not a redirect.
    {
      const { reply } = await authorizeReply({}, "&state=one&state=two");
      assert.equal(reply.status, 400);
      assert.equal(JSON.parse(reply.body).error, "invalid_request");
    }
    // The state boundary itself: exactly 128 characters is still valid.
    {
      const { reply } = await authorizeReply({ state: "s".repeat(128) });
      assert.equal(reply.status, 302);
      const location = new URL(reply.headers.location);
      assert.ok(location.searchParams.get("code"));
      assert.equal(location.searchParams.get("state"), "s".repeat(128));
    }
  });

  test("the pending-code map evicts the oldest entry at the bound", async () => {
    const minted = [];
    for (let index = 0; index <= OIDC_MAX_PENDING_CODES; index += 1) {
      minted.push(await grantCode({ state: `s${index}` }));
    }
    // Oldest-first eviction: entry 0 is gone, every later entry redeems.
    const evicted = await exchangeCode(minted[0].code, minted[0].verifier);
    assert.equal(evicted.status, 400);
    assert.equal(JSON.parse(evicted.body).error, "invalid_grant");
    for (const index of [1, minted.length - 1]) {
      const reply = await exchangeCode(minted[index].code, minted[index].verifier);
      assert.equal(reply.status, 200, `entry ${index} should survive`);
    }
  });

  test("the minted id_token is signed, bound and self-consistent", async () => {
    const { code, verifier } = await grantCode({ login_hint: "alt-user-2" });
    const reply = await exchangeCode(code, verifier);
    assert.equal(reply.status, 200);
    const body = JSON.parse(reply.body);
    assert.equal(body.token_type, "Bearer");
    assert.equal(body.scope, "openid");
    assert.equal(body.expires_in, 300);
    const [head, payload, signature] = body.id_token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    // The signature verifies against the LIVE JWKS document the BFF fetches.
    const jwks = JSON.parse(
      (await issuer.handle({ method: "GET", url: "/.well-known/jwks.json" })).body,
    );
    assert.equal(jwks.keys.length, 1);
    const key = jwks.keys[0];
    assert.equal(key.kid, issuer.keyId);
    assert.equal(key.kty, "RSA");
    assert.equal(key.use, "sig");
    assert.equal(key.alg, "RS256");
    assert.equal(
      verify(
        "RSA-SHA256",
        Buffer.from(`${head}.${payload}`),
        createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" }),
        Buffer.from(signature, "base64url"),
      ),
      true,
    );

    // Claims bind this transaction: issuer, client, hint-derived sub, the
    // authorize-time nonce, the TTL pair and at_hash over the access token.
    assert.equal(JSON.parse(Buffer.from(head, "base64url").toString("utf8")).alg, "RS256");
    assert.equal(claims.iss, issuerBase);
    assert.equal(claims.aud, clientId);
    assert.equal(claims.sub, "alt-user-2");
    assert.equal(claims.nonce, "nn");
    assert.equal(claims.exp - claims.iat, 300);
    assert.equal(
      claims.at_hash,
      createHash("sha256").update(body.access_token).digest().subarray(0, 16).toString("base64url"),
    );

    // A login_hint outside the subject grammar falls back to the default.
    const fallback = await grantCode({ login_hint: "Bad User!" });
    const fallbackReply = await exchangeCode(fallback.code, fallback.verifier);
    const fallbackClaims = JSON.parse(
      Buffer.from(JSON.parse(fallbackReply.body).id_token.split(".")[1], "base64url").toString("utf8"),
    );
    assert.equal(fallbackClaims.sub, "dev-customer-1");
  });

  test("the discovery document and idTokenClaims bounds hold", async () => {
    const meta = await issuer.handle({ method: "GET", url: "/.well-known/openid-configuration" });
    assert.equal(meta.status, 200);
    const doc = JSON.parse(meta.body);
    assert.equal(doc.issuer, issuerBase);
    assert.equal(doc.authorization_endpoint, `${issuerBase}/authorize`);
    assert.equal(doc.token_endpoint, `${issuerBase}/token`);
    assert.equal(doc.jwks_uri, `${issuerBase}/.well-known/jwks.json`);
    assert.equal(doc.environment, "dev-simulator");
    assert.deepEqual(doc.response_types_supported, ["code"]);
    assert.deepEqual(doc.grant_types_supported, ["authorization_code"]);
    assert.deepEqual(doc.subject_types_supported, ["public"]);
    assert.deepEqual(doc.id_token_signing_alg_values_supported, ["RS256"]);
    assert.deepEqual(doc.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(doc.token_endpoint_auth_methods_supported, ["none"]);

    const base = { issuer: issuerBase, clientId, redirectUris: [callbackUri] };
    // Reserved claims cannot be overridden.
    assert.throws(
      () => createOidcIssuer({ ...base, idTokenClaims: { sub: "x" } }),
      TypeError,
    );
    // Claims past the 4096-byte bound are refused — the bound itself holds.
    const padFor = (total) => "x".repeat(total - JSON.stringify({ pad: "" }).length);
    assert.throws(
      () => createOidcIssuer({ ...base, idTokenClaims: { pad: padFor(4_097) } }),
      TypeError,
    );
    assert.ok(createOidcIssuer({ ...base, idTokenClaims: { pad: padFor(4_096) } }));
    // Non-JSON values (functions, deep nesting) are refused.
    assert.throws(
      () => createOidcIssuer({ ...base, idTokenClaims: { fn: () => 1 } }),
      TypeError,
    );
    let deep = { v: 1 };
    for (let index = 0; index < 10; index += 1) deep = { v: deep };
    assert.throws(
      () => createOidcIssuer({ ...base, idTokenClaims: deep }),
      TypeError,
    );
    // A non-object claims argument is refused.
    assert.throws(
      () => createOidcIssuer({ ...base, idTokenClaims: ["groups"] }),
      TypeError,
    );
  });
});

// Flow-binding pins: every callback input is bound to the transaction the BFF
// opened — state, tx-cookie nonce, single-use code and pending entry, the
// pending store's TTL and caps — and the session contract after minting
// (rotation, preservation on failure, hardened cookie flags).
describe("oidc flow binding and session contract (wave-71)", () => {
  const expectFailed = (response) => {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${origin}/?error=auth_failed`);
    assert.equal(setCookies(response, "solidchange_ma_session").length, 0);
  };

  test("the tx-cookie nonce binds the pending entry", async () => {
    const { authorize, tx } = await loginStart();
    const state = authorize.searchParams.get("state");
    const callback = await issuerGrant(authorize);
    // Same state, forged nonce — the pending entry never verifies.
    expectFailed(await callbackOf(callback, `solidchange_ma_oidc_tx=${state}.forged`));
    // The presented state was already consumed: even the real cookie fails now.
    expectFailed(await callbackOf(callback, tx));
  });

  test("duplicate or empty code/state fail even when the real value is present", async () => {
    // codes[0] is the REAL code — a first-element shortcut would redeem it.
    {
      const { authorize, tx } = await loginStart();
      const callback = await issuerGrant(authorize);
      callback.searchParams.append("code", "extra");
      expectFailed(await callbackOf(callback, tx));
    }
    // states[0] is the REAL state.
    {
      const { authorize, tx } = await loginStart();
      const callback = await issuerGrant(authorize);
      callback.searchParams.append("state", "extra");
      expectFailed(await callbackOf(callback, tx));
    }
    // An empty code is not a code.
    {
      const { authorize, tx } = await loginStart();
      const callback = await issuerGrant(authorize);
      callback.searchParams.set("code", "");
      expectFailed(await callbackOf(callback, tx));
    }
  });

  test("the error parameter wins over a valid code", async () => {
    const { authorize, tx } = await loginStart();
    const callback = await issuerGrant(authorize);
    callback.searchParams.set("error", "access_denied");
    expectFailed(await callbackOf(callback, tx));
  });

  test("chained logins keep only the newest pending entries per initiator", async () => {
    // Every tx-presented login chains onto the same initiator; the per-
    // initiator bound is 2, so the third chained login evicts the first.
    const a = await loginStart();
    const b = await fetch(`${miniappBase}/bff/auth/login`, {
      redirect: "manual",
      headers: { cookie: a.tx },
    });
    assert.equal(b.status, 302);
    const bTx = setCookies(b, "solidchange_ma_oidc_tx")[0].split(";")[0];
    const bAuthorize = new URL(b.headers.get("location"));
    const c = await fetch(`${miniappBase}/bff/auth/login`, {
      redirect: "manual",
      headers: { cookie: bTx },
    });
    assert.equal(c.status, 302);
    const cTx = setCookies(c, "solidchange_ma_oidc_tx")[0].split(";")[0];
    const cAuthorize = new URL(c.headers.get("location"));

    expectFailed(await callbackOf(await issuerGrant(a.authorize), a.tx));
    assert.equal(
      (await callbackOf(await issuerGrant(bAuthorize), bTx)).headers.get("location"),
      origin,
    );
    assert.equal(
      (await callbackOf(await issuerGrant(cAuthorize), cTx)).headers.get("location"),
      origin,
    );
  });

  test("the pending-login map evicts the oldest entry at the global bound", async () => {
    // The BFF bound is 256 outstanding logins; cookieless logins each open a
    // fresh initiator chain, so the first is evicted once 256 more arrive.
    const first = await loginStart();
    for (let index = 0; index < 256; index += 1) {
      const mid = await fetch(`${miniappBase}/bff/auth/login`, { redirect: "manual" });
      assert.equal(mid.status, 302);
    }
    const last = await loginStart();
    expectFailed(await callbackOf(await issuerGrant(first.authorize), first.tx));
    assert.equal(
      (await callbackOf(await issuerGrant(last.authorize), last.tx)).headers.get("location"),
      origin,
    );
  });

  test("a stale pending login fails closed past the transaction TTL", async () => {
    const { authorize, tx } = await loginStart();
    // Past the 600 s transaction TTL the pending entry is gone; the issuer
    // code itself is minted fresh and still valid.
    now += 601_000;
    try {
      const callback = await issuerGrant(authorize);
      expectFailed(await callbackOf(callback, tx));
    } finally {
      now -= 601_000;
    }
  });

  test("a completed login kills the previously presented session", async () => {
    const first = await loginStart();
    const firstResponse = await callbackOf(await issuerGrant(first.authorize), first.tx);
    assert.equal(firstResponse.headers.get("location"), origin);
    const sessionA = setCookies(firstResponse, "solidchange_ma_session")[0].split(";")[0];
    assert.ok(sessionA);

    const second = await loginStart();
    const secondResponse = await callbackOf(
      await issuerGrant(second.authorize),
      `${second.tx}; ${sessionA}`,
    );
    assert.equal(secondResponse.headers.get("location"), origin);

    const view = await fetch(`${miniappBase}/bff/session`, {
      headers: { cookie: sessionA },
    });
    assert.equal(view.status, 401);
  });

  test("a failed callback preserves the existing session", async () => {
    const first = await loginStart();
    const firstResponse = await callbackOf(await issuerGrant(first.authorize), first.tx);
    const sessionA = setCookies(firstResponse, "solidchange_ma_session")[0].split(";")[0];
    assert.ok(sessionA);

    // Second flow dies at the token exchange (expired code): the session the
    // browser presented must survive the failure untouched.
    const { authorize, tx } = await loginStart();
    const callback = await issuerGrant(authorize);
    now += 121_000;
    try {
      expectFailed(await callbackOf(callback, `${tx}; ${sessionA}`));
    } finally {
      now -= 121_000;
    }
    const view = await fetch(`${miniappBase}/bff/session`, {
      headers: { cookie: sessionA },
    }).then((response) => response.json());
    assert.equal(view.authenticated, true);
  });

  test("the minted session carries the derived pseudonymous subject", async () => {
    const { authorize, tx } = await loginStart();
    const response = await callbackOf(await issuerGrant(authorize), tx);
    const session = setCookies(response, "solidchange_ma_session")[0].split(";")[0];
    // The issuer minted the default subject; the session must carry the
    // pseudonymous derivation, never the raw sub.
    const expected =
      `dev-${createHash("sha256").update("solidchange-miniapp-oidc|dev-customer-1")
        .digest("hex").slice(0, 16)}`;
    const view = await fetch(`${miniappBase}/bff/session`, {
      headers: { cookie: session },
    }).then((reply) => reply.json());
    assert.equal(view.authenticated, true);
    assert.equal(view.customerRef, `SC-DEV-${expected.slice(-5).toUpperCase()}`);
    assert.notEqual(view.customerRef.includes("CUSTOMER-1"), true);
  });

  test("the minted session cookie is hardened and the transaction cookie cleared", async () => {
    const { authorize, tx } = await loginStart();
    const response = await callbackOf(await issuerGrant(authorize), tx);
    const session = setCookies(response, "solidchange_ma_session")[0];
    assert.ok(session);
    assert.match(session, /HttpOnly/);
    assert.match(session, /SameSite=Strict/);
    assert.match(session, /Path=\/bff/);
    assert.match(session, /Max-Age=\d+/);
    const cleared = setCookies(response, "solidchange_ma_oidc_tx")[0];
    assert.ok(cleared, "the tx cookie must be cleared on success");
    assert.match(cleared, /^solidchange_ma_oidc_tx=;/);
    assert.match(cleared, /Max-Age=0/);
  });
});

// Backoffice arm: the same authorization-code + PKCE flow for operator SSO —
// the env-pair-configured BFF mints a SessionStore session for the
// pseudonymized `syn_oper_*` principal derived from `sub`, and every step
// failure collapses to the generic `?error=auth_failed` redirect.

const boOrigin = "http://127.0.0.1:4173";
const boClientId = "solidchange-backoffice";
const boSubject = "operator-42";

let boNow;
let boIssuer;
let boIssuerBase;
let boIssuerServer;
let backoffice;
let backofficeBase;

async function boLoginStart() {
  const response = await fetch(`${backofficeBase}/bff/auth/login`, { redirect: "manual" });
  assert.equal(response.status, 302);
  const authorize = new URL(response.headers.get("location") ?? "");
  assert.equal(authorize.origin + authorize.pathname, `${boIssuerBase}/authorize`);
  const tx = setCookies(response, "solidchange_bo_oidc_transaction")[0];
  assert.ok(tx, "transaction cookie expected");
  return { authorize, tx: tx.split(";")[0] };
}

async function boCallbackOf(callbackUrl, tx, headers = {}) {
  return fetch(`${backofficeBase}${callbackUrl.pathname}${callbackUrl.search}`, {
    redirect: "manual",
    headers: { cookie: tx, ...headers },
  });
}

// Loads a BFF config through real env vars, restoring process env afterwards.
async function backofficeEnv(overrides, fn) {
  const keys = [
    "BACKOFFICE_ALLOWED_ORIGINS",
    "BACKOFFICE_OIDC_ISSUER_URL",
    "BACKOFFICE_OIDC_CLIENT_ID",
    "BACKOFFICE_OIDC_ROLE_MAP_JSON",
    "BACKOFFICE_DEVICE_BINDING",
    "BACKOFFICE_APPROVED_DEVICE_DIGESTS",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe("backoffice oidc operator login", () => {
  before(async () => {
    boNow = Date.now();
    boIssuerServer = createServer();
    await new Promise((resolve) => boIssuerServer.listen(0, "127.0.0.1", resolve));
    boIssuerBase = `http://127.0.0.1:${boIssuerServer.address().port}`;
    boIssuer = createOidcIssuer({
      issuer: boIssuerBase,
      clientId: boClientId,
      redirectUris: [`${boOrigin}/bff/auth/callback`],
      defaultSubject: boSubject,
      idTokenClaims: {
        groups: ["compliance"],
        email: "operator@example.test",
        name: "Dev Operator",
      },
      clock: { now: () => Math.floor(boNow / 1000) },
    });
    boIssuerServer.on("request", (request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        void boIssuer
          .handle({
            method: request.method ?? "GET",
            url: request.url ?? "/",
            headers: request.headers,
            body: body || undefined,
          })
          .then((reply) => {
            response.writeHead(reply.status, { ...reply.headers });
            response.end(reply.body);
          });
      });
    });

    const saved = {
      BACKOFFICE_ALLOWED_ORIGINS: process.env.BACKOFFICE_ALLOWED_ORIGINS,
      BACKOFFICE_OIDC_ISSUER_URL: process.env.BACKOFFICE_OIDC_ISSUER_URL,
      BACKOFFICE_OIDC_CLIENT_ID: process.env.BACKOFFICE_OIDC_CLIENT_ID,
      BACKOFFICE_OIDC_ROLE_MAP_JSON: process.env.BACKOFFICE_OIDC_ROLE_MAP_JSON,
    };
    process.env.BACKOFFICE_ALLOWED_ORIGINS = boOrigin;
    process.env.BACKOFFICE_OIDC_ISSUER_URL = boIssuerBase;
    process.env.BACKOFFICE_OIDC_CLIENT_ID = boClientId;
    process.env.BACKOFFICE_OIDC_ROLE_MAP_JSON = JSON.stringify({ compliance: "compliance-lead" });
    let config;
    try {
      config = loadBackofficeConfig();
    } finally {
      if (saved.BACKOFFICE_ALLOWED_ORIGINS === undefined) delete process.env.BACKOFFICE_ALLOWED_ORIGINS;
      else process.env.BACKOFFICE_ALLOWED_ORIGINS = saved.BACKOFFICE_ALLOWED_ORIGINS;
      if (saved.BACKOFFICE_OIDC_ISSUER_URL === undefined) delete process.env.BACKOFFICE_OIDC_ISSUER_URL;
      else process.env.BACKOFFICE_OIDC_ISSUER_URL = saved.BACKOFFICE_OIDC_ISSUER_URL;
      if (saved.BACKOFFICE_OIDC_CLIENT_ID === undefined) delete process.env.BACKOFFICE_OIDC_CLIENT_ID;
      else process.env.BACKOFFICE_OIDC_CLIENT_ID = saved.BACKOFFICE_OIDC_CLIENT_ID;
      if (saved.BACKOFFICE_OIDC_ROLE_MAP_JSON === undefined) delete process.env.BACKOFFICE_OIDC_ROLE_MAP_JSON;
      else process.env.BACKOFFICE_OIDC_ROLE_MAP_JSON = saved.BACKOFFICE_OIDC_ROLE_MAP_JSON;
    }
    assert.ok(config.oidc, "BACKOFFICE_OIDC_* pair should configure OIDC");
    backoffice = createBackofficeServer(config);
    backofficeBase = await listen(backoffice);
  });

  after(async () => {
    if (backoffice) await closeServer(backoffice);
    if (boIssuerServer) await closeServer(boIssuerServer);
  });

  test("full authorization-code + PKCE flow mints an operator session", async () => {
    const { authorize, tx } = await boLoginStart();
    assert.equal(authorize.searchParams.get("response_type"), "code");
    assert.equal(authorize.searchParams.get("client_id"), boClientId);
    assert.equal(authorize.searchParams.get("redirect_uri"), `${boOrigin}/bff/auth/callback`);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorize.searchParams.get("nonce"));

    const callback = await issuerGrant(authorize);
    const response = await boCallbackOf(callback, tx, { "sec-fetch-site": "cross-site" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), boOrigin);
    const session = setCookies(response, "solidchange_bo_session")[0];
    assert.ok(session, "session cookie expected");

    const profile = await fetch(`${backofficeBase}/bff/api/session`, {
      headers: { cookie: session.split(";")[0] },
    });
    assert.equal(profile.status, 200);
    const { payload } = await profile.json();
    const expectedSubject = `syn_oper_${createHash("sha256")
      .update(`solidchange-backoffice-bff|${boSubject}`)
      .digest("hex")
      .slice(0, 24)}`;
    assert.equal(payload.operator.subject, expectedSubject);
    assert.equal(payload.operator.role, "compliance-lead");
    assert.equal(payload.operator.email, "operator@example.test");
  });

  test("issuer error, state mismatch, expired and replayed codes fail closed", async () => {
    const expectFailed = (response) => {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `${boOrigin}/?error=auth_failed`);
      assert.equal(setCookies(response, "solidchange_bo_session").length, 0);
    };

    expectFailed(
      await fetch(`${backofficeBase}/bff/auth/callback?error=access_denied&state=s`, {
        redirect: "manual",
      })
    );

    const { authorize, tx } = await boLoginStart();
    const callback = await issuerGrant(authorize);
    expectFailed(await boCallbackOf(callback, "solidchange_bo_oidc_transaction=foreign.foreign"));
    expectFailed(
      await fetch(`${backofficeBase}${callback.pathname}${callback.search}`, {
        redirect: "manual",
      })
    );

    // Expired code: the issuer clock moves past the code TTL before exchange.
    const second = await boLoginStart();
    const callbackB = await issuerGrant(second.authorize);
    boNow += 121_000;
    try {
      expectFailed(await boCallbackOf(callbackB, second.tx));
    } finally {
      boNow -= 121_000;
    }

    // Replayed: the pending entry and the issuer code are both single-use.
    const third = await boLoginStart();
    const callbackC = await issuerGrant(third.authorize);
    const first = await boCallbackOf(callbackC, third.tx);
    assert.equal(first.headers.get("location"), boOrigin);
    expectFailed(await boCallbackOf(callbackC, third.tx));
  });

  test("an unconfigured BFF has no auth routes", async () => {
    const config = loadBackofficeConfig();
    assert.equal(config.oidc, undefined);
    const isolated = createBackofficeServer(config);
    const base = await listen(isolated);
    try {
      const login = await fetch(`${base}/bff/auth/login`, { redirect: "manual" });
      assert.equal(login.status, 404);
      const callback = await fetch(`${base}/bff/auth/callback?code=c&state=s`, {
        redirect: "manual",
      });
      assert.equal(callback.status, 404);
    } finally {
      await closeServer(isolated);
    }
  });
  // The backoffice callback's binding and session contracts — the same pins as
  // the miniapp arm plus the operator-specific bits (login rejects query input,
  // dual session revocation, device-gate ordering).
  describe("flow binding and session contract (wave-71)", () => {
    const expectBoFailed = (response) => {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `${boOrigin}/?error=auth_failed`);
      assert.equal(setCookies(response, "solidchange_bo_session").length, 0);
    };

    const statusWith = async (cookie) => {
      const reply = await fetch(`${backofficeBase}/bff/auth/status`, {
        headers: { cookie },
      });
      return (await reply.json()).authenticated;
    };

    test("the tx-cookie nonce binds the pending entry", async () => {
      const { authorize, tx } = await boLoginStart();
      const state = authorize.searchParams.get("state");
      const callback = await issuerGrant(authorize);
      expectBoFailed(
        await boCallbackOf(callback, `solidchange_bo_oidc_transaction=${state}.forged`),
      );
      // The presented state was consumed by the forged attempt.
      expectBoFailed(await boCallbackOf(callback, tx));
    });

    test("duplicate or empty code/state fail even when the real value is present", async () => {
      {
        const { authorize, tx } = await boLoginStart();
        const callback = await issuerGrant(authorize);
        callback.searchParams.append("code", "extra");
        expectBoFailed(await boCallbackOf(callback, tx));
      }
      {
        const { authorize, tx } = await boLoginStart();
        const callback = await issuerGrant(authorize);
        callback.searchParams.append("state", "extra");
        expectBoFailed(await boCallbackOf(callback, tx));
      }
      {
        const { authorize, tx } = await boLoginStart();
        const callback = await issuerGrant(authorize);
        callback.searchParams.set("code", "");
        expectBoFailed(await boCallbackOf(callback, tx));
      }
    });

    test("a tampered callback state fails closed", async () => {
      const { authorize, tx } = await boLoginStart();
      const callback = await issuerGrant(authorize);
      callback.searchParams.set("state", "tampered");
      expectBoFailed(await boCallbackOf(callback, tx));
    });

    test("the login route rejects query input", async () => {
      const reply = await fetch(`${backofficeBase}/bff/auth/login?next=/`, {
        redirect: "manual",
      });
      assert.equal(reply.status, 400);
      assert.equal((await reply.json()).error, "invalid_request");
    });

    test("a stale pending login fails closed past the transaction TTL", async () => {
      // The backoffice pending store binds Date.now at construction, so expiry
      // can only be exercised on a BFF built while a fake clock is installed.
      // The issuer clock advances in step so the minted token stays valid —
      // pending expiry is the only failing guard on the path.
      const realNow = Date.now;
      let fake = realNow();
      Date.now = () => fake;
      try {
        await backofficeEnv({
          BACKOFFICE_ALLOWED_ORIGINS: boOrigin,
          BACKOFFICE_OIDC_ISSUER_URL: boIssuerBase,
          BACKOFFICE_OIDC_CLIENT_ID: boClientId,
          BACKOFFICE_OIDC_ROLE_MAP_JSON: JSON.stringify({ compliance: "compliance-lead" }),
        }, async () => {
          const bff = createBackofficeServer(loadBackofficeConfig());
          const base = await listen(bff);
          try {
            const login = await fetch(`${base}/bff/auth/login`, { redirect: "manual" });
            assert.equal(login.status, 302);
            const tx = setCookies(login, "solidchange_bo_oidc_transaction")[0].split(";")[0];
            const authorize = new URL(login.headers.get("location") ?? "");
            fake += 601_000;
            boNow += 601_000;
            try {
              const callback = await issuerGrant(authorize);
              const response = await fetch(`${base}${callback.pathname}${callback.search}`, {
                redirect: "manual",
                headers: { cookie: tx },
              });
              expectBoFailed(response);
            } finally {
              boNow -= 601_000;
            }
          } finally {
            await closeServer(bff);
          }
        });
      } finally {
        Date.now = realNow;
      }
    });

    test("an expired authorization code cannot be exchanged at the issuer", async () => {
      // Same contract as the miniapp issuer check, exercised directly against
      // boIssuer so the BFF's claim validation cannot mask a stale code.
      const verifier = "v".repeat(64);
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const authorize = await boIssuer.handle({
        method: "GET",
        url: "/authorize?" + new URLSearchParams({
          response_type: "code",
          client_id: boClientId,
          redirect_uri: `${boOrigin}/bff/auth/callback`,
          scope: "openid",
          state: "st",
          nonce: "nn",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString(),
        headers: {},
        body: undefined,
      });
      assert.equal(authorize.status, 302);
      const code = new URL(authorize.headers.location).searchParams.get("code");
      assert.ok(code);
      boNow += 121_000;
      try {
        const reply = await boIssuer.handle({
          method: "POST",
          url: "/token",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: `${boOrigin}/bff/auth/callback`,
            client_id: boClientId,
            code_verifier: verifier,
          }).toString(),
        });
        assert.equal(reply.status, 400);
        assert.equal(JSON.parse(reply.body).error, "invalid_grant");
      } finally {
        boNow -= 121_000;
      }
    });

    test("an operator login revokes the session it began with", async () => {
      const first = await boLoginStart();
      const firstResponse = await boCallbackOf(await issuerGrant(first.authorize), first.tx);
      const sessionA = setCookies(firstResponse, "solidchange_bo_session")[0].split(";")[0];
      assert.ok(sessionA);
      // Logging in while session A is live binds it into the pending entry; the
      // callback revokes it even though this callback does not present it.
      const login = await fetch(`${backofficeBase}/bff/auth/login`, {
        redirect: "manual",
        headers: { cookie: sessionA },
      });
      assert.equal(login.status, 302);
      const tx2 = setCookies(login, "solidchange_bo_oidc_transaction")[0].split(";")[0];
      const authorize2 = new URL(login.headers.get("location") ?? "");
      const response = await boCallbackOf(await issuerGrant(authorize2), tx2);
      assert.equal(response.headers.get("location"), boOrigin);
      assert.equal(await statusWith(sessionA), false);
    });

    test("an operator login revokes the session the callback presented", async () => {
      const first = await boLoginStart();
      const firstResponse = await boCallbackOf(await issuerGrant(first.authorize), first.tx);
      const sessionA = setCookies(firstResponse, "solidchange_bo_session")[0].split(";")[0];
      assert.ok(sessionA);
      // A fresh login, no session presented at login — but session A rides the
      // callback and must die with the rotation.
      const { authorize, tx } = await boLoginStart();
      const response = await boCallbackOf(
        await issuerGrant(authorize),
        `${tx}; ${sessionA}`,
      );
      assert.equal(response.headers.get("location"), boOrigin);
      assert.equal(await statusWith(sessionA), false);
    });

    test("a failed callback preserves the existing operator session", async () => {
      const first = await boLoginStart();
      const firstResponse = await boCallbackOf(await issuerGrant(first.authorize), first.tx);
      const sessionA = setCookies(firstResponse, "solidchange_bo_session")[0].split(";")[0];
      assert.ok(sessionA);
      const { authorize, tx } = await boLoginStart();
      const callback = await issuerGrant(authorize);
      // Die at the token exchange: the issuer code is stale.
      boNow += 121_000;
      try {
        expectBoFailed(await boCallbackOf(callback, `${tx}; ${sessionA}`));
      } finally {
        boNow -= 121_000;
      }
      assert.equal(await statusWith(sessionA), true);
    });

    test("chained logins keep only the newest pending entries per initiator", async () => {
      const a = await boLoginStart();
      const b = await fetch(`${backofficeBase}/bff/auth/login`, {
        redirect: "manual",
        headers: { cookie: a.tx },
      });
      assert.equal(b.status, 302);
      const bTx = setCookies(b, "solidchange_bo_oidc_transaction")[0].split(";")[0];
      const bAuthorize = new URL(b.headers.get("location") ?? "");
      const c = await fetch(`${backofficeBase}/bff/auth/login`, {
        redirect: "manual",
        headers: { cookie: bTx },
      });
      assert.equal(c.status, 302);
      const cTx = setCookies(c, "solidchange_bo_oidc_transaction")[0].split(";")[0];
      const cAuthorize = new URL(c.headers.get("location") ?? "");
      expectBoFailed(await boCallbackOf(await issuerGrant(a.authorize), a.tx));
      assert.equal(
        (await boCallbackOf(await issuerGrant(bAuthorize), bTx)).headers.get("location"),
        boOrigin,
      );
      assert.equal(
        (await boCallbackOf(await issuerGrant(cAuthorize), cTx)).headers.get("location"),
        boOrigin,
      );
    });

    test("the pending-login map evicts the oldest entry at the global bound", async () => {
      const first = await boLoginStart();
      for (let index = 0; index < 256; index += 1) {
        const mid = await fetch(`${backofficeBase}/bff/auth/login`, { redirect: "manual" });
        assert.equal(mid.status, 302);
      }
      const last = await boLoginStart();
      expectBoFailed(await boCallbackOf(await issuerGrant(first.authorize), first.tx));
      assert.equal(
        (await boCallbackOf(await issuerGrant(last.authorize), last.tx)).headers.get("location"),
        boOrigin,
      );
    });

    test("the transaction cookie is hardened and cleared on success", async () => {
      const { authorize, tx } = await boLoginStart();
      // The login response carries the pinned tx-cookie flags.
      const loginReply = await fetch(`${backofficeBase}/bff/auth/login`, { redirect: "manual" });
      const issued = setCookies(loginReply, "solidchange_bo_oidc_transaction")[0];
      assert.match(issued, /HttpOnly/);
      assert.match(issued, /SameSite=Lax/);
      assert.match(issued, /Path=\/bff\/auth/);
      assert.match(issued, /Max-Age=600/);
      const response = await boCallbackOf(await issuerGrant(authorize), tx);
      const cleared = setCookies(response, "solidchange_bo_oidc_transaction")[0];
      assert.ok(cleared, "the tx cookie must be cleared on success");
      assert.match(cleared, /^solidchange_bo_oidc_transaction=;/);
      assert.match(cleared, /Max-Age=0/);
    });

    test("the minted session cookie is hardened", async () => {
      const { authorize, tx } = await boLoginStart();
      const response = await boCallbackOf(await issuerGrant(authorize), tx);
      const session = setCookies(response, "solidchange_bo_session")[0];
      assert.ok(session);
      assert.match(session, /HttpOnly/);
      assert.match(session, /SameSite=Strict/);
      assert.match(session, /Path=\/bff/);
      assert.match(session, /Max-Age=\d+/);
    });
  });

});

describe("backoffice hostile issuer (wave-66)", () => {
  // Same fully attacker-controlled issuer as the miniapp arm, tuned to the
  // backoffice OIDC wiring: operator claims need a mappable role group, the
  // callback lands on ${boOrigin}/bff/auth/callback and the session cookie is
  // solidchange_bo_session.
  function makeBoEvilIssuer(tokenFor) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    const state = { nonce: "", jwksText: null, iss: "", hits: { token: 0 } };
    const signClaims = (claims, header = {}) => {
      const head = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT", kid: "evil", ...header })
      ).toString("base64url");
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(privateKey, "base64url");
      return `${head}.${payload}.${signature}`;
    };
    const server = createServer();
    server.on("request", (request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk.toString("utf8"); });
      request.on("end", () => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/authorize") {
          state.nonce = url.searchParams.get("nonce") ?? "";
          const redirect = new URL(`${boOrigin}/bff/auth/callback`);
          redirect.searchParams.set("code", "evil-code");
          redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
          response.writeHead(302, { location: redirect.toString() });
          response.end();
          return;
        }
        if (request.method === "POST" && url.pathname === "/token") {
          state.hits.token += 1;
          const produced = tokenFor(signClaims, state);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(typeof produced === "string" ? produced : JSON.stringify(produced));
          return;
        }
        if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(state.jwksText ?? JSON.stringify({ keys: [{ kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e }] }));
          return;
        }
        response.writeHead(404);
        response.end();
      });
    });
    return { server, state, jwk };
  }

  function boClaimsFor(iss, nonce, over = {}) {
    const now = Math.floor(Date.now() / 1_000);
    return {
      iss,
      sub: boSubject,
      aud: boClientId,
      exp: now + 300,
      iat: now,
      nonce,
      groups: ["compliance"],
      ...over,
    };
  }

  const atHashOf = (accessToken) =>
    createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url");

  async function driveBoEvilFlow(
    tokenFor,
    { decorate, env = {}, cookieJoin = "", mutateCallback, followUp } = {},
  ) {
    const { server, state, jwk } = makeBoEvilIssuer(tokenFor);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const evilBase = `http://127.0.0.1:${server.address().port}`;
    state.iss = evilBase;
    if (decorate) decorate(state, jwk, evilBase);
    try {
      return await backofficeEnv({
        BACKOFFICE_ALLOWED_ORIGINS: boOrigin,
        BACKOFFICE_OIDC_ISSUER_URL: evilBase,
        BACKOFFICE_OIDC_CLIENT_ID: boClientId,
        BACKOFFICE_OIDC_ROLE_MAP_JSON: JSON.stringify({ compliance: "compliance-lead" }),
        ...env,
      }, async () => {
        const bff = createBackofficeServer(loadBackofficeConfig());
        const base = await listen(bff);
        try {
          const login = await fetch(`${base}/bff/auth/login`, { redirect: "manual" });
          const tx = setCookies(login, "solidchange_bo_oidc_transaction")[0].split(";")[0];
          const granted = await fetch(new URL(login.headers.get("location") ?? ""), { redirect: "manual" });
          const callback = new URL(granted.headers.get("location") ?? "");
          if (mutateCallback) mutateCallback(callback);
          const callbackResponse = await fetch(`${base}${callback.pathname}${callback.search}`, {
            redirect: "manual",
            headers: { cookie: cookieJoin ? `${tx}; ${cookieJoin}` : tx },
          });
          if (followUp) await followUp(base, callbackResponse);
          return callbackResponse;
        } finally {
          await closeServer(bff);
        }
      });
    } finally {
      await closeServer(server);
    }
  }

  const expectBoFailed = (response) => {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${boOrigin}/?error=auth_failed`);
    assert.equal(setCookies(response, "solidchange_bo_session").length, 0);
  };

  function boForeignSigned(claims, kid = "evil") {
    const { privateKey: foreignKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(foreignKey, "base64url");
    return `${head}.${payload}.${signature}`;
  }

  test("hostile token responses and JWKS fail closed on the backoffice path", async () => {
    const honest = (state) => boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") });
    const cases = {
      token_type_mac: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "MAC",
        id_token: signClaims(honest(state)),
      }),
      token_type_absent: (signClaims, state) => ({
        access_token: "sat_evil",
        id_token: signClaims(honest(state)),
      }),
      at_hash_absent: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce)),
      }),
      at_hash_wrong: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: "AAAA" })),
      }),
      role_unmapped: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
          groups: ["nobody"],
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      nonce_mismatch: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, "foreign-nonce", { at_hash: atHashOf("sat_evil") })),
      }),
      iss_mismatch: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(`${state.iss}/`, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      aud_foreign: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
          aud: "other-client",
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      azp_foreign: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
          aud: [boClientId, "other"],
          azp: "other",
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      exp_expired: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
          exp: Math.floor(Date.now() / 1_000) - 1,
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      iat_future: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
          iat: Math.floor(Date.now() / 1_000) + 3_600,
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      nbf_future: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
          nbf: Math.floor(Date.now() / 1_000) + 3_600,
          at_hash: atHashOf("sat_evil"),
        })),
      }),
      sub_absent: (signClaims, state) => {
        const { sub: _sub, ...rest } = honest(state);
        return { access_token: "sat_evil", token_type: "Bearer", id_token: signClaims(rest) };
      },
      exp_absent: (signClaims, state) => {
        const { exp: _exp, ...rest } = honest(state);
        return { access_token: "sat_evil", token_type: "Bearer", id_token: signClaims(rest) };
      },
      iat_absent: (signClaims, state) => {
        const { iat: _iat, ...rest } = honest(state);
        return { access_token: "sat_evil", token_type: "Bearer", id_token: signClaims(rest) };
      },
      // A well-formed token signed under a key the JWKS never advertises:
      // skipping the signature check would mint an operator session here.
      bad_signature: (_signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: boForeignSigned(honest(state)),
      }),
      // Non-RS256 alg in the protected header — the signature itself is a
      // valid RS256 one, so only the header pin refuses it.
      header_alg_hs256: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(honest(state), { alg: "HS256" }),
      }),
      // A key-carrying header must be refused before signature verification.
      header_jwk: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(honest(state), { jwk: { kty: "RSA", n: "00", e: "AQAB" } }),
      }),
      // Duplicate members inside the token RESPONSE body: a last-wins parse
      // takes the second (honest) id_token — only the dup guard refuses it.
      token_response_dup_member: (signClaims, state) => JSON.stringify({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: "garbage",
      }).replace(/}$/, `,"id_token":${JSON.stringify(signClaims(honest(state)))}}`),
    };
    for (const [name, tokenFor] of Object.entries(cases)) {
      try {
        expectBoFailed(await driveBoEvilFlow(tokenFor));
      } catch (cause) {
        throw new Error(`${name}: ${cause}`);
      }
    }
  });

  test("two groups mapping to different roles fail as ambiguous", async () => {
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
        groups: ["compliance", "review"],
        at_hash: atHashOf("sat_evil"),
      })),
    });
    const response = await driveBoEvilFlow(tokenFor, {
      env: {
        BACKOFFICE_OIDC_ROLE_MAP_JSON: JSON.stringify({
          compliance: "compliance-lead",
          review: "auditor",
        }),
      },
    });
    expectBoFailed(response);
  });

  test("hostile JWKS documents fail closed on the backoffice path", async () => {
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    });
    const keyEntry = (jwk, over = {}) =>
      JSON.stringify({ kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e, ...over });
    const cases = {
      dup_kid: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk)},${keyEntry(jwk)}]}`;
      },
      use_enc: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { use: "enc" })}]}`;
      },
      alg_hs256: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { alg: "HS256" })}]}`;
      },
      private_member: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { d: "000000" })}]}`;
      },
      wrong_key_ops: (state, jwk) => {
        state.jwksText = `{"keys":[${keyEntry(jwk, { key_ops: ["sign"] })}]}`;
      },
      rsa_1024: (state, _jwk) => {
        const small = generateKeyPairSync("rsa", { modulusLength: 1024 });
        const smallJwk = small.publicKey.export({ format: "jwk" });
        state.jwksText = `{"keys":[${keyEntry(smallJwk)}]}`;
        state.signWith = small.privateKey;
      },
    };
    for (const [name, decorate] of Object.entries(cases)) {
      try {
        const response = await driveBoEvilFlow((signClaims, state) => {
          if (state.signWith) {
            const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "evil" })).toString("base64url");
            const payload = Buffer.from(JSON.stringify(
              boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }),
            )).toString("base64url");
            const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(state.signWith, "base64url");
            return { access_token: "sat_evil", token_type: "Bearer", id_token: `${head}.${payload}.${signature}` };
          }
          return tokenFor(signClaims, state);
        }, { decorate });
        expectBoFailed(response);
      } catch (cause) {
        throw new Error(`${name}: ${cause}`);
      }
    }
  });

  test("kid must select the verification key on the backoffice path too", async () => {
    // Both wrong-selection directions fail (see the miniapp arm's test).
    const forged = (kid, signWith) => (_signClaims, state) => {
      const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(
        boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }),
      )).toString("base64url");
      const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(signWith(state), "base64url");
      return { access_token: "sat_evil", token_type: "Bearer", id_token: `${head}.${payload}.${signature}` };
    };
    const twoKeys = (state, jwk) => {
      const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
      state.keyB = second.privateKey;
      const jwkB = second.publicKey.export({ format: "jwk" });
      state.jwksText = JSON.stringify({ keys: [
        { kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e },
        { kty: "RSA", kid: "other", use: "sig", alg: "RS256", n: jwkB.n, e: jwkB.e },
      ]});
    };
    expectBoFailed(await driveBoEvilFlow(
      forged("evil", (state) => state.keyB),
      { decorate: twoKeys },
    ));
    expectBoFailed(await driveBoEvilFlow(
      forged("other", (state) => state.keyA),
      {
        decorate: (state) => {
          const first = generateKeyPairSync("rsa", { modulusLength: 2048 });
          state.keyA = first.privateKey;
          const jwkA = first.publicKey.export({ format: "jwk" });
          const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
          const jwkB = second.publicKey.export({ format: "jwk" });
          state.jwksText = JSON.stringify({ keys: [
            { kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwkA.n, e: jwkA.e },
            { kty: "RSA", kid: "other", use: "sig", alg: "RS256", n: jwkB.n, e: jwkB.e },
          ]});
        },
      },
    ));
  });

  test("a token signed under the second advertised key still verifies", async () => {
    const response = await driveBoEvilFlow(
      (_signClaims, state) => {
        const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "other" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify(
          boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }),
        )).toString("base64url");
        const signature = createSign("RSA-SHA256").update(`${head}.${payload}`).sign(state.keyB, "base64url");
        return { access_token: "sat_evil", token_type: "Bearer", id_token: `${head}.${payload}.${signature}` };
      },
      {
        decorate: (state, jwk) => {
          const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
          state.keyB = second.privateKey;
          const jwkB = second.publicKey.export({ format: "jwk" });
          state.jwksText = JSON.stringify({ keys: [
            { kty: "RSA", kid: "evil", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e },
            { kty: "RSA", kid: "other", use: "sig", alg: "RS256", n: jwkB.n, e: jwkB.e },
          ]});
        },
      },
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), boOrigin);
    assert.ok(setCookies(response, "solidchange_bo_session")[0], "session cookie expected");
  });

  test("a denied callback never reaches the issuer token endpoint", async () => {
    let seen;
    const response = await driveBoEvilFlow(
      (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      {
        env: { BACKOFFICE_DEVICE_BINDING: "enforce" },
        decorate: (state) => {
          seen = state;
        },
      },
    );
    expectBoFailed(response);
    // The device gate runs before the exchange: no code was traded for a
    // token, so the denied browser holds nothing redeemable.
    assert.equal(seen.hits.token, 0);
  });

  test("the error parameter wins over a valid code without an exchange", async () => {
    let seen;
    const response = await driveBoEvilFlow(
      (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      {
        decorate: (state) => {
          seen = state;
        },
        mutateCallback: (callback) => {
          callback.searchParams.set("error", "access_denied");
        },
      },
    );
    expectBoFailed(response);
    assert.equal(seen.hits.token, 0);
  });

  test("an approved device completes the flow and the session stays device-bound", async () => {
    const deviceId = "a5f8c1d2-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
    const digest = createHash("sha256")
      .update(`solidchange-operator-device:v1:${deviceId}`)
      .digest("hex");
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    });
    let sessionCookie;
    const response = await driveBoEvilFlow(tokenFor, {
      env: {
        BACKOFFICE_DEVICE_BINDING: "enforce",
        BACKOFFICE_APPROVED_DEVICE_DIGESTS: digest,
      },
      cookieJoin: `solidchange_bo_device=${deviceId}`,
      followUp: async (base, callbackResponse) => {
        sessionCookie = setCookies(callbackResponse, "solidchange_bo_session")[0]?.split(";")[0];
        assert.ok(sessionCookie, "session cookie expected");
        // Without the device cookie the minted session does not resolve.
        const noDevice = await fetch(`${base}/bff/api/session`, {
          headers: { cookie: sessionCookie },
        });
        assert.equal(noDevice.status, 401);
        // A foreign, unapproved device does not resolve it either.
        const foreign = await fetch(`${base}/bff/api/session`, {
          headers: {
            cookie: `${sessionCookie}; solidchange_bo_device=${randomUUID()}`,
          },
        });
        assert.equal(foreign.status, 401);
        // With its bound device the session answers — and the subject is the
        // syn_oper_* derivation of the issuer's sub, never the raw sub.
        const bound = await fetch(`${base}/bff/api/session`, {
          headers: { cookie: `${sessionCookie}; solidchange_bo_device=${deviceId}` },
        });
        assert.equal(bound.status, 200);
        const expectedSubject =
          `syn_oper_${createHash("sha256")
            .update(`solidchange-backoffice-bff|${boSubject}`)
            .digest("hex").slice(0, 24)}`;
        const envelope = await bound.json();
        assert.equal(envelope.payload.operator.subject, expectedSubject);
      },
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), boOrigin);
    assert.ok(sessionCookie);
  });

  test("a duplicate-member JWKS document fails closed", async () => {
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    });
    const response = await driveBoEvilFlow(tokenFor, {
      decorate: (state, jwk) => {
        state.jwksText = `{"keys":[{"kty":"RSA","kid":"evil","e":"AQ","e":"${jwk.e}","n":"${jwk.n}","use":"sig"}]}`;
      },
    });
    expectBoFailed(response);
  });

  test("an exponent-1 RSA key does not admit a forged signature", async () => {
    // With e = 1 the PKCS#1 v1.5 encoded message is a valid signature:
    // s^e mod n == s. The forged token needs no private key at all.
    const tokenFor = (_signClaims, state) => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "evil" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(
        boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") }),
      )).toString("base64url");
      const digestInfo = Buffer.concat([
        Buffer.from("3031300d060960864801650304020105000420", "hex"),
        createHash("sha256").update(`${header}.${payload}`).digest(),
      ]);
      const modulusBytes = Buffer.from(state.jwkN, "base64url").byteLength;
      const em = Buffer.concat([
        Buffer.from([0, 1]),
        Buffer.alloc(modulusBytes - 3 - digestInfo.length, 0xff),
        Buffer.from([0]),
        digestInfo,
      ]);
      return {
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: `${header}.${payload}.${em.toString("base64url")}`,
      };
    };
    const response = await driveBoEvilFlow(tokenFor, {
      decorate: (state, jwk) => {
        state.jwkN = jwk.n;
        state.jwksText = `{"keys":[{"kty":"RSA","kid":"evil","e":"AQ","n":"${jwk.n}","use":"sig"}]}`;
      },
    });
    expectBoFailed(response);
  });

  test("a trailing forged transaction cookie does not shadow the real one", async () => {
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    });
    const response = await driveBoEvilFlow(tokenFor, {
      cookieJoin: "solidchange_bo_oidc_transaction=forged.forged",
    });
    assert.equal(response.headers.get("location"), boOrigin);
    assert.ok(setCookies(response, "solidchange_bo_session")[0], "session cookie expected");
  });

  test("a denied callback keeps the minted device cookie", async () => {
    const tokenFor = (signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    });
    const response = await driveBoEvilFlow(tokenFor, {
      env: { BACKOFFICE_DEVICE_BINDING: "enforce" },
    });
    expectBoFailed(response);
    const device = setCookies(response, "solidchange_bo_device")[0];
    assert.ok(device, "device cookie expected on a denied callback");
    assert.match(device, /Path=\/bff/);
  });

  test("an honest hostile-issuer token still mints only its mapped operator", async () => {
    const response = await driveBoEvilFlow((signClaims, state) => ({
      access_token: "sat_evil",
      token_type: "Bearer",
      id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
    }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), boOrigin);
    assert.ok(setCookies(response, "solidchange_bo_session")[0], "session cookie expected");
  });

});
