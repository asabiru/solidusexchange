import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import {
  type OidcIssuer,
  type OidcRequest,
  createOidcIssuer
} from "@solidchange/provider-simulators";
import type { OidcConfig, ServerConfig } from "./config.js";
import {
  authorizationUrl,
  createCodeChallenge,
  exchangeAuthorizationCode,
  verifyIdToken
} from "./oidc.js";
import { customerApiSubject } from "./customer-api-client.js";
import { createBackofficeServer } from "./server.js";

const config: OidcConfig = {
  issuer: "https://identity.example.test",
  authorizationEndpoint: "https://identity.example.test/authorize",
  tokenEndpoint: "https://identity.example.test/token",
  jwksUri: "https://identity.example.test/jwks",
  clientId: "solidchange-backoffice",
  redirectUri: "https://operators.example.test/bff/auth/callback",
  roleClaim: "groups",
  roleMap: {
    compliance: "compliance-lead"
  }
};

const origin = "http://127.0.0.1:4173";
const clientId = "solidchange-backoffice";
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

function oidcConfigFor(issuerBase: string): ServerConfig & { oidc: OidcConfig } {
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
    oidc: {
      issuer: issuerBase,
      authorizationEndpoint: `${issuerBase}/authorize`,
      tokenEndpoint: `${issuerBase}/token`,
      jwksUri: `${issuerBase}/.well-known/jwks.json`,
      clientId,
      redirectUri: `${origin}/bff/auth/callback`,
      roleClaim: "groups",
      roleMap: { compliance: "compliance-lead" }
    }
  };
}

async function startIssuer(
  issuerConfig: Partial<Parameters<typeof createOidcIssuer>[0]> = {}
): Promise<{ issuer: OidcIssuer; issuerBase: string; clock: { value: number; now(): number } }> {
  // The BFF verifies exp/iat against wall time, so the issuer clock anchors
  // on real time too (tests move it only for TTL checks).
  const clock = { value: Math.floor(Date.now() / 1_000), now() { return this.value; } };
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
    defaultSubject: "operator-42",
    idTokenClaims: {
      groups: ["compliance"],
      email: "operator@example.test",
      name: "Dev Operator"
    },
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
  const server = createBackofficeServer(serverConfig);
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
  return headerCookies(response, "solidchange_bo_session")[0];
}

