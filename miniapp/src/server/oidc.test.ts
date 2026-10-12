import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import {
  type OidcIssuer,
  type OidcRequest,
  createOidcIssuer
} from "@solidchange/provider-simulators";
import { loadServerConfig, type OidcConfig, type ServerConfig } from "./config.js";
import {
  authorizationUrl,
  createCodeChallenge,
  exchangeAuthorizationCode,
  verifyIdToken
} from "./oidc.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const clientId = "miniapp-dev";

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

function oidcConfigFor(
  issuer: string,
  envOverrides: Readonly<Record<string, string>> = {}
): ServerConfig {
  return loadServerConfig({
    MINIAPP_ALLOW_DEV_LOGIN: "true",
    MINIAPP_OIDC_ISSUER_URL: issuer,
    MINIAPP_OIDC_CLIENT_ID: clientId,
    ...envOverrides
  }) as ServerConfig & { oidc: OidcConfig };
}

async function startIssuer(
  issuerConfig: Partial<Parameters<typeof createOidcIssuer>[0]> = {}
): Promise<{ issuer: OidcIssuer; issuerBase: string; clock: { value: number; now(): number } }> {
  // The BFF verifies exp/iat against wall time, so the issuer clock anchors
  // on real time too (tests move it only for TTL checks).
  const clock = { value: Math.floor(Date.now() / 1_000), now() { return this.value; } };
  // The issuer base is known only after listen, so the issuer is created in
  // two steps: a placeholder created with the reserved port.
  const probe = createServer();
  servers.push(probe);
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("issuer port unavailable");
  const issuerBase = `http://127.0.0.1:${address.port}`;
  const issuer = createOidcIssuer({
    issuer: issuerBase,
    clientId,
    redirectUris: [`${origin}/bff/auth/callback`],
    clock,
    ...issuerConfig
  });
  probe.on("request", (request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
    request.on("end", () => {
      const query: OidcRequest = {
        method: request.method ?? "GET",
        url: request.url ?? "/",
        headers: request.headers as Record<string, string | undefined>,
        body: body || undefined
      };
      void issuer.handle(query).then((reply) => {
        response.writeHead(reply.status, { ...reply.headers });
        response.end(reply.body);
      });
    });
  });
  return { issuer, issuerBase, clock };
}

async function startBff(serverConfig: ServerConfig): Promise<{ base: string }> {
  const server = createMiniappServer(serverConfig);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return { base: `http://127.0.0.1:${address.port}` };
}

function headerCookies(response: Response, name: string): string[] {
  const getter = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const list = typeof getter === "function"
    ? getter.call(response.headers)
    : (response.headers.get("set-cookie") ?? "").split(/,(?=solidchange_)/);
  return list.filter((cookie) => cookie.startsWith(`${name}=`));
}

function sessionCookieOf(response: Response): string | undefined {
  return headerCookies(response, "solidchange_ma_session")[0];
}

function txCookieOf(response: Response): string | undefined {
  return headerCookies(response, "solidchange_ma_oidc_tx")[0];
}

describe("oidc config", () => {
  it("stays silent when the env pair is unset", () => {
    assert.equal(loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }).oidc, undefined);
  });

  it("fails closed when only one half of the pair is set", () => {
    assert.throws(
      () => loadServerConfig({ MINIAPP_OIDC_ISSUER_URL: "http://127.0.0.1:9000" }),
      /must be set together/
    );
    assert.throws(
      () => loadServerConfig({ MINIAPP_OIDC_CLIENT_ID: clientId }),
      /must be set together/
    );
  });

  it("rejects invalid issuer URLs and client ids at boot", () => {
    const env = (issuer: string, id = clientId) => () =>
      loadServerConfig({ MINIAPP_OIDC_ISSUER_URL: issuer, MINIAPP_OIDC_CLIENT_ID: id });
    assert.throws(env("not-a-url"), /absolute HTTP\(S\) URL/);
    assert.throws(env("ftp://127.0.0.1"), /absolute HTTP\(S\) URL|HTTPS/);
    assert.throws(env("http://example.com"), /HTTPS|loopback/);
    assert.throws(env("http://127.0.0.1?x=1"), /credentials, query or fragment/);
    assert.throws(env("http://127.0.0.1", "bad id!"), /unexpected|match/);
  });

  it("derives endpoints under the issuer and the callback on the first origin", () => {
    const config = oidcConfigFor("http://127.0.0.1:9080/");
    assert.equal(config.oidc?.issuer, "http://127.0.0.1:9080");
    assert.equal(config.oidc?.authorizationEndpoint, "http://127.0.0.1:9080/authorize");
    assert.equal(config.oidc?.tokenEndpoint, "http://127.0.0.1:9080/token");
    assert.equal(config.oidc?.jwksUri, "http://127.0.0.1:9080/.well-known/jwks.json");
    assert.equal(config.oidc?.redirectUri, `${origin}/bff/auth/callback`);
  });
});

