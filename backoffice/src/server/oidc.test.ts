import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
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
          {
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
        verifyIdToken(idToken, config, "nonce-duplicate", { keys }),
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
        { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "critical-key" }] }
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-2", {
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
        verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-inherited", {
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
      { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }] }
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
        { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "test-key" }] }
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
      verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-4", {
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
          {
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

  it("rejects RS256 tokens verified against non-RSA JWKs", async () => {
    const header = encode({ alg: "RS256", kid: "ec-key" });
    const claims = hardeningClaims("nonce-kty");
    for (const namedCurve of ["P-256", "P-384", "secp256k1"]) {
      const pair = generateKeyPairSync("ec", { namedCurve });
      const token = signedToken(header, claims, pair.privateKey);
      const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "ec-key" };
      for (const candidate of [jwk, { ...jwk, alg: "RS256", use: "sig" }, { ...jwk, kty: "RSA" }]) {
        await assert.rejects(
          verifyIdToken(token, config, "nonce-kty", { keys: [candidate] }),
          /signing key is not allowed/
        );
      }
    }
    const ed25519 = generateKeyPairSync("ed25519");
    await assert.rejects(
      verifyIdToken(signedToken(header, claims, ed25519.privateKey, null), config, "nonce-kty", {
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
        verifyIdToken(signedToken(header, claims, weak.privateKey), config, "nonce-rsa", {
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
        verifyIdToken(token, config, "nonce-rsa", { keys: [jwk] }),
        /signing key is not allowed/
      );
    }
    for (const jwks of [{}, { keys: "rsa-key" }, { keys: [null] }]) {
      await assert.rejects(
        verifyIdToken(token, config, "nonce-rsa", jwks as never),
        /JWKS is malformed|signing key was not found/
      );
    }
    const identity = await verifyIdToken(token, config, "nonce-rsa", {
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
        verifyIdToken(`${header}.${claims}.${variant}`, config, "nonce-b64", { keys }),
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
        verifyIdToken(signedToken(nonCanonicalHeader, claims, pair.privateKey), config, "nonce-b64", {
          keys
        }),
        /malformed/
      );
    }
    const oversizedClaims = hardeningClaims("nonce-b64", { padding: "x".repeat(20_000) });
    await assert.rejects(
      verifyIdToken(signedToken(header, oversizedClaims, pair.privateKey), config, "nonce-b64", {
        keys
      }),
      /too large/
    );
    const identity = await verifyIdToken(`${header}.${claims}.${signature}`, config, "nonce-b64", {
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
        verifyIdToken(signedToken(tokenHeader, tokenClaims, pair.privateKey), config, "nonce-json", {
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
      { keys }
    );
    assert.equal(identity.role, "compliance-lead");
  });
});
