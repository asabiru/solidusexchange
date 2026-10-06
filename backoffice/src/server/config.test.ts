import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadServerConfig } from "./config.js";

const configurationEnvironment = [
  "BACKOFFICE_ALLOWED_ORIGINS",
  "BACKOFFICE_AUDIT_STORAGE",
  "BACKOFFICE_AUDIT_RETENTION_DAYS",
  "BACKOFFICE_AUDIT_DATABASE_URL",
  "BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS",
  "BACKOFFICE_STEP_UP_GRANT_TTL_SECONDS",
  "BACKOFFICE_STEP_UP_MAX_ATTEMPTS",
  "BACKOFFICE_SIGNING_ROTATION_SECONDS",
  "BACKOFFICE_SIGNING_RETAINED_KEYS",
  "BACKOFFICE_OIDC_ISSUER",
  "BACKOFFICE_OIDC_AUTHORIZATION_ENDPOINT",
  "BACKOFFICE_OIDC_TOKEN_ENDPOINT",
  "BACKOFFICE_OIDC_JWKS_URI",
  "BACKOFFICE_OIDC_CLIENT_ID",
  "BACKOFFICE_OIDC_CLIENT_SECRET",
  "BACKOFFICE_OIDC_REDIRECT_URI",
  "BACKOFFICE_OIDC_ROLE_CLAIM",
  "BACKOFFICE_OIDC_ROLE_MAP_JSON",
  "BACKOFFICE_DEVICE_BINDING",
  "BACKOFFICE_APPROVED_DEVICE_DIGESTS"
] as const;
const original = Object.fromEntries(
  configurationEnvironment.map((name) => [name, process.env[name]])
);

afterEach(() => {
  for (const name of configurationEnvironment) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configureOidc(baseUrl: string, redirectOrigin: string): void {
  process.env.BACKOFFICE_OIDC_ISSUER = baseUrl;
  process.env.BACKOFFICE_OIDC_AUTHORIZATION_ENDPOINT = `${baseUrl}/authorize`;
  process.env.BACKOFFICE_OIDC_TOKEN_ENDPOINT = `${baseUrl}/token`;
  process.env.BACKOFFICE_OIDC_JWKS_URI = `${baseUrl}/jwks`;
  process.env.BACKOFFICE_OIDC_CLIENT_ID = "solidchange-backoffice";
  delete process.env.BACKOFFICE_OIDC_CLIENT_SECRET;
  process.env.BACKOFFICE_OIDC_REDIRECT_URI =
    `${redirectOrigin}/bff/auth/callback`;
  delete process.env.BACKOFFICE_OIDC_ROLE_CLAIM;
  process.env.BACKOFFICE_OIDC_ROLE_MAP_JSON =
    JSON.stringify({ compliance: "compliance-lead" });
}

describe("audit configuration", () => {
  it("uses an explicit non-durable development default", () => {
    delete process.env.BACKOFFICE_AUDIT_STORAGE;
    delete process.env.BACKOFFICE_AUDIT_DATABASE_URL;
    const config = loadServerConfig();
    assert.equal(config.audit.storage, "memory");
    assert.equal(config.audit.retentionDays, 2_555);
    assert.deepEqual(config.stepUp, {
      provider: "synthetic-dev",
      challengeTtlSeconds: 300,
      grantTtlSeconds: 60,
      maxAttempts: 3
    });
    assert.deepEqual(config.signing, {
      backend: "ephemeral-dev",
      rotationSeconds: 900,
      retainedVerificationKeys: 2
    });
  });

  it("requires a PostgreSQL URL when durable storage is selected", () => {
    process.env.BACKOFFICE_AUDIT_STORAGE = "postgresql";
    delete process.env.BACKOFFICE_AUDIT_DATABASE_URL;
    assert.throws(
      () => loadServerConfig(),
      /BACKOFFICE_AUDIT_DATABASE_URL is required/
    );
  });

  it("rejects unsupported storage and retention policy", () => {
    process.env.BACKOFFICE_AUDIT_STORAGE = "filesystem";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_AUDIT_STORAGE/);
    process.env.BACKOFFICE_AUDIT_STORAGE = "memory";
    process.env.BACKOFFICE_AUDIT_RETENTION_DAYS = "0";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_AUDIT_RETENTION_DAYS/);
  });

  it("rejects unsafe step-up lifecycle settings", () => {
    process.env.BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS = "29";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS/);
    delete process.env.BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS;
    process.env.BACKOFFICE_STEP_UP_MAX_ATTEMPTS = "6";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_STEP_UP_MAX_ATTEMPTS/);
  });

  it("rejects unsafe signing lifecycle settings", () => {
    process.env.BACKOFFICE_SIGNING_ROTATION_SECONDS = "59";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_SIGNING_ROTATION_SECONDS/);
    delete process.env.BACKOFFICE_SIGNING_ROTATION_SECONDS;
    process.env.BACKOFFICE_SIGNING_RETAINED_KEYS = "0";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_SIGNING_RETAINED_KEYS/);
  });

  it("rejects public plaintext and mixed session origins", () => {
    process.env.BACKOFFICE_ALLOWED_ORIGINS = "http://operators.example.test";
    assert.throws(
      () => loadServerConfig(),
      /permits HTTP only for loopback origins/
    );

    process.env.BACKOFFICE_ALLOWED_ORIGINS =
      "http://127.0.0.1:4173,https://operators.example.test";
    assert.throws(
      () => loadServerConfig(),
      /must not mix HTTP and HTTPS origins/
    );
  });

  it("accepts one loopback HTTP or HTTPS session boundary", () => {
    process.env.BACKOFFICE_ALLOWED_ORIGINS =
      "http://127.0.0.1:4173,http://localhost:4173";
    assert.deepEqual(loadServerConfig().allowedOrigins, [
      "http://127.0.0.1:4173",
      "http://localhost:4173"
    ]);

    process.env.BACKOFFICE_ALLOWED_ORIGINS =
      "https://operators.example.test,https://audit.example.test";
    assert.deepEqual(loadServerConfig().allowedOrigins, [
      "https://operators.example.test",
      "https://audit.example.test"
    ]);
  });
});