function txCookieOf(response: Response): string | undefined {
  return headerCookies(response, "solidchange_bo_oidc_transaction")[0];
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function encodeJson(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function signedToken(
  header: string,
  claims: string,
  privateKey: KeyObject,
  algorithm: string | null = "RSA-SHA256"
): string {
  const signature = sign(algorithm, Buffer.from(`${header}.${claims}`), privateKey);
  return `${header}.${claims}.${signature.toString("base64url")}`;
}

function hardeningClaims(nonce: string, extra: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return encode({
    iss: config.issuer,
    sub: "operator-60",
    aud: config.clientId,
    exp: now + 300,
    iat: now,
    nonce,
    groups: ["compliance"],
    ...extra
  });
}

describe("OIDC boundary", () => {
  it("builds an authorization-code request with PKCE and nonce", () => {
    const url = new URL(authorizationUrl(config, "state-1", "nonce-1", "verifier-1"));
    assert.equal(url.origin, "https://identity.example.test");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "state-1");
    assert.equal(url.searchParams.get("nonce"), "nonce-1");
    assert.equal(url.searchParams.get("code_challenge"), createCodeChallenge("verifier-1"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });

  it("verifies RS256 identity claims and maps the role server-side", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-42",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-1",
      email: "operator@example.test",
      name: "Test Operator",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    const identity = await verifyIdToken(
      `${header}.${claims}.${signature}`,
      config,
      "nonce-1",
      undefined, {
        keys: [
          {
            ...pair.publicKey.export({ format: "jwk" }),
            kid: "test-key"
          }
        ]
      }
    );
    assert.deepEqual(identity, {
      subject: "operator-42",
      email: "operator@example.test",
      name: "Test Operator",
      role: "compliance-lead"
    });
  });

  it("rejects subject identifiers outside the OIDC ASCII and length limits", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "subject-key" });
    const now = Math.floor(Date.now() / 1000);

    for (const subject of ["opérateur", "a".repeat(256)]) {
      const claims = encode({
        iss: config.issuer,
        sub: subject,
        aud: config.clientId,
        exp: now + 300,
        iat: now,
        nonce: "nonce-subject",
        groups: ["compliance"]
      });
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        pair.privateKey
      ).toString("base64url");

      await assert.rejects(
        verifyIdToken(
          `${header}.${claims}.${signature}`,
          config,
          "nonce-subject",
          undefined, {
            keys: [
              {
                ...pair.publicKey.export({ format: "jwk" }),
                kid: "subject-key"
              }
            ]
          }
        ),
        /token claims are malformed/
      );
    }
  });

  it("rejects duplicate signing keys with the same kid regardless of JWKS order", async () => {
    const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "duplicate-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-duplicate",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-duplicate",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      signer.privateKey
    ).toString("base64url");
    const idToken = `${header}.${claims}.${signature}`;
    const signerJwk = {
      ...signer.publicKey.export({ format: "jwk" }),
      kid: "duplicate-key"
    };
    const otherJwk = {
      ...other.publicKey.export({ format: "jwk" }),
      kid: "duplicate-key"
    };

    for (const keys of [[signerJwk, otherJwk], [otherJwk, signerJwk]]) {
      await assert.rejects(
        verifyIdToken(idToken, config, "nonce-duplicate", undefined, { keys }),
        /signing key is ambiguous/
      );
    }
  });

  it("rejects unsupported critical protected header parameters", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({
      alg: "RS256",
      kid: "critical-key",
      crit: ["tenant"],
      tenant: "operators"
    });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-critical",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-critical",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(
        `${header}.${claims}.${signature}`,
        config,
        "nonce-critical",
        undefined, { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "critical-key" }] }
      ),
      /critical protected header parameters are not supported/
    );
  });

  it("rejects identities without an approved role mapping", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-43",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-2",
      groups: ["unknown"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-2", undefined, {
        keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }]
      }),
      /no mapped backoffice role/
    );
  });

  it("ignores inherited object properties when mapping roles", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const inheritedNames = [
      "constructor",
      "__proto__",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "__defineGetter__",
      "__lookupGetter__"
    ];

    for (const groups of [...inheritedNames.map((name) => [name]), "constructor"]) {
      const claims = encode({
        iss: config.issuer,
        sub: "operator-inherited",
        aud: config.clientId,
        exp: now + 300,
        iat: now,
        nonce: "nonce-inherited",
        groups
      });
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        pair.privateKey
      ).toString("base64url");

      await assert.rejects(
        verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-inherited", undefined, {
          keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }]
        }),
        /no mapped backoffice role/,
        JSON.stringify(groups)
      );
    }

    const claims = encode({
      iss: config.issuer,
      sub: "operator-inherited",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-inherited",
      groups: ["constructor", "compliance", "toString"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");
    const identity = await verifyIdToken(
      `${header}.${claims}.${signature}`,
      config,
      "nonce-inherited",
      undefined, { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }] }
    );
    assert.equal(identity.role, "compliance-lead");
  });

  it("rejects identities mapped to multiple operator roles", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-ambiguous",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-ambiguous",
      groups: ["compliance", "support"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(
        `${header}.${claims}.${signature}`,
        {
          ...config,
          roleMap: {
            compliance: "compliance-lead",
            support: "support-l1"
          }
        },
        "nonce-ambiguous",
        undefined, { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }] }
      ),
      /ambiguous backoffice roles/
    );
  });

  it("rejects multi-audience tokens without this client as azp", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-44",
      aud: [config.clientId, "another-client"],
      exp: now + 300,
      iat: now,
      nonce: "nonce-3",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-3", undefined, {
        keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }]
      }),
      /authorized party mismatch/
    );
  });

  it("rejects single-audience tokens naming another authorized party", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-azp-mismatch",
      aud: config.clientId,
      azp: "another-client",
      exp: now + 300,
      iat: now,
      nonce: "nonce-azp-mismatch",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(
        `${header}.${claims}.${signature}`,
        config,
        "nonce-azp-mismatch",
        undefined, { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }] }
      ),
      /authorized party mismatch/
    );
  });

  it("rejects tokens before their not-before time", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-45",
      aud: config.clientId,
      exp: now + 600,
      iat: now,
      nbf: now + 300,
      nonce: "nonce-4",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-4", undefined, {
        keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }]
      }),
      /token claims are not valid/
    );
  });

  it("rejects signed tokens with malformed or future NumericDate claims", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "numeric-date-key" });
    const now = Math.floor(Date.now() / 1000);
    const commonClaims = `"iss":"${config.issuer}","aud":"${config.clientId}",`
      + `"groups":["compliance"]`;
    const cases = [
      {
        nonce: "nonce-exp-infinite",
        claims: `{"sub":"operator-exp-infinite",${commonClaims},`
          + `"exp":1e400,"iat":${now},"nonce":"nonce-exp-infinite"}`,
        error: /token claims are malformed/
      },
      {
        nonce: "nonce-iat-infinite",
        claims: `{"sub":"operator-iat-infinite",${commonClaims},`
          + `"exp":${now + 300},"iat":-1e400,"nonce":"nonce-iat-infinite"}`,
        error: /token claims are malformed/
      },
      {
        nonce: "nonce-nbf-infinite",
        claims: `{"sub":"operator-nbf-infinite",${commonClaims},`
          + `"exp":${now + 300},"iat":${now},"nbf":-1e400,`
          + `"nonce":"nonce-nbf-infinite"}`,
        error: /token claims are not valid/
      },
      {
        nonce: "nonce-iat-future",
        claims: `{"sub":"operator-iat-future",${commonClaims},`
          + `"exp":${now + 300},"iat":${now + 61},"nonce":"nonce-iat-future"}`,
        error: /token claims are not valid/
      }
    ];

    for (const entry of cases) {
      const claims = encodeJson(entry.claims);
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        pair.privateKey
      ).toString("base64url");

      await assert.rejects(
        verifyIdToken(
          `${header}.${claims}.${signature}`,
          config,
          entry.nonce,
          undefined, {
            keys: [
              {
                ...pair.publicKey.export({ format: "jwk" }),
                kid: "numeric-date-key"
              }
            ]
          }
        ),
        entry.error
      );
    }
  });

  it("rejects a signed token from a JWK reserved for encryption", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "encryption-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-46",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-5",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-5", undefined, {
        keys: [
          {
            ...pair.publicKey.export({ format: "jwk" }),
            kid: "encryption-key",
            use: "enc"
          }
        ]
      }),
      /signing key is not allowed/
    );
  });

  it("rejects an RS256 token when the selected JWK declares another algorithm", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "ps256-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-47",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-6",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-6", undefined, {
        keys: [
          {
            ...pair.publicKey.export({ format: "jwk" }),
            kid: "ps256-key",
            alg: "PS256"
          }
        ]
      }),
      /signing key is not allowed/
    );
  });

  it("rejects a signed token when the selected JWK excludes verification", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encode({ alg: "RS256", kid: "sign-only-key" });
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({
      iss: config.issuer,
      sub: "operator-48",
      aud: config.clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-7",
      groups: ["compliance"]
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      pair.privateKey
    ).toString("base64url");

    await assert.rejects(
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-7", undefined, {
        keys: [
          {
            ...pair.publicKey.export({ format: "jwk" }),
            kid: "sign-only-key",
            use: "sig",
            alg: "RS256",
            key_ops: ["sign"]
          }
        ]
      }),
      /signing key is not allowed/
    );
  });

  it("rejects RS256 tokens verified against non-RSA JWKs", async () => {
    const header = encode({ alg: "RS256", kid: "ec-key" });
    const claims = hardeningClaims("nonce-kty");
    for (const namedCurve of ["P-256", "P-384", "secp256k1"]) {
      const pair = generateKeyPairSync("ec", { namedCurve });
      const token = signedToken(header, claims, pair.privateKey);
      const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "ec-key" };
      for (const candidate of [jwk, { ...jwk, alg: "RS256", use: "sig" }, { ...jwk, kty: "RSA" }]) {
        await assert.rejects(
          verifyIdToken(token, config, "nonce-kty", undefined, { keys: [candidate] }),
          /signing key is not allowed/
        );
      }
    }
    const ed25519 = generateKeyPairSync("ed25519");
    await assert.rejects(
      verifyIdToken(signedToken(header, claims, ed25519.privateKey, null), config, "nonce-kty", undefined, {
        keys: [{ ...ed25519.publicKey.export({ format: "jwk" }), kid: "ec-key" }]
      }),
      /signing key is not allowed/
    );
  });

  it("rejects weak RSA JWKs, private JWK members and extra key operations", async () => {
    const header = encode({ alg: "RS256", kid: "rsa-key" });
    const claims = hardeningClaims("nonce-rsa");
    for (const modulusLength of [512, 1024, 2040]) {
      const weak = generateKeyPairSync("rsa", { modulusLength });
      await assert.rejects(
        verifyIdToken(signedToken(header, claims, weak.privateKey), config, "nonce-rsa", undefined, {
          keys: [{ ...weak.publicKey.export({ format: "jwk" }), kid: "rsa-key" }]
        }),
        /signing key is not allowed/
      );
    }
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = signedToken(header, claims, pair.privateKey);
    const publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "rsa-key" };
    for (const jwk of [
      { ...pair.privateKey.export({ format: "jwk" }), kid: "rsa-key" },
      { ...publicJwk, key_ops: ["verify", "encrypt"] },
      { ...publicJwk, key_ops: ["verify", "verify"] }
    ]) {
      await assert.rejects(
        verifyIdToken(token, config, "nonce-rsa", undefined, { keys: [jwk] }),
        /signing key is not allowed/
      );
    }
    for (const jwks of [{}, { keys: "rsa-key" }, { keys: [null] }]) {
      await assert.rejects(
        verifyIdToken(token, config, "nonce-rsa", undefined, jwks as never),
        /JWKS is malformed|signing key was not found/
      );
    }
    const identity = await verifyIdToken(token, config, "nonce-rsa", undefined, {
      keys: [null as never, { ...publicJwk, use: "sig", alg: "RS256", key_ops: ["verify"] }]
    });
    assert.equal(identity.role, "compliance-lead");
  });

  it("rejects non-canonical base64url segments and oversized tokens", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keys = [{ ...pair.publicKey.export({ format: "jwk" }), kid: "b64-key" }];
    const header = encode({ alg: "RS256", kid: "b64-key" });
    const claims = hardeningClaims("nonce-b64");
    const signature = signedToken(header, claims, pair.privateKey).split(".")[2];
    const flippedLast = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    for (const variant of [
      `${signature}=`,
      `${signature}==`,
      `${signature.slice(0, 8)}!${signature.slice(8)}`,
      `${signature.slice(0, 8)} ${signature.slice(8)}`,
      `${signature.slice(0, 8)}+/${signature.slice(8)}`,
      flippedLast
    ]) {
      await assert.rejects(
        verifyIdToken(`${header}.${claims}.${variant}`, config, "nonce-b64", undefined, { keys }),
        /malformed|signature is invalid/
      );
    }
    const headerJson = '{"alg":"RS256","kid":"b64-key","x":"??>"}';
    for (const nonCanonicalHeader of [
      `${encodeJson('{"alg":"RS256","kid":"b64-key"}')}=`,
      Buffer.from(headerJson).toString("base64"),
      `${encodeJson(headerJson).slice(0, -1)}${encodeJson(headerJson).endsWith("A") ? "B" : "A"}`
    ]) {
      await assert.rejects(
        verifyIdToken(signedToken(nonCanonicalHeader, claims, pair.privateKey), config, "nonce-b64", undefined, {
          keys
        }),
        /malformed/
      );
    }
    const oversizedClaims = hardeningClaims("nonce-b64", { padding: "x".repeat(20_000) });
    await assert.rejects(
      verifyIdToken(signedToken(header, oversizedClaims, pair.privateKey), config, "nonce-b64", undefined, {
        keys
      }),
      /too large/
    );
    const identity = await verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-b64", undefined, {
      keys
    });
    assert.equal(identity.role, "compliance-lead");
  });

  it("rejects duplicate JSON members, invalid UTF-8 and key-carrying headers", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keys = [{ ...pair.publicKey.export({ format: "jwk" }), kid: "json-key" }];
    const now = Math.floor(Date.now() / 1000);
    const common = [
      `"iss":"${config.issuer}"`,
      `"aud":"${config.clientId}"`,
      `"exp":${now + 300}`,
      `"iat":${now}`,
      '"nonce":"nonce-json"'
    ].join(",");
    const header = encode({ alg: "RS256", kid: "json-key" });
    const claims = encodeJson(`{${common},"sub":"op","groups":["compliance"]}`);
    const cases: [string, string][] = [
      [encodeJson('{"alg":"none","alg":"RS256","kid":"json-key"}'), claims],
      [encodeJson('{"alg":"RS256","kid":"other","kid":"json-key"}'), claims],
      [encodeJson('\ufeff{"alg":"RS256","kid":"json-key"}'), claims],
      [header, encodeJson(`{${common},"sub":"a","sub":"op","groups":["compliance"]}`)],
      [header, encodeJson(`{${common},"sub":"op","groups":["x"],"groups":["compliance"]}`)],
      [header, encodeJson(`{${common},"sub":"op","\\u0067roups":["x"],"groups":["compliance"]}`)],
      [header, encodeJson(`{${common},"sub":"op","groups":["compliance"],"x":{"a":1,"a" : 2}}`)],
      [
        header,
        Buffer.concat([
          Buffer.from(`{${common},"sub":"op","groups":["compliance"],"name":"`),
          Buffer.from([0xff]),
          Buffer.from('"}')
        ]).toString("base64url")
      ]
    ];
    for (const name of ["jku", "jwk", "x5u", "x5c", "b64"]) {
      const value = name === "b64" ? false : "https://attacker.example.test/keys";
      cases.push([encode({ alg: "RS256", kid: "json-key", [name]: value }), claims]);
    }
    for (const [tokenHeader, tokenClaims] of cases) {
      await assert.rejects(
        verifyIdToken(signedToken(tokenHeader, tokenClaims, pair.privateKey), config, "nonce-json", undefined, {
          keys
        }),
        /malformed|duplicate JSON members|header parameter is not supported/
      );
    }
    const allowedClaims = encodeJson(
      `{${common},"sub":"op","groups":["compliance"],"n":[{"a":1},{"a":2}],"s":"\\"a\\":1"}`
    );
    const identity = await verifyIdToken(
      signedToken(
        encode({ alg: "RS256", kid: "json-key", typ: "JWT", x5t: "thumbprint" }),
        allowedClaims,
        pair.privateKey
      ),
      config,
      "nonce-json",
      undefined, { keys }
    );
    assert.equal(identity.role, "compliance-lead");
  });
});