describe("oidc authorization url", () => {
  it("carries the code+S256 parameters", () => {
    const config = oidcConfigFor("http://127.0.0.1:9080").oidc as OidcConfig;
    const url = new URL(authorizationUrl(config, "st", "nn", "vv"));
    assert.equal(url.origin + url.pathname, "http://127.0.0.1:9080/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), clientId);
    assert.equal(url.searchParams.get("redirect_uri"), `${origin}/bff/auth/callback`);
    assert.equal(url.searchParams.get("scope"), "openid");
    assert.equal(url.searchParams.get("state"), "st");
    assert.equal(url.searchParams.get("nonce"), "nn");
    assert.equal(url.searchParams.get("code_challenge"), createCodeChallenge("vv"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });
});

async function mintCode(issuerBase: string, verifier: string, nonce: string): Promise<string> {
  const url = new URL(`${issuerBase}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `${origin}/bff/auth/callback`,
    scope: "openid",
    state: "sim-state",
    nonce,
    code_challenge: createCodeChallenge(verifier),
    code_challenge_method: "S256"
  }).toString();
  const response = await fetch(url, { redirect: "manual" });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  const code = location.searchParams.get("code");
  assert.ok(code);
  return code;
}

describe("oidc token verification", () => {
  it("accepts a real flow from the hosted issuer", async () => {
    const { issuerBase } = await startIssuer();
    const config = oidcConfigFor(issuerBase).oidc as OidcConfig;
    const verifier = "v".repeat(64);
    const code = await mintCode(issuerBase, verifier, "nonce-1");
    const exchange = await exchangeAuthorizationCode(config, code, verifier);
    const identity = await verifyIdToken(
      exchange.idToken, config, "nonce-1", exchange.accessToken
    );
    assert.equal(identity.subject, "dev-customer-1");
  });

  it("rejects a replayed code at the issuer", async () => {
    const { issuerBase } = await startIssuer();
    const config = oidcConfigFor(issuerBase).oidc as OidcConfig;
    const verifier = "v".repeat(64);
    const code = await mintCode(issuerBase, verifier, "nonce-2");
    await exchangeAuthorizationCode(config, code, verifier);
    await assert.rejects(() => exchangeAuthorizationCode(config, code, verifier));
  });

  it("rejects an expired code at the issuer", async () => {
    const { issuerBase, clock } = await startIssuer();
    const config = oidcConfigFor(issuerBase).oidc as OidcConfig;
    const verifier = "v".repeat(64);
    const code = await mintCode(issuerBase, verifier, "nonce-3");
    clock.value += 121;
    await assert.rejects(() => exchangeAuthorizationCode(config, code, verifier));
  });

  it("rejects a wrong verifier at the issuer", async () => {
    const { issuerBase } = await startIssuer();
    const config = oidcConfigFor(issuerBase).oidc as OidcConfig;
    const code = await mintCode(issuerBase, "v".repeat(64), "nonce-4");
    await assert.rejects(() => exchangeAuthorizationCode(config, code, "w".repeat(64)));
  });

  it("rejects id_tokens with a wrong nonce, bad signature, or tampered at_hash", async () => {
    const { issuerBase } = await startIssuer();
    const config = oidcConfigFor(issuerBase).oidc as OidcConfig;
    const verifier = "v".repeat(64);
    const code = await mintCode(issuerBase, verifier, "nonce-5");
    const exchange = await exchangeAuthorizationCode(config, code, verifier);
    const [header, claims, signature] = exchange.idToken.split(".");

    await assert.rejects(() =>
      verifyIdToken(exchange.idToken, config, "other-nonce", exchange.accessToken)
    );
    await assert.rejects(() =>
      verifyIdToken(`${header}.${claims}.${signature.slice(0, -2)}AA`, config, "nonce-5", exchange.accessToken)
    );
    await assert.rejects(() =>
      verifyIdToken(exchange.idToken, config, "nonce-5", `${exchange.accessToken}x`)
    );
    // An at_hash the token advertises without the matching access token fails closed.
    await assert.rejects(() => verifyIdToken(exchange.idToken, config, "nonce-5"));
  });

  it("rejects a token signed by a different key", async () => {
    const { issuerBase } = await startIssuer();
    const config = oidcConfigFor(issuerBase).oidc as OidcConfig;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "foreign" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: config.issuer, sub: "dev-customer-1", aud: clientId,
      exp: 4_102_444_800, iat: 1_700_000_000, nonce: "nonce-6"
    })).toString("base64url");
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${claims}`)
      .sign(privateKey, "base64url");
    await assert.rejects(() =>
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-6")
    );
  });
});

