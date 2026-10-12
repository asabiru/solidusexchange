import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { after, before, describe, test } from "node:test";

import { createOidcIssuer } from "../../provider-simulators/src/index.mjs";
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
    // Expired: the issuer's clock moved past the code TTL before exchange.
    const { authorize, tx } = await loginStart();
    const callback = await issuerGrant(authorize);
    const code = callback.searchParams.get("code");
    now += 121_000;
    try {
      const expired = await callbackOf(callback, tx);
      assert.equal(expired.headers.get("location"), `${origin}/?error=auth_failed`);
    } finally {
      now -= 121_000;
    }

    // Replayed: a successful flow, then the same callback again — the pending
    // entry is single-use even though the tx cookie is still presented.
    const second = await loginStart();
    const callbackB = await issuerGrant(second.authorize);
    const first = await callbackOf(callbackB, second.tx);
    assert.equal(first.headers.get("location"), origin);
    const replayed = await callbackOf(callbackB, second.tx);
    assert.equal(replayed.headers.get("location"), `${origin}/?error=auth_failed`);

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
    const state = { nonce: "", jwksText: null, iss: "" };
    const signClaims = (claims) => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "evil" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey, "base64url");
      return `${header}.${payload}.${signature}`;
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
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(tokenFor(signClaims, state)));
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
  async function driveEvilFlow(tokenFor, decorate) {
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
});

describe("backoffice hostile issuer (wave-66)", () => {
  // Same fully attacker-controlled issuer as the miniapp arm, tuned to the
  // backoffice OIDC wiring: operator claims need a mappable role group, the
  // callback lands on ${boOrigin}/bff/auth/callback and the session cookie is
  // solidchange_bo_session.
  function makeBoEvilIssuer(tokenFor) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" });
    const state = { nonce: "", jwksText: null, iss: "" };
    const signClaims = (claims) => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "evil" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey, "base64url");
      return `${header}.${payload}.${signature}`;
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
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(tokenFor(signClaims, state)));
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

  // Loads a BFF config against the evil issuer through the real env pair,
  // restoring process env afterwards.
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

  async function driveBoEvilFlow(tokenFor, { decorate, env = {}, cookieJoin = "" } = {}) {
    const { server, state, jwk } = makeBoEvilIssuer(tokenFor);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const evilBase = `http://127.0.0.1:${server.address().port}`;
    state.iss = evilBase;
    if (decorate) decorate(state, jwk, evilBase);
    const response = await backofficeEnv({
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
        return await fetch(`${base}${callback.pathname}${callback.search}`, {
          redirect: "manual",
          headers: { cookie: cookieJoin ? `${tx}; ${cookieJoin}` : tx },
        });
      } finally {
        await closeServer(bff);
      }
    });
    await closeServer(server);
    return response;
  }

  const expectBoFailed = (response) => {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${boOrigin}/?error=auth_failed`);
    assert.equal(setCookies(response, "solidchange_bo_session").length, 0);
  };

  test("hostile token responses and JWKS fail closed on the backoffice path", async () => {
    const cases = {
      token_type_mac: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "MAC",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      token_type_absent: (signClaims, state) => ({
        access_token: "sat_evil",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, { at_hash: atHashOf("sat_evil") })),
      }),
      at_hash_absent: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce)),
      }),
      role_unmapped: (signClaims, state) => ({
        access_token: "sat_evil",
        token_type: "Bearer",
        id_token: signClaims(boClaimsFor(state.iss, state.nonce, {
          groups: ["nobody"],
          at_hash: atHashOf("sat_evil"),
        })),
      }),
    };
    for (const [name, tokenFor] of Object.entries(cases)) {
      try {
        expectBoFailed(await driveBoEvilFlow(tokenFor));
      } catch (cause) {
        throw new Error(`${name}: ${cause}`);
      }
    }
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
