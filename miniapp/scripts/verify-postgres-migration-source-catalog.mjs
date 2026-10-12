import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSources = [
  [
    "0001_customer_sessions.sql",
    "1a3a9c38980844508a1fdf4bc7f144c5bc8e2e8bcb966bb0db37cb3ca015d030"
  ]
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(process.argv[2] ?? join(root, "migrations"));
const actualNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const expectedNames = expectedSources.map(([name]) => name);

assert.deepStrictEqual(
  actualNames,
  expectedNames,
  "PostgreSQL miniapp migration source files differ from canonical manifest"
);

for (const [name, expectedSha256] of expectedSources) {
  const actualSha256 = createHash("sha256")
    .update(readFileSync(join(migrationDirectory, name)))
    .digest("hex");
  assert.equal(
    actualSha256,
    expectedSha256,
    `PostgreSQL miniapp migration source digest differs for ${name}`
  );
}

console.log("miniapp-postgres-migration-source-catalog-ok");
