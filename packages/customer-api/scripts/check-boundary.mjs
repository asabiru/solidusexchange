import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const ENV_ACCESS = new RegExp(`${"pro" + "cess"}\\.env`, "u");
const ALLOWED_IMPORTS = new Set([
  "node:crypto",
  "node:http",
  "node:path",
  "node:url",
  "node:util"
]);
const FORBIDDEN_CALLS = [
  /\bfetch\s*\(/u,
  /\bhttp\.(?:request|get)\b/u,
  /\b(?:request|get)\s*\(\s*["'`]https?:/u,
  /\bWebSocket\b/u,
  /\bXMLHttpRequest\b/u
];

// The operator namespace stays dev-only too: runtime code may reference only
// the served operator read. Any other /api/v1/operator* reference (served or
// planned upstream surfaces) keeps the package forbidden from calling or
// impersonating the operator API.
const ALLOWED_OPERATOR_PATHS = ["/api/v1/operator/admin", "/api/v1/operator/capabilities", "/api/v1/operator/queue", "/api/v1/operator/session", "/api/v1/operator/subjects", "/api/v1/operator/subjects/{subjectId}"];
const OPERATOR_PATH_REFERENCE = /\/api\/v1\/operator[a-z0-9_/-]*/gu;

// The only runtime dependency is the PostgreSQL driver behind the dev-only
// store seam; static-check tooling stays the only other allowed package.
const ALLOWED_DEPENDENCIES = JSON.stringify({ pg: "8.23.0" });
const ALLOWED_DEV_DEPENDENCIES = JSON.stringify({
  "@types/node": "24.3.0",
  "@types/pg": "8.23.1",
  typescript: "5.9.2"
});
// Only the PostgreSQL store backend may import the driver; every other
// source keeps the dependency-free runtime boundary.
const POSTGRES_STORE_SOURCES = new Set(["postgres-store.mjs"]);
// Cross-package source imports are allowed only where the boundary grants
// them: the exchange-orders read replays the matching engine in the same runtime,
// reached by repo-relative path because a `file:` dependency cannot
// resolve under this package's realpathed symlink consumers (miniapp,
// backoffice, e2e-dev never run `npm ci` inside packages/customer-api).
const ALLOWED_CROSS_PACKAGE = new Set([
  "../../matching-core/src/deterministic.mjs",
  "../../matching-core/src/engine.mjs",
  "../../matching-core/src/instruments.mjs"
]);
// Verification scripts additionally read files and assert invariants.
const SCRIPT_ONLY_IMPORTS = new Set(["node:assert/strict", "node:fs"]);

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (JSON.stringify(manifest.dependencies) !== ALLOWED_DEPENDENCIES) {
  errors.push(`package.json dependencies must be exactly ${ALLOWED_DEPENDENCIES}`);
}
for (const field of ["optionalDependencies", "peerDependencies"]) {
  if (manifest[field] !== undefined) {
    errors.push(`package.json must not declare ${field}`);
  }
}
if (JSON.stringify(manifest.devDependencies) !== ALLOWED_DEV_DEPENDENCIES) {
  errors.push(`package.json devDependencies must be exactly ${ALLOWED_DEV_DEPENDENCIES}`);
}

for (const directory of ["src", "scripts"]) {
  for (const name of readdirSync(join(root, directory))) {
    if (!name.endsWith(".mjs")) {
      errors.push(`${directory}/${name}: only .mjs sources are allowed`);
      continue;
    }
    const text = readFileSync(join(root, directory, name), "utf8");
    for (const match of text.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gmu)) {
      const allowed =
        ALLOWED_IMPORTS.has(match[1]) ||
        (directory === "scripts" && SCRIPT_ONLY_IMPORTS.has(match[1])) ||
        (directory === "src" && POSTGRES_STORE_SOURCES.has(name) && match[1] === "pg");
      if (!match[1].startsWith("./") && !match[1].startsWith("../") && !allowed) {
        errors.push(`${directory}/${name}: import ${match[1]} is outside the dev runtime boundary`);
      }
      if (
        match[1].startsWith("../") &&
        !join(root, directory, match[1]).startsWith(`${root}/`) &&
        !ALLOWED_CROSS_PACKAGE.has(match[1])
      ) {
        errors.push(`${directory}/${name}: cross-package import ${match[1]} escapes the dev runtime boundary`);
      }
    }
    // Dynamic imports (runtime or JSDoc type position) follow the same
    // boundary: node builtins are always allowed, and the PostgreSQL store
    // may lazy-load its driver so consumers never touch it in memory mode.
    for (const match of text.matchAll(/import\s*\(\s*"([^"]+)"\s*\)/gu)) {
      const allowed =
        match[1].startsWith("node:") ||
        ALLOWED_IMPORTS.has(match[1]) ||
        (directory === "scripts" && SCRIPT_ONLY_IMPORTS.has(match[1])) ||
        (directory === "src" && POSTGRES_STORE_SOURCES.has(name) && match[1] === "pg");
      if (!match[1].startsWith("./") && !match[1].startsWith("../") && !allowed) {
        errors.push(`${directory}/${name}: dynamic import ${match[1]} is outside the dev runtime boundary`);
      }
      if (
        match[1].startsWith("../") &&
        !join(root, directory, match[1]).startsWith(`${root}/`) &&
        !ALLOWED_CROSS_PACKAGE.has(match[1])
      ) {
        errors.push(`${directory}/${name}: dynamic cross-package import ${match[1]} escapes the dev runtime boundary`);
      }
    }
    if (directory === "src") {
      for (const pattern of FORBIDDEN_CALLS) {
        if (pattern.test(text)) {
          errors.push(`${directory}/${name}: outbound or operator surface ${pattern} is not allowed`);
        }
      }
      for (const match of text.matchAll(OPERATOR_PATH_REFERENCE)) {
        const reference = match[0];
        const prefix = reference.endsWith("/") ? reference : `${reference}/`;
        const allowed = ALLOWED_OPERATOR_PATHS.some(
          (path) => reference === path || path.startsWith(prefix)
        );
        if (!allowed) {
          errors.push(`${directory}/${name}: operator surface ${reference} is not allowed`);
        }
      }
      if (ENV_ACCESS.test(text) && name !== "server.mjs") {
        errors.push(`src/${name}: environment access belongs in server.mjs via loadConfig`);
      }
    }
  }
}

const contractSource = readFileSync(join(root, "src", "contract.mjs"), "utf8");
for (const flag of ["financial_commands_enabled: false", "production_providers_enabled: false"]) {
  if (!contractSource.includes(flag)) {
    errors.push(`src/contract.mjs must pin ${flag}`);
  }
}
const paths = [...contractSource.matchAll(/path: "([^"]+)"/gu)].map((match) => match[1]).sort();
const expected = ["/api/v1/customer/activity", "/api/v1/customer/address-screenings", "/api/v1/customer/address-screenings/{screeningId}", "/api/v1/customer/auth", "/api/v1/customer/capabilities", "/api/v1/customer/cards", "/api/v1/customer/checks", "/api/v1/customer/deposit-addresses", "/api/v1/customer/deposits", "/api/v1/customer/exchange-orders", "/api/v1/customer/exchange-orders/{orderId}", "/api/v1/customer/kyc", "/api/v1/customer/markets", "/api/v1/customer/notifications", "/api/v1/customer/operations", "/api/v1/customer/operations/{operationId}", "/api/v1/customer/payments", "/api/v1/customer/profile", "/api/v1/customer/quotes", "/api/v1/customer/session", "/api/v1/customer/support", "/api/v1/customer/trades", "/api/v1/customer/users", "/api/v1/customer/wallets", "/api/v1/customer/withdrawals", "/api/v1/meta", "/api/v1/operator/admin", "/api/v1/operator/capabilities", "/api/v1/operator/queue", "/api/v1/operator/session", "/api/v1/operator/subjects", "/api/v1/operator/subjects/{subjectId}"];
if (JSON.stringify(paths) !== JSON.stringify(expected)) {
  errors.push(`src/contract.mjs must serve exactly ${expected.join(", ")}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("customer-api-boundary-ok");
}
