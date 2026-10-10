import type { OperatorRole } from "../auth/access.js";
import { type ObservabilityConfig, logModes, metricsModes } from "./observability.js";

export interface OidcConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  roleClaim: string;
  roleMap: Readonly<Record<string, OperatorRole>>;
}

export interface AuditConfig {
  storage: "memory" | "postgresql";
  retentionDays: number;
  databaseUrl?: string;
}

export interface StepUpConfig {
  provider: "synthetic-dev";
  challengeTtlSeconds: number;
  grantTtlSeconds: number;
  maxAttempts: number;
}

export interface SigningConfig {
  backend: "ephemeral-dev";
  rotationSeconds: number;
  retainedVerificationKeys: number;
}

export interface DeviceBindingConfig {
  mode: "off" | "enforce";
  approvedDeviceDigests: readonly string[];
}

export interface ServerConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  allowDevLogin: boolean;
  sessionTtlSeconds: number;
  audit: AuditConfig;
  stepUp: StepUpConfig;
  signing: SigningConfig;
  deviceBinding?: DeviceBindingConfig;
  oidc?: OidcConfig;
  customerApiUrl?: string;
  customerApiDevTokenKey?: string;
  observability?: ObservabilityConfig;
}

const roles = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "fraud-investigator",
  "auditor"
]);

const devTokenKeyPattern = /^[0-9a-f]{64}$/;

function requiredOidcValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseRoleMap(value: string | undefined): Readonly<Record<string, OperatorRole>> {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BACKOFFICE_OIDC_ROLE_MAP_JSON must be an object");
  }

  const roleMap: Record<string, OperatorRole> = {};
  for (const [group, role] of Object.entries(parsed)) {
    if (typeof role !== "string" || !roles.has(role as OperatorRole)) {
      throw new Error(`Unsupported backoffice role mapped from ${group}`);
    }
    roleMap[group] = role as OperatorRole;
  }
  return roleMap;
}

function parseOidcUrl(
  name: string,
  value: string,
  allowLoopbackHttp: boolean
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error(`${name} must be an absolute HTTP(S) URL without credentials or fragments`);
  }
  if (
    url.protocol !== "https:"
    && (!allowLoopbackHttp || !isLoopbackHostname(url.hostname))
  ) {
    throw new Error(`${name} must use HTTPS except for loopback development`);
  }
  return url;
}

function loadOidcConfig(allowedOrigins: readonly string[]): OidcConfig | undefined {
  const values = {
    issuer: requiredOidcValue("BACKOFFICE_OIDC_ISSUER"),
    authorizationEndpoint: requiredOidcValue("BACKOFFICE_OIDC_AUTHORIZATION_ENDPOINT"),
    tokenEndpoint: requiredOidcValue("BACKOFFICE_OIDC_TOKEN_ENDPOINT"),
    jwksUri: requiredOidcValue("BACKOFFICE_OIDC_JWKS_URI"),
    clientId: requiredOidcValue("BACKOFFICE_OIDC_CLIENT_ID"),
    clientSecret: requiredOidcValue("BACKOFFICE_OIDC_CLIENT_SECRET") ?? "",
    redirectUri: requiredOidcValue("BACKOFFICE_OIDC_REDIRECT_URI"),
    roleClaim: requiredOidcValue("BACKOFFICE_OIDC_ROLE_CLAIM") ?? "groups"
  };
  const configured = Object.entries(values)
    .filter(([key]) => key !== "clientSecret" && key !== "roleClaim")
    .filter(([, value]) => Boolean(value));

  if (configured.length === 0) return undefined;
  if (configured.length !== 6) {
    throw new Error("OIDC configuration is incomplete");
  }

  const allowLoopbackHttp = allowedOrigins.every((origin) => {
    const url = new URL(origin);
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  });
  const issuer = parseOidcUrl(
    "BACKOFFICE_OIDC_ISSUER",
    values.issuer as string,
    allowLoopbackHttp
  );
  parseOidcUrl(
    "BACKOFFICE_OIDC_AUTHORIZATION_ENDPOINT",
    values.authorizationEndpoint as string,
    allowLoopbackHttp
  );
  parseOidcUrl(
    "BACKOFFICE_OIDC_TOKEN_ENDPOINT",
    values.tokenEndpoint as string,
    allowLoopbackHttp
  );
  parseOidcUrl(
    "BACKOFFICE_OIDC_JWKS_URI",
    values.jwksUri as string,
    allowLoopbackHttp
  );
  const redirectUri = parseOidcUrl(
    "BACKOFFICE_OIDC_REDIRECT_URI",
    values.redirectUri as string,
    allowLoopbackHttp
  );
  if (issuer.search) {
    throw new Error("BACKOFFICE_OIDC_ISSUER must not contain a query");
  }
  if (
    !allowedOrigins.includes(redirectUri.origin)
    || redirectUri.pathname !== "/bff/auth/callback"
    || redirectUri.search
  ) {
    throw new Error(
      "BACKOFFICE_OIDC_REDIRECT_URI must be the exact /bff/auth/callback URL on an allowed origin"
    );
  }

  return {
    issuer: values.issuer as string,
    authorizationEndpoint: values.authorizationEndpoint as string,
    tokenEndpoint: values.tokenEndpoint as string,
    jwksUri: values.jwksUri as string,
    clientId: values.clientId as string,
    clientSecret: values.clientSecret,
    redirectUri: values.redirectUri as string,
    roleClaim: values.roleClaim,
    roleMap: parseRoleMap(process.env.BACKOFFICE_OIDC_ROLE_MAP_JSON)
  };
}

