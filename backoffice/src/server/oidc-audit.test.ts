import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import type { OidcConfig, ServerConfig } from "./config.js";
import { deviceDigest } from "./device.js";
import {
  authorizationUrl,
  createCodeChallenge,
  createOpaqueValue,
  exchangeAuthorizationCode,
  verifyIdToken
} from "./oidc.js";
import { createBackofficeServer } from "./server.js";

const issuer = "https://identity.example.test";
const clientId = "solidchange-backoffice";
const origin = "http://127.0.0.1:4173";
const transactionCookie = "solidchange_bo_oidc_transaction";
const sessionCookie = "solidchange_bo_session";

interface RsaPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

function configFor(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/jwks`,
    clientId,
    redirectUri: `${origin}/bff/auth/callback`,
    roleClaim: "groups",
    roleMap: { compliance: "compliance-lead" },
    ...overrides
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwksFor(pair: RsaPair, kid = "audit-key") {
  return { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid }] };
}

function signedClaims(pair: RsaPair, claims: Record<string, unknown>): string {
  const header = encode({ alg: "RS256", kid: "audit-key" });
  const body = encode(claims);
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), pair.privateKey)
    .toString("base64url");
  return `${header}.${body}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    sub: "operator-52",
    aud: clientId,
    exp: now + 300,
    iat: now,
    nonce: "nonce-expected",
    groups: ["compliance"],
    ...overrides
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("OIDC audit wave 52 — defect regressions", () => {
  it("PINNED: the token endpoint never follows redirects, so the grant, verifier and client secret cannot be re-posted elsewhere", async () => {
    let captured: string | undefined;
    const collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        captured = Buffer.concat(chunks).toString("utf8");
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ id_token: "injected-token" }));
      });
    });
    const collectorUrl = await listen(collector);
    const redirector = createServer((_request, response) => {
      response.writeHead(307, { location: `${collectorUrl}/capture` });
      response.end();
    });
    const redirectorUrl = await listen(redirector);
    try {
      await assert.rejects(
        exchangeAuthorizationCode(
          configFor({ tokenEndpoint: `${redirectorUrl}/token` }),
          "grant-code",
          "grant-verifier"
        )
      );
      assert.equal(captured, undefined);
    } finally {
      await close(redirector);
      await close(collector);
    }
  });

  it("PINNED: the JWKS endpoint never follows redirects, so verification keys cannot be substituted", async () => {
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const evilJwks = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(jwksFor(attacker)));
    });
    const evilUrl = await listen(evilJwks);
    const redirector = createServer((_request, response) => {
      response.writeHead(302, { location: `${evilUrl}/jwks` });
      response.end();
    });
    const redirectorUrl = await listen(redirector);
    try {
      const idToken = signedClaims(attacker, validClaims());
      await assert.rejects(
        verifyIdToken(idToken, configFor({ jwksUri: `${redirectorUrl}/jwks` }), "nonce-expected")
      );
    } finally {
      await close(redirector);
      await close(evilJwks);
    }
  });

  it("PINNED: token responses beyond the bounded size are rejected instead of buffered without limit", async () => {
    const endpoint = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(`{"id_token":"${"x".repeat(70_000)}"}`);
    });
    const url = await listen(endpoint);
    try {
      await assert.rejects(
        exchangeAuthorizationCode(
          configFor({ tokenEndpoint: `${url}/token` }),
          "grant-code",
          "grant-verifier"
        )
      );
    } finally {
      await close(endpoint);
    }
  });

  it("PINNED: JWKS documents beyond the bounded size are rejected instead of buffered without limit", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const endpoint = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ...jwksFor(pair), pad: "x".repeat(70_000) }));
    });
    const url = await listen(endpoint);
    try {
      const idToken = signedClaims(pair, validClaims());
      await assert.rejects(
        verifyIdToken(idToken, configFor({ jwksUri: `${url}/jwks` }), "nonce-expected")
      );
    } finally {
      await close(endpoint);
    }
  });

  it("PINNED: subjects containing control characters are rejected", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwks = jwksFor(pair);
    for (const sub of ["op\nerator", "op\u0007er", "op\u001fb", "op\u007fer", "op\u0000x"]) {
      const idToken = signedClaims(pair, validClaims({ sub }));
      await assert.rejects(
        verifyIdToken(idToken, configFor(), "nonce-expected", undefined, jwks),
        /malformed/
      );
    }
  });
});

