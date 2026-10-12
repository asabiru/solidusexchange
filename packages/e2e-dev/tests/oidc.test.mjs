import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
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