function loadAuditConfig(): AuditConfig {
  const storage = process.env.BACKOFFICE_AUDIT_STORAGE ?? "memory";
  if (storage !== "memory" && storage !== "postgresql") {
    throw new Error("BACKOFFICE_AUDIT_STORAGE must be memory or postgresql");
  }

  const retentionDays = Number(process.env.BACKOFFICE_AUDIT_RETENTION_DAYS ?? "2555");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36_500) {
    throw new Error("BACKOFFICE_AUDIT_RETENTION_DAYS must be between 1 and 36500");
  }

  const databaseUrl = requiredOidcValue("BACKOFFICE_AUDIT_DATABASE_URL");
  if (storage === "postgresql" && !databaseUrl) {
    throw new Error("BACKOFFICE_AUDIT_DATABASE_URL is required for PostgreSQL audit storage");
  }
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("BACKOFFICE_AUDIT_DATABASE_URL must use PostgreSQL");
    }
  }

  return { storage, retentionDays, databaseUrl };
}

function integerSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function modeSetting<T extends string>(name: string, modes: readonly T[]): T {
  const value = process.env[name]?.trim() || "off";
  if (!modes.includes(value as T)) {
    throw new Error(`${name} must be one of ${modes.join(", ")}`);
  }
  return value as T;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]";
}

function loadStepUpConfig(): StepUpConfig {
  return {
    provider: "synthetic-dev",
    challengeTtlSeconds: integerSetting(
      "BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS",
      300,
      30,
      900
    ),
    grantTtlSeconds: integerSetting(
      "BACKOFFICE_STEP_UP_GRANT_TTL_SECONDS",
      60,
      15,
      300
    ),
    maxAttempts: integerSetting("BACKOFFICE_STEP_UP_MAX_ATTEMPTS", 3, 1, 5)
  };
}

function loadSigningConfig(): SigningConfig {
  return {
    backend: "ephemeral-dev",
    rotationSeconds: integerSetting(
      "BACKOFFICE_SIGNING_ROTATION_SECONDS",
      900,
      60,
      86_400
    ),
    retainedVerificationKeys: integerSetting(
      "BACKOFFICE_SIGNING_RETAINED_KEYS",
      2,
      1,
      5
    )
  };
}

function parseCustomerApi(): { customerApiUrl?: string; customerApiDevTokenKey?: string } {
  const url = process.env.BACKOFFICE_CUSTOMER_API_URL?.trim() || undefined;
  const key = process.env.BACKOFFICE_CUSTOMER_API_DEV_TOKEN_KEY?.trim() || undefined;
  if (url === undefined && key === undefined) return {};
  if (url === undefined || key === undefined) {
    throw new Error("BACKOFFICE_CUSTOMER_API_URL and BACKOFFICE_CUSTOMER_API_DEV_TOKEN_KEY must be set together");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("BACKOFFICE_CUSTOMER_API_URL must be an absolute origin");
  }
  if (parsed.protocol !== "http:" || parsed.origin !== url || !isLoopbackHostname(parsed.hostname)) {
    throw new Error("BACKOFFICE_CUSTOMER_API_URL must be an exact loopback http origin; the dev customer API is never remote");
  }
  if (!devTokenKeyPattern.test(key)) {
    throw new Error("BACKOFFICE_CUSTOMER_API_DEV_TOKEN_KEY must be 64 lowercase hex characters");
  }
  return { customerApiUrl: url, customerApiDevTokenKey: key };
}