describe("OIDC audit wave 52 — verified clean classes", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks = jwksFor(pair);
  const config = configFor();

  async function expectRejected(token: string, expected: RegExp): Promise<void> {
    await assert.rejects(verifyIdToken(token, config, "nonce-expected", undefined, jwks), expected);
  }

  it("PINNED: the nonce must equal the stored authorization request exactly", async () => {
    for (const nonce of ["nonce-other", "Nonce-expected", "nonce-expected ", "", undefined]) {
      const token = signedClaims(pair, validClaims({ nonce }));
      await expectRejected(token, /not valid|malformed/);
    }
    const identity = await verifyIdToken(
      signedClaims(pair, validClaims()),
      config,
      "nonce-expected",
      undefined, jwks
    );
    assert.equal(identity.subject, "operator-52");
  });

  it("PINNED: expired tokens and tokens outside the clock skew are rejected", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectRejected(signedClaims(pair, validClaims({ exp: now })), /not valid/);
    await expectRejected(signedClaims(pair, validClaims({ exp: now - 60 })), /not valid/);
    await expectRejected(signedClaims(pair, validClaims({ iat: now + 120 })), /not valid/);
    await expectRejected(signedClaims(pair, validClaims({ nbf: now + 120 })), /not valid/);
    await verifyIdToken(
      signedClaims(pair, validClaims({ iat: now + 30, nbf: now + 30 })),
      config,
      "nonce-expected",
      undefined, jwks
    );
  });

  it("PINNED: issuer and audience must match the configured values exactly", async () => {
    await expectRejected(signedClaims(pair, validClaims({ iss: "https://other.test" })), /mismatch/);
    await expectRejected(signedClaims(pair, validClaims({ iss: `${issuer}/` })), /mismatch/);
    await expectRejected(signedClaims(pair, validClaims({ iss: 0 })), /malformed/);
    await expectRejected(signedClaims(pair, validClaims({ aud: "other-audience" })), /mismatch/);
    await expectRejected(signedClaims(pair, validClaims({ aud: ["a", "b"] })), /mismatch/);
    const identity = await verifyIdToken(
      signedClaims(pair, validClaims({ aud: [clientId, "other"], azp: clientId })),
      config,
      "nonce-expected",
      undefined, jwks
    );
    assert.equal(identity.subject, "operator-52");
  });

  it("PINNED: azp is required for multi-audience tokens and must equal the client", async () => {
    await expectRejected(
      signedClaims(pair, validClaims({ aud: [clientId, "other"] })),
      /authorized party/
    );
    await expectRejected(
      signedClaims(pair, validClaims({ aud: [clientId, "other"], azp: "other" })),
      /authorized party/
    );
    await expectRejected(signedClaims(pair, validClaims({ azp: "other" })), /authorized party/);
  });

  it("PINNED: only RS256 is accepted — none, symmetric, EC and casing confusions are rejected", async () => {
    for (const alg of ["none", "HS256", "ES256", "PS256", "EdDSA", "rs256", "RS256 ", 0, undefined]) {
      const header = encode({ ...(alg === undefined ? {} : { alg }), kid: "audit-key" });
      const body = encode(validClaims());
      await expectRejected(`${header}.${body}.AAAA`, /not allowed|malformed/);
    }
  });

  it("PINNED: kid must be a non-empty string matching exactly one published key", async () => {
    const body = encode(validClaims());
    for (const kid of [undefined, "", 42, ["audit-key"], { id: "audit-key" }]) {
      const header = encode({ alg: "RS256", ...(kid === undefined ? {} : { kid }) });
      await expectRejected(`${header}.${body}.AAAA`, /not allowed/);
    }
    const good = signedClaims(pair, validClaims());
    await expectRejected(
      `${encode({ alg: "RS256", kid: "missing-key" })}.${body}.${good.split(".")[2]}`,
      /not found/
    );
    const duplicated = { keys: [jwks.keys[0], jwks.keys[0]] };
    await assert.rejects(verifyIdToken(good, config, "nonce-expected", undefined, duplicated), /ambiguous/);
  });

  it("PINNED: token structure and canonical base64url encoding are enforced", async () => {
    const [head, body, signature] = signedClaims(pair, validClaims()).split(".");
    for (const malformed of [
      `${head}.${body}`,
      `${head}.${body}.${signature}.extra`,
      `${head}..${signature}`,
      `.${body}.${signature}`,
      `${head}+.${body}.${signature}`,
      `${head}.${body}=.${signature}`,
      ` ${head}.${body}.${signature}`
    ]) {
      await expectRejected(malformed, /malformed/);
    }
  });

  it("PINNED: a well-formed token signed by a different key is rejected", async () => {
    await expectRejected(signedClaims(otherPair, validClaims()), /signature is invalid/);
  });

  it("PINNED: required claims must be present with the right primitive types", async () => {
    for (const [key, value] of [
      ["iss", 5],
      ["iss", undefined],
      ["sub", 5],
      ["sub", ""],
      ["sub", "x".repeat(256)],
      ["aud", 5],
      ["aud", []],
      ["aud", [5]],
      ["exp", "soon"],
      ["exp", undefined],
      ["exp", Infinity],
      ["iat", "earlier"],
      ["iat", undefined],
      ["nonce", 5]
    ] as const) {
      const token = signedClaims(pair, validClaims({ [key]: value }));
      await expectRejected(token, /malformed/);
    }
  });

  it("PINNED: printable ASCII subjects pass while non-ASCII is rejected", async () => {
    for (const sub of ["operator@example.test", "op erator", "op~er-42", "x".repeat(255)]) {
      const identity = await verifyIdToken(
        signedClaims(pair, validClaims({ sub })),
        config,
        "nonce-expected",
        undefined, jwks
      );
      assert.equal(identity.subject, sub);
    }
    await expectRejected(signedClaims(pair, validClaims({ sub: "оператор" })), /malformed/);
  });

  it("PINNED: the authorization request sends exact configured parameters with S256 PKCE only", () => {
    const url = new URL(authorizationUrl(config, "state-pin", "nonce-pin", "verifier-pin"));
    assert.equal(url.origin, "https://identity.example.test");
    assert.equal(url.pathname, "/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), config.clientId);
    assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
    assert.equal(url.searchParams.get("scope"), "openid profile email");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const challenge = url.searchParams.get("code_challenge");
    assert.equal(challenge, createCodeChallenge("verifier-pin"));
    assert.notEqual(challenge, "verifier-pin");
    assert.match(challenge ?? "", /^[A-Za-z0-9_-]{43}$/);
  });

  it("PINNED: PKCE verifiers stay within the RFC 7636 character and length bounds", () => {
    const verifier = createOpaqueValue(48);
    assert.equal(verifier.length, 64);
    assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.equal(createCodeChallenge(verifier), createCodeChallenge(verifier));
    assert.notEqual(createCodeChallenge(verifier), verifier);
    assert.equal(new Set([...verifier].map((char) => /[A-Za-z0-9_-]/.test(char))).size, 1);
  });
});

