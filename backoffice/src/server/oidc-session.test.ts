import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { demoRepository } from "../data/demo.js";
import type { ServerConfig } from "./config.js";
import { approvalCommandDigest } from "./controls.js";
import { deviceDigest } from "./device.js";
import { createBackofficeServer } from "./server.js";

const origin = "http://127.0.0.1:4173";
const issuer = "https://identity.example.test";
const clientId = "solidchange-backoffice";
const approvedDevice = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const secondDevice = "9b8a7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const transactionCookie = "solidchange_bo_oidc_transaction";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe("OIDC re-login session rotation", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const nonces = new Map<string, string>();
  let identityProvider: Server;
  let identityUrl: string;

  before(async () => {
    identityProvider = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/jwks") {
        response.end(JSON.stringify({
          keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "rotation-key" }]
        }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const code = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("code") ?? "";
      const nonce = nonces.get(code);
      if (!nonce) {
        response.statusCode = 400;
        response.end("{}");
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const header = encode({ alg: "RS256", kid: "rotation-key" });
      const claims = encode({
        iss: issuer,
        sub: "operator-42",
        aud: clientId,
        exp: now + 300,
        iat: now,
        nonce,
        email: "operator@example.test",
        groups: ["compliance"]
      });
      const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), pair.privateKey)
        .toString("base64url");
      response.end(JSON.stringify({ id_token: `${header}.${claims}.${signature}` }));
    });
    identityUrl = await listen(identityProvider);
  });

  after(async () => {
    await close(identityProvider);
  });

  function config(deviceBinding?: ServerConfig["deviceBinding"]): ServerConfig {
    return {
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [origin],
      allowDevLogin: false,
      sessionTtlSeconds: 900,
      audit: { storage: "memory", retentionDays: 30 },
      stepUp: {
        provider: "synthetic-dev",
        challengeTtlSeconds: 300,
        grantTtlSeconds: 60,
        maxAttempts: 3
      },
      signing: { backend: "ephemeral-dev", rotationSeconds: 900, retainedVerificationKeys: 2 },
      deviceBinding,
      oidc: {
        issuer,
        authorizationEndpoint: `${issuer}/authorize`,
        tokenEndpoint: `${identityUrl}/token`,
        jwksUri: `${identityUrl}/jwks`,
        clientId,
        clientSecret: "",
        redirectUri: `${origin}/bff/auth/callback`,
        roleClaim: "groups",
        roleMap: { compliance: "compliance-lead" }
      }
    };
  }

  async function withBff(
    deviceBinding: ServerConfig["deviceBinding"],
    run: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const bff = createBackofficeServer(config(deviceBinding));
    const baseUrl = await listen(bff);
    try {
      await run(baseUrl);
    } finally {
      await close(bff);
    }
  }

  // Browser semantics: the SameSite=Strict session cookie is sent on the
  // same-site /bff/auth/login navigation but omitted on the cross-site IdP
  // redirect to /bff/auth/callback; Lax device/transaction cookies are sent.
  async function oidcLogin(
    baseUrl: string,
    cookies: { login?: string; callback?: string } = {}
  ): Promise<string> {
    const login = await fetch(`${baseUrl}/bff/auth/login`, {
      redirect: "manual",
      headers: cookies.login ? { cookie: cookies.login } : {}
    });
    assert.equal(login.status, 302);
    const location = login.headers.get("location");
    assert.ok(location);
    const authorize = new URL(location);
    const state = authorize.searchParams.get("state");
    const nonce = authorize.searchParams.get("nonce");
    assert.ok(state && nonce);
    const code = `code-${state}`;
    nonces.set(code, nonce);
    const callbackCookie = [`${transactionCookie}=${state}`, cookies.callback]
      .filter(Boolean)
      .join("; ");
    const callback = await fetch(
      `${baseUrl}/bff/auth/callback?code=${code}&state=${state}`,
      { redirect: "manual", headers: { cookie: callbackCookie } }
    );
    assert.equal(callback.status, 302);
    const session = callback.headers.getSetCookie()
      .find((value) => value.startsWith("solidchange_bo_session="));
    assert.ok(session);
    assert.match(session, /; HttpOnly; SameSite=Strict; Path=\/bff; Max-Age=900$/);
    return session.split(";")[0];
  }

  async function authenticated(baseUrl: string, cookie: string): Promise<boolean> {
    const status = await fetch(`${baseUrl}/bff/auth/status`, { headers: { cookie } });
    return ((await status.json()) as { authenticated: boolean }).authenticated;
  }

  async function stepUpGrant(baseUrl: string, cookie: string): Promise<string> {
    const approval = demoRepository.approvals().find((item) => item.id === "APV-843910");
    assert.ok(approval);
    const commandDigest = approvalCommandDigest(approval);
    const headers = { cookie, "content-type": "application/json", origin };
    const path = `${baseUrl}/bff/api/approvals/${approval.id}/step-up/challenges`;
    const challenge = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ commandDigest })
    });
    assert.equal(challenge.status, 200);
    const { payload } = await challenge.json() as {
      payload: { challengeId: string; devVerificationCode: string };
    };
    const verification = await fetch(`${path}/${payload.challengeId}/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ commandDigest, code: payload.devVerificationCode })
    });
    assert.equal(verification.status, 200);
    return ((await verification.json()) as { payload: { grant: string } }).payload.grant;
  }

  async function previewWithGrant(baseUrl: string, cookie: string, grant: string) {
    const approval = demoRepository.approvals().find((item) => item.id === "APV-843910");
    assert.ok(approval);
    return fetch(`${baseUrl}/bff/api/approvals/${approval.id}/preview`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin },
      body: JSON.stringify({ commandDigest: approvalCommandDigest(approval), stepUpGrant: grant })
    });
  }

  it("revokes the session presented at login start when the cookie is absent on callback", async () => {
    await withBff(undefined, async (baseUrl) => {
      const previous = await oidcLogin(baseUrl);
      const grant = await stepUpGrant(baseUrl, previous);
      const rotated = await oidcLogin(baseUrl, { login: previous });
      assert.notEqual(rotated, previous);
      assert.equal(await authenticated(baseUrl, previous), false);
      const replay = await previewWithGrant(baseUrl, previous, grant);
      assert.equal(replay.status, 401);
      assert.deepEqual(await replay.json(), { error: "operator_session_required" });
      assert.equal(await authenticated(baseUrl, rotated), true);
    });
  });

  it("does not revoke the prior session when the callback is rejected", async () => {
    await withBff(undefined, async (baseUrl) => {
      const previous = await oidcLogin(baseUrl);
      const login = await fetch(`${baseUrl}/bff/auth/login`, {
        redirect: "manual",
        headers: { cookie: previous }
      });
      const state = new URL(login.headers.get("location") ?? "").searchParams.get("state");
      assert.ok(state);
      const rejected = await fetch(
        `${baseUrl}/bff/auth/callback?code=unknown&state=${state}`,
        { redirect: "manual", headers: { cookie: `${transactionCookie}=${state}` } }
      );
      assert.equal(rejected.status, 500);
      assert.equal(await authenticated(baseUrl, previous), true);
    });
  });

  it("keeps other sessions when binding is off and nothing was presented at login", async () => {
    await withBff(undefined, async (baseUrl) => {
      const other = await oidcLogin(baseUrl);
      const current = await oidcLogin(baseUrl);
      assert.equal(await authenticated(baseUrl, other), true);
      assert.equal(await authenticated(baseUrl, current), true);
    });
  });

  it("revokes prior sessions bound to the same device even when no session cookie reaches the BFF", async () => {
    const binding = {
      mode: "enforce" as const,
      approvedDeviceDigests: [deviceDigest(approvedDevice), deviceDigest(secondDevice)]
    };
    await withBff(binding, async (baseUrl) => {
      const device = `solidchange_bo_device=${approvedDevice}`;
      const otherDevice = `solidchange_bo_device=${secondDevice}`;
      const previous = await oidcLogin(baseUrl, { login: device, callback: device });
      const grant = await stepUpGrant(baseUrl, `${previous}; ${device}`);
      const elsewhere = await oidcLogin(baseUrl, { login: otherDevice, callback: otherDevice });

      const rotated = await oidcLogin(baseUrl, { login: device, callback: device });
      assert.equal(await authenticated(baseUrl, `${previous}; ${device}`), false);
      const replay = await previewWithGrant(baseUrl, `${previous}; ${device}`, grant);
      assert.equal(replay.status, 401);
      assert.equal(await authenticated(baseUrl, `${rotated}; ${device}`), true);
      assert.equal(await authenticated(baseUrl, `${elsewhere}; ${otherDevice}`), true);
    });
  });

  it("ignores a stale pending-login session id after logout and re-login", async () => {
    await withBff(undefined, async (baseUrl) => {
      const previous = await oidcLogin(baseUrl);
      const login = await fetch(`${baseUrl}/bff/auth/login`, {
        redirect: "manual",
        headers: { cookie: previous }
      });
      assert.equal(login.status, 302);
      const logout = await fetch(`${baseUrl}/bff/auth/logout`, {
        method: "POST",
        headers: { cookie: previous, origin }
      });
      assert.equal(logout.status, 204);
      assert.equal(await authenticated(baseUrl, previous), false);
      const next = await oidcLogin(baseUrl);
      assert.equal(await authenticated(baseUrl, next), true);
    });
  });
});