describe("oidc exchange and verification against the dev issuer", () => {
  it("exchanges a code once for an identity with the mapped role and at_hash", async () => {
    const { issuerBase } = await startIssuer();
    const cfg = oidcConfigFor(issuerBase).oidc;
    const authorize = new URL(authorizationUrl(cfg, "state-1", "nonce-1", "v".repeat(64)));
    const grant = await fetch(authorize, { redirect: "manual" });
    assert.equal(grant.status, 302);
    const code = new URL(grant.headers.get("location") ?? "").searchParams.get("code");
    assert.ok(code);

    const exchange = await exchangeAuthorizationCode(cfg, code, "v".repeat(64));
    assert.ok(exchange.idToken);
    assert.ok(exchange.accessToken);
    const identity = await verifyIdToken(
      exchange.idToken,
      cfg,
      "nonce-1",
      exchange.accessToken
    );
    assert.equal(identity.subject, "operator-42");
    assert.equal(identity.role, "compliance-lead");
    assert.equal(identity.email, "operator@example.test");

    // The authorization code is single-use.
    await assert.rejects(exchangeAuthorizationCode(cfg, code, "v".repeat(64)));
  });

  it("rejects the exchange on wrong verifier, expired code, and bad form fields", async () => {
    const { issuerBase, clock } = await startIssuer();
    const cfg = oidcConfigFor(issuerBase).oidc;
    const codeFor = async (state: string): Promise<string> => {
      const authorize = new URL(authorizationUrl(cfg, state, "nonce-x", "v".repeat(64)));
      const grant = await fetch(authorize, { redirect: "manual" });
      const code = new URL(grant.headers.get("location") ?? "").searchParams.get("code");
      assert.ok(code);
      return code;
    };

    const first = await codeFor("s-1");
    await assert.rejects(exchangeAuthorizationCode(cfg, first, "w".repeat(64)));

    const second = await codeFor("s-2");
    clock.value += 121;
    await assert.rejects(exchangeAuthorizationCode(cfg, second, "v".repeat(64)));

    await assert.rejects(exchangeAuthorizationCode(cfg, "cod_missing", "v".repeat(64)));
  });

  it("rejects non-POST verbs, wrong grant type and non-form bodies on the token endpoint", async () => {
    const { issuerBase } = await startIssuer();
    assert.equal((await fetch(`${issuerBase}/token`)).status, 405);
    const wrongGrant = await fetch(`${issuerBase}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=password&code=x"
    });
    assert.equal(wrongGrant.status, 400);
    const noType = await fetch(`${issuerBase}/token`, {
      method: "POST",
      body: "grant_type=authorization_code&code=x"
    });
    assert.equal(noType.status, 400);
  });

  it("rejects wrong nonce, foreign signature and a mismatched at_hash", async () => {
    const { issuerBase } = await startIssuer();
    const cfg = oidcConfigFor(issuerBase).oidc;
    const authorize = new URL(authorizationUrl(cfg, "state-1", "nonce-1", "v".repeat(64)));
    const grant = await fetch(authorize, { redirect: "manual" });
    const code = new URL(grant.headers.get("location") ?? "").searchParams.get("code");
    assert.ok(code);
    const exchange = await exchangeAuthorizationCode(cfg, code, "v".repeat(64));

    // Real token, wrong expected nonce.
    await assert.rejects(verifyIdToken(exchange.idToken, cfg, "nonce-2", exchange.accessToken));
    // at_hash fails closed when the presented access token differs or is absent.
    await assert.rejects(verifyIdToken(exchange.idToken, cfg, "nonce-1", "acc_other"));
    await assert.rejects(verifyIdToken(exchange.idToken, cfg, "nonce-1"));

    // A token minted by a foreign key never verifies against the issuer JWKS.
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "x" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: issuerBase,
      sub: "operator-42",
      aud: clientId,
      exp: now + 300,
      iat: now,
      nonce: "nonce-1",
      groups: ["compliance"]
    })).toString("base64url");
    const forged = `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), attacker.privateKey).toString("base64url")}`;
    await assert.rejects(verifyIdToken(forged, cfg, "nonce-1"));
  });
});

describe("oidc login routes", () => {
  async function bffLogin(base: string, cookie?: string): Promise<Response> {
    return fetch(`${base}/bff/auth/login`, {
      redirect: "manual",
      headers: cookie ? { cookie } : {}
    });
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

  it("serves 404 for auth routes when the env pair is unset", async () => {
    const { base } = await startBff(oidcConfigFor("http://127.0.0.1:9"));
    const unconfigured = oidcConfigFor("http://127.0.0.1:9");
    delete (unconfigured as { oidc?: unknown }).oidc;
    const { base: silent } = await startBff(unconfigured);
    assert.equal((await bffLogin(silent)).status, 404);
    assert.equal(
      (await fetch(`${silent}/bff/auth/callback?code=x&state=y`, { redirect: "manual" })).status,
      404
    );
    assert.equal((await bffLogin(base)).status, 302);
  });

  it("drives the full login flow to a session cookie and an operator profile", async () => {
    const { issuerBase } = await startIssuer();
    const { base } = await startBff(oidcConfigFor(issuerBase));

    const login = await bffLogin(base);
    assert.equal(login.status, 302);
    const authorize = new URL(login.headers.get("location") ?? "");
    assert.equal(authorize.origin + authorize.pathname, `${issuerBase}/authorize`);
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorize.searchParams.get("scope"), "openid profile email");
    const tx = txCookieOf(login);
    assert.ok(tx);
    assert.match(tx, /HttpOnly/);
    assert.match(tx, /SameSite=Lax/);
    assert.match(tx, /Path=\/bff\/auth/);
    assert.match(tx, /Max-Age=600/);

    const { response: callback } = await callbackLocation(base, login);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), origin);
    const session = sessionCookieOf(callback);
    assert.ok(session);

    const profile = await fetch(`${base}/bff/api/session`, {
      headers: { cookie: session.split(";")[0] }
    });
    assert.equal(profile.status, 200);
    const envelope = await profile.json() as {
      payload: { operator: { subject: string; role: string; email: string } };
    };
    // The session is minted for the pseudonymized `syn_oper_*` principal,
    // never the raw IdP `sub`.
    assert.equal(envelope.payload.operator.subject, customerApiSubject("operator-42"));
    assert.match(envelope.payload.operator.subject, /^syn_oper_[0-9a-f]{24}$/);
    assert.equal(envelope.payload.operator.role, "compliance-lead");
    assert.equal(envelope.payload.operator.email, "operator@example.test");
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
        headers: { cookie: "solidchange_bo_oidc_transaction=foreign.foreign" }
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

  it("fails closed when the issuer grants no mappable role", async () => {
    const { issuerBase } = await startIssuer({ idTokenClaims: { groups: ["nobody"] } });
    const { base } = await startBff(oidcConfigFor(issuerBase));
    const login = await bffLogin(base);
    const { response: callback } = await callbackLocation(base, login);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("location"), `${origin}/?error=auth_failed`);
    assert.equal(sessionCookieOf(callback), undefined);
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

    const second = await bffLogin(base, firstTx);
    const secondTx = (txCookieOf(second) ?? "").split(";")[0];
    await bffLogin(base, secondTx);

    const oldest = await fetch(`${base}${firstCallback.pathname}${firstCallback.search}`, {
      redirect: "manual",
      headers: { cookie: firstTx }
    });
    assert.equal(oldest.status, 302);
    assert.equal(oldest.headers.get("location"), `${origin}/?error=auth_failed`);
  });
});