describe("oidc login routes", () => {
  async function bffLogin(base: string): Promise<Response> {
    return fetch(`${base}/bff/auth/login`, { redirect: "manual" });
  }

  async function callbackLocation(
    base: string,
    loginResponse: Response,
    cookie?: string
  ): Promise<{ response: Response; callback: URL }> {
    const authorize = new URL(loginResponse.headers.get("location") ?? "");
    const tx = cookie ?? (txCookieOf(loginResponse) ?? "").split(";")[0];
    const authorizeResponse = await fetch(authorize, { redirect: "manual" });
    const callback = new URL(authorizeResponse.headers.get("location") ?? "");
    const response = await fetch(`${base}${callback.pathname}${callback.search}`, {
      redirect: "manual",
      headers: { cookie: tx, "sec-fetch-site": "cross-site" }
    });
    return { response, callback };
  }

  it("serves 404 for auth routes when OIDC is unconfigured", async () => {
    const { base } = await startBff(loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }));
    assert.equal((await bffLogin(base)).status, 404);
    assert.equal(
      (await fetch(`${base}/bff/auth/callback?code=x&state=y`, { redirect: "manual" })).status,
      404
    );
  });

  it("drives the full login flow to a session cookie and profile", async () => {
    const { issuerBase } = await startIssuer();
    const { base } = await startBff(oidcConfigFor(issuerBase));

    const login = await bffLogin(base);
    assert.equal(login.status, 302);
    const authorize = new URL(login.headers.get("location") ?? "");
    assert.equal(authorize.origin + authorize.pathname, `${issuerBase}/authorize`);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    const tx = txCookieOf(login);
    assert.ok(tx);
    assert.match(tx, /HttpOnly/);
    assert.match(tx, /SameSite=Lax/);
    assert.match(tx, /Path=\/bff\/auth/);

    const { response: callback } = await callbackLocation(base, login);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), origin);
    const session = sessionCookieOf(callback);
    assert.ok(session);

    const profile = await fetch(`${base}/bff/profile`, {
      headers: { cookie: session.split(";")[0] }
    });
    assert.equal(profile.status, 200);
    const view = await fetch(`${base}/bff/session`, {
      headers: { cookie: session.split(";")[0] }
    }).then((r) => r.json()) as { source?: string; kyc?: string; customerRef?: string };
    assert.equal(view.source, "dev-synthetic");
    assert.equal(view.kyc, "verified");
    const expectedSubject = `dev-${createHash("sha256").update("solidchange-miniapp-oidc|dev-customer-1").digest("hex").slice(0, 16)}`;
    assert.equal(view.customerRef, `SC-DEV-${expectedSubject.slice(-5).toUpperCase()}`);
  });

  it("fails closed on state mismatch, missing cookie, replayed code and error params", async () => {
    const { issuerBase } = await startIssuer();
    const { base } = await startBff(oidcConfigFor(issuerBase));
    const expectFailed = (response: Response) => {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `${origin}/?error=auth_failed`);
    };

    // `?error=` from the issuer → generic failure redirect.
    expectFailed(
      await fetch(`${base}/bff/auth/callback?error=access_denied`, { redirect: "manual" })
    );

    // Real authorize redirect but a foreign (mismatched) transaction cookie.
    const loginA = await bffLogin(base);
    const authorizeA = new URL(loginA.headers.get("location") ?? "");
    const callbackA = new URL(
      (await fetch(authorizeA, { redirect: "manual" })).headers.get("location") ?? ""
    );
    expectFailed(
      await fetch(`${base}${callbackA.pathname}${callbackA.search}`, {
        redirect: "manual",
        headers: { cookie: "solidchange_ma_oidc_tx=foreign.foreign" }
      })
    );

    // No transaction cookie at all.
    expectFailed(
      await fetch(`${base}${callbackA.pathname}${callbackA.search}`, { redirect: "manual" })
    );

    // Happy path, then replaying the same callback URL fails: the pending
    // entry was consumed on first use and the code is single-use at the issuer.
    const loginB = await bffLogin(base);
    const { response: callbackB, callback: callbackBUrl } = await callbackLocation(base, loginB);
    assert.equal(callbackB.headers.get("location"), origin);
    const txB = (txCookieOf(loginB) ?? "").split(";")[0];
    const replayed = await fetch(`${base}${callbackBUrl.pathname}${callbackBUrl.search}`, {
      redirect: "manual",
      headers: { cookie: txB }
    });
    expectFailed(replayed);
  });

  it("keeps at most two outstanding flows per initiator", async () => {
    const { issuerBase } = await startIssuer();
    const { base } = await startBff(oidcConfigFor(issuerBase));
    // One browser chains three logins through the rotating tx cookie; the
    // oldest pending entry is evicted so its callback must fail closed.
    const first = await bffLogin(base);
    const firstTx = (txCookieOf(first) ?? "").split(";")[0];
    const firstAuthorize = new URL(first.headers.get("location") ?? "");
    const firstCallback = new URL(
      (await fetch(firstAuthorize, { redirect: "manual" })).headers.get("location") ?? ""
    );

    const second = await fetch(`${base}/bff/auth/login`, {
      redirect: "manual",
      headers: { cookie: firstTx }
    });
    const secondTx = (txCookieOf(second) ?? "").split(";")[0];
    await fetch(`${base}/bff/auth/login`, {
      redirect: "manual",
      headers: { cookie: secondTx }
    });

    const oldest = await fetch(`${base}${firstCallback.pathname}${firstCallback.search}`, {
      redirect: "manual",
      headers: { cookie: firstTx }
    });
    assert.equal(oldest.status, 302);
    assert.equal(oldest.headers.get("location"), `${origin}/?error=auth_failed`);
  });
});
