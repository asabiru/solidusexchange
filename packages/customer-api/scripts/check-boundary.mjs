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
  /\bXMLHttpRequest\b/u,
  /\/api\/v1\/operator/u
];

// Static-check tooling only; runtime code stays dependency-free.
const ALLOWED_DEV_DEPENDENCIES = JSON.stringify({ "@types/node": "24.3.0", typescript: "5.9.2" });

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
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
      const allowed = ALLOWED_IMPORTS.has(match[1]) || (directory === "scripts" && match[1] === "node:fs");
      if (!match[1].startsWith("./") && !match[1].startsWith("../") && !allowed) {
        errors.push(`${directory}/${name}: import ${match[1]} is outside the dev runtime boundary`);
      }
    }
    if (directory === "src") {
      for (const pattern of FORBIDDEN_CALLS) {
        if (pattern.test(text)) {
          errors.push(`${directory}/${name}: outbound or operator surface ${pattern} is not allowed`);
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
const expected = ["/api/v1/customer/capabilities", "/api/v1/customer/session", "/api/v1/customer/wallets", "/api/v1/meta"];
if (JSON.stringify(paths) !== JSON.stringify(expected)) {
  errors.push(`src/contract.mjs must serve exactly ${expected.join(", ")}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("customer-api-boundary-ok");
}
