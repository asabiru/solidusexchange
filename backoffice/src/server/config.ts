import type { OperatorRole } from "../auth/access.js";

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

export interface ServerConfig {
  host: string;
  port: number;
  allowedOrigins: readonly string[];
  allowDevLogin: boolean;
  sessionTtlSeconds: number;
  audit: AuditConfig;
  oidc?: OidcConfig;
}

const roles = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "auditor"
]);

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

function loadOidcConfig(): OidcConfig | undefined {
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

export function loadServerConfig(): ServerConfig {
  if ((process.env.BACKOFFICE_MODE ?? "dev-dry-run") !== "dev-dry-run") {
    throw new Error("Backoffice BFF refuses to start outside dev-dry-run mode");
  }

  const allowedOrigins = (process.env.BACKOFFICE_ALLOWED_ORIGINS
    ?? "http://127.0.0.1:4173,http://localhost:4173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    allowedOrigins.length === 0
    || allowedOrigins.some((origin) => {
      try {
        const url = new URL(origin);
        return !["http:", "https:"].includes(url.protocol) || url.origin !== origin;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("BACKOFFICE_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
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
    host: process.env.BACKOFFICE_BFF_HOST ?? "127.0.0.1",
    port,
    allowedOrigins,
    allowDevLogin: process.env.BACKOFFICE_ALLOW_DEV_LOGIN === "true",
    sessionTtlSeconds,
    audit: loadAuditConfig(),
    oidc: loadOidcConfig()
  };
}