function loadDeviceBindingConfig(): DeviceBindingConfig {
  const mode = process.env.BACKOFFICE_DEVICE_BINDING ?? "off";
  if (mode !== "off" && mode !== "enforce") {
    throw new Error("BACKOFFICE_DEVICE_BINDING must be off or enforce");
  }
  const digests = (process.env.BACKOFFICE_APPROVED_DEVICE_DIGESTS ?? "")
    .split(",")
    .map((digest) => digest.trim())
    .filter(Boolean);
  if (digests.some((digest) => !/^[0-9a-f]{64}$/.test(digest))) {
    throw new Error("BACKOFFICE_APPROVED_DEVICE_DIGESTS must contain lowercase SHA-256 digests");
  }
  if (new Set(digests).size !== digests.length) {
    throw new Error("BACKOFFICE_APPROVED_DEVICE_DIGESTS must not contain duplicates");
  }
  if (mode === "off" && digests.length > 0) {
    throw new Error("BACKOFFICE_APPROVED_DEVICE_DIGESTS requires BACKOFFICE_DEVICE_BINDING=enforce");
  }
  return { mode, approvedDeviceDigests: digests };
}

export function loadServerConfig(): ServerConfig {
  if (process.env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new Error("Backoffice BFF is dev-only and refuses NODE_ENV=production");
  }
  if ((process.env.BACKOFFICE_MODE ?? "dev-dry-run") !== "dev-dry-run") {
    throw new Error("Backoffice BFF refuses to start outside dev-dry-run mode");
  }

  const allowedOrigins = (process.env.BACKOFFICE_ALLOWED_ORIGINS
    ?? "http://127.0.0.1:4173,http://localhost:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  let originUrls: readonly URL[];
  try {
    originUrls = allowedOrigins.map((origin) => new URL(origin));
  } catch {
    throw new Error("BACKOFFICE_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
  }
  if (
    originUrls.length === 0
    || originUrls.some((url, index) =>
      !["http:", "https:"].includes(url.protocol) || url.origin !== allowedOrigins[index]
    )
  ) {
    throw new Error("BACKOFFICE_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
  }
  if (originUrls.some((url) =>
    url.protocol === "http:" && !isLoopbackHostname(url.hostname)
  )) {
    throw new Error("BACKOFFICE_ALLOWED_ORIGINS permits HTTP only for loopback origins");
  }
  const protocols = new Set(originUrls.map((url) => url.protocol));
  if (protocols.size > 1) {
    throw new Error("BACKOFFICE_ALLOWED_ORIGINS must not mix HTTP and HTTPS origins");
  }

  const host = process.env.BACKOFFICE_BFF_HOST ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("BACKOFFICE_BFF_HOST must be a loopback address; the dev BFF is never exposed");
  }

  const port = Number(process.env.BACKOFFICE_BFF_PORT ?? "4174");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("BACKOFFICE_BFF_PORT is invalid");
  }
  const sessionTtlSeconds = Number(process.env.BACKOFFICE_SESSION_TTL_SECONDS ?? "900");
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60 || sessionTtlSeconds > 3_600) {
    throw new Error("BACKOFFICE_SESSION_TTL_SECONDS must be between 60 and 3600");
  }

  return {
    host,
    port,
    allowedOrigins,
    allowDevLogin: process.env.BACKOFFICE_ALLOW_DEV_LOGIN === "true",
    sessionTtlSeconds,
    audit: loadAuditConfig(),
    stepUp: loadStepUpConfig(),
    signing: loadSigningConfig(),
    deviceBinding: loadDeviceBindingConfig(),
    oidc: loadOidcConfig(allowedOrigins),
    ...parseCustomerApi(),
    observability: {
      log: modeSetting("BACKOFFICE_LOG", logModes),
      metrics: modeSetting("BACKOFFICE_METRICS", metricsModes)
    }
  };
}