describe("OIDC configuration", () => {
  it("accepts HTTPS identity endpoints on the configured callback boundary", () => {
    const operatorOrigin = "https://operators.example.test";
    process.env.BACKOFFICE_ALLOWED_ORIGINS = operatorOrigin;
    configureOidc("https://identity.example.test", operatorOrigin);

    assert.deepEqual(loadServerConfig().oidc, {
      issuer: "https://identity.example.test",
      authorizationEndpoint: "https://identity.example.test/authorize",
      tokenEndpoint: "https://identity.example.test/token",
      jwksUri: "https://identity.example.test/jwks",
      clientId: "solidchange-backoffice",
      clientSecret: "",
      redirectUri: `${operatorOrigin}/bff/auth/callback`,
      roleClaim: "groups",
      roleMap: { compliance: "compliance-lead" }
    });
  });

  it("permits plaintext OIDC only inside a loopback development boundary", () => {
    const operatorOrigin = "http://127.0.0.1:4173";
    process.env.BACKOFFICE_ALLOWED_ORIGINS = operatorOrigin;
    configureOidc("http://localhost:5556", operatorOrigin);

    assert.equal(
      loadServerConfig().oidc?.tokenEndpoint,
      "http://localhost:5556/token"
    );

    process.env.BACKOFFICE_OIDC_TOKEN_ENDPOINT =
      "http://identity.example.test/token";
    assert.throws(
      () => loadServerConfig(),
      /BACKOFFICE_OIDC_TOKEN_ENDPOINT must use HTTPS/
    );

    const publicOperatorOrigin = "https://operators.example.test";
    process.env.BACKOFFICE_ALLOWED_ORIGINS = publicOperatorOrigin;
    configureOidc("https://identity.example.test", publicOperatorOrigin);
    process.env.BACKOFFICE_OIDC_TOKEN_ENDPOINT = "http://localhost:5556/token";
    assert.throws(
      () => loadServerConfig(),
      /BACKOFFICE_OIDC_TOKEN_ENDPOINT must use HTTPS/
    );
  });

  it("rejects callbacks outside the configured session origin and path", () => {
    const operatorOrigin = "https://operators.example.test";
    process.env.BACKOFFICE_ALLOWED_ORIGINS = operatorOrigin;
    configureOidc("https://identity.example.test", operatorOrigin);

    process.env.BACKOFFICE_OIDC_REDIRECT_URI =
      "https://untrusted.example.test/bff/auth/callback";
    assert.throws(
      () => loadServerConfig(),
      /exact \/bff\/auth\/callback URL on an allowed origin/
    );

    process.env.BACKOFFICE_OIDC_REDIRECT_URI =
      `${operatorOrigin}/different/callback`;
    assert.throws(
      () => loadServerConfig(),
      /exact \/bff\/auth\/callback URL on an allowed origin/
    );
  });
});

