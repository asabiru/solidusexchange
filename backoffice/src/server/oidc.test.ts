import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import type { OidcConfig } from "./config.js";
import { authorizationUrl, createCodeChallenge, verifyIdToken } from "./oidc.js";

const config: OidcConfig = {
  issuer: "https://identity.example.test",
  authorizationEndpoint: "https://identity.example.test/authorize",
  tokenEndpoint: "https://identity.example.test/token",
  jwksUri: "https://identity.example.test/jwks",
  clientId: "solidchange-backoffice",
  clientSecret: "",
  redirectUri: "https://operators.example.test/bff/auth/callback",
  roleClaim: "groups",
  roleMap: {
    compliance: "compliance-lead"
  }
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
      {
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-2", {
        keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }]
      }),
      /no mapped backoffice role/
    );
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
        { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }] }
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-3", {
        keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }]
      }),
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-4", {
        keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }]
      }),
      /token claims are not valid/
    );
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-5", {
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-6", {
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-7", {
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
});