describe("OIDC audit wave 52 — callback and session issuance", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const approvedDevice = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const nonces = new Map<string, string>();
  let identityProvider: Server;
  let identityUrl: string;

  before(async () => {
    identityProvider = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/jwks") {
        response.end(JSON.stringify(jwksFor(pair, "flow-key")));
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
      const header = encode({ alg: "RS256", kid: "flow-key" });
      const claims = encode({
        iss: issuer,
        sub: "operator-52",
        aud: clientId,
        exp: now + 300,
        iat: now,
        nonce,
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

  function serverConfig(deviceBinding?: ServerConfig["deviceBinding"]): ServerConfig {
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
    const bff = createBackofficeServer(serverConfig(deviceBinding));
    const baseUrl = await listen(bff);
    try {
      await run(baseUrl);
    } finally {
      await close(bff);
    }
  }

  async function beginLogin(baseUrl: string): Promise<{ state: string; code: string; cookie: string }> {
    const login = await fetch(`${baseUrl}/bff/auth/login`, { redirect: "manual" });
    assert.equal(login.status, 302);
    const authorize = new URL(login.headers.get("location") ?? "");
    const state = authorize.searchParams.get("state") ?? "";
    const nonce = authorize.searchParams.get("nonce") ?? "";
    assert.ok(state && nonce);
    const code = `code-${state}`;
    nonces.set(code, nonce);
    return { state, code, cookie: `${transactionCookie}=${state}.${nonce}` };
  }

  function assertAuthFailed(response: Response): void {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${origin}/?error=auth_failed`);
    assert.equal(
      response.headers.getSetCookie().some((value) => value.startsWith(`${sessionCookie}=`)),
      false
    );
  }

  it("PINNED: a replayed callback is rejected and never issues a second session", async () => {
    await withBff(undefined, async (baseUrl) => {
      const { state, code, cookie } = await beginLogin(baseUrl);
      const url = `${baseUrl}/bff/auth/callback?code=${code}&state=${state}`;
      const first = await fetch(url, { redirect: "manual", headers: { cookie } });
      assert.equal(first.status, 302);
      assert.ok(
        first.headers.getSetCookie().some((value) => value.startsWith(`${sessionCookie}=`))
      );
      const second = await fetch(url, { redirect: "manual", headers: { cookie } });
      assertAuthFailed(second);
    });
  });

  it("PINNED: an IdP error or unknown state never issues a session", async () => {
    await withBff(undefined, async (baseUrl) => {
      const denied = await fetch(
        `${baseUrl}/bff/auth/callback?error=access_denied&state=x`,
        { redirect: "manual" }
      );
      assertAuthFailed(denied);
      const unknown = await fetch(
        `${baseUrl}/bff/auth/callback?code=c&state=unknown-state`,
        { redirect: "manual", headers: { cookie: `${transactionCookie}=unknown-state` } }
      );
      assertAuthFailed(unknown);
    });
  });

  it("PINNED: the post-auth redirect targets the configured origin only and no token material reaches the browser", async () => {
    await withBff(undefined, async (baseUrl) => {
      const { state, code, cookie } = await beginLogin(baseUrl);
      const callback = await fetch(
        `${baseUrl}/bff/auth/callback?code=${code}&state=${state}`,
        { redirect: "manual", headers: { cookie } }
      );
      assert.equal(callback.status, 302);
      const location = callback.headers.get("location") ?? "";
      assert.equal(location, origin);
      const body = await callback.text();
      for (const marker of [state, code, "id_token", "access_token", "nonce"]) {
        assert.ok(!body.includes(marker), `callback body leaked ${marker}`);
        assert.ok(!location.includes(marker), `redirect leaked ${marker}`);
      }
      const cookies = callback.headers.getSetCookie();
      assert.ok(cookies.some((value) => value.startsWith(`${sessionCookie}=`)));
    });
  });

  it("PINNED: each login mints a fresh state and nonce", async () => {
    await withBff(undefined, async (baseUrl) => {
      const issued = new Set<string>();
      for (let index = 0; index < 8; index += 1) {
        const login = await fetch(`${baseUrl}/bff/auth/login`, { redirect: "manual" });
        const url = new URL(login.headers.get("location") ?? "");
        const pairKey = `${url.searchParams.get("state")}|${url.searchParams.get("nonce")}`;
        assert.ok(!issued.has(pairKey));
        issued.add(pairKey);
      }
      assert.equal(issued.size, 8);
    });
  });

  it("PINNED: a failed upstream exchange yields no session and no token material", async () => {
    await withBff(undefined, async (baseUrl) => {
      const { state, cookie } = await beginLogin(baseUrl);
      const callback = await fetch(
        `${baseUrl}/bff/auth/callback?code=unregistered-code&state=${state}`,
        { redirect: "manual", headers: { cookie } }
      );
      assertAuthFailed(callback);
      const location = callback.headers.get("location") ?? "";
      assert.ok(!location.includes("unregistered-code"));
      assert.ok(!location.includes("id_token"));
    });
  });

  it("PINNED: an unapproved device cannot complete OIDC login when binding is enforced", async () => {
    await withBff(
      { mode: "enforce", approvedDeviceDigests: [deviceDigest(approvedDevice)] },
      async (baseUrl) => {
        const { state, code, cookie } = await beginLogin(baseUrl);
        const callback = await fetch(
          `${baseUrl}/bff/auth/callback?code=${code}&state=${state}`,
          { redirect: "manual", headers: { cookie } }
        );
        assertAuthFailed(callback);
      }
    );
  });
});