describe("operator device binding configuration", () => {
  const digest = "a".repeat(64);

  it("defaults to off without approved devices", () => {
    delete process.env.BACKOFFICE_DEVICE_BINDING;
    delete process.env.BACKOFFICE_APPROVED_DEVICE_DIGESTS;
    assert.deepEqual(loadServerConfig().deviceBinding, {
      mode: "off",
      approvedDeviceDigests: []
    });
  });

  it("loads approved device digests when enforced", () => {
    process.env.BACKOFFICE_DEVICE_BINDING = "enforce";
    process.env.BACKOFFICE_APPROVED_DEVICE_DIGESTS = ` ${digest}, ${"b".repeat(64)} `;
    assert.deepEqual(loadServerConfig().deviceBinding, {
      mode: "enforce",
      approvedDeviceDigests: [digest, "b".repeat(64)]
    });
  });

  it("allows enforcement with no approved devices, denying every login", () => {
    process.env.BACKOFFICE_DEVICE_BINDING = "enforce";
    delete process.env.BACKOFFICE_APPROVED_DEVICE_DIGESTS;
    assert.deepEqual(loadServerConfig().deviceBinding?.approvedDeviceDigests, []);
  });

  it("rejects unknown modes, malformed or duplicate digests and unused approvals", () => {
    const cases: readonly [string | undefined, string, RegExp][] = [
      ["required", "", /BACKOFFICE_DEVICE_BINDING must be off or enforce/],
      ["enforce", digest.toUpperCase(), /lowercase SHA-256 digests/],
      ["enforce", "a".repeat(63), /lowercase SHA-256 digests/],
      ["enforce", `${digest},${digest}`, /must not contain duplicates/],
      [undefined, digest, /requires BACKOFFICE_DEVICE_BINDING=enforce/]
    ];
    for (const [mode, digests, message] of cases) {
      if (mode === undefined) delete process.env.BACKOFFICE_DEVICE_BINDING;
      else process.env.BACKOFFICE_DEVICE_BINDING = mode;
      process.env.BACKOFFICE_APPROVED_DEVICE_DIGESTS = digests;
      assert.throws(() => loadServerConfig(), message);
    }
  });
});

describe("runtime boundary", () => {
  function withEnvironment(values: Readonly<Record<string, string>>, check: () => void): void {
    const saved = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
    try {
      Object.assign(process.env, values);
      check();
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it("refuses NODE_ENV=production in any casing or padding", () => {
    for (const value of ["production", " Production ", "PRODUCTION"]) {
      withEnvironment({ NODE_ENV: value }, () => {
        assert.throws(() => loadServerConfig(), /refuses NODE_ENV=production/);
      });
    }
    withEnvironment({ NODE_ENV: "development" }, () => {
      assert.equal(loadServerConfig().host, "127.0.0.1");
    });
  });

  it("binds only to loopback hosts", () => {
    for (const host of ["0.0.0.0", "::", "192.0.2.10", "example.test", ""]) {
      withEnvironment({ BACKOFFICE_BFF_HOST: host }, () => {
        assert.throws(() => loadServerConfig(), /BACKOFFICE_BFF_HOST must be a loopback address/);
      });
    }
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      withEnvironment({ BACKOFFICE_BFF_HOST: host }, () => {
        assert.equal(loadServerConfig().host, host);
      });
    }
  });
});
