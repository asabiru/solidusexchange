import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSources = [
  [
    "0001_customer_api_store.sql",
    "939f72aa1fa05086c4f941f0cab72d2a03e80507a93ddbe7088c0fe3f1014262"
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
  "PostgreSQL customer-api migration source files differ from canonical manifest"
);

for (const [name, expectedSha256] of expectedSources) {
  const actualSha256 = createHash("sha256")
    .update(readFileSync(join(migrationDirectory, name)))
    .digest("hex");
  assert.equal(
    actualSha256,
    expectedSha256,
    `PostgreSQL customer-api migration source digest differs for ${name}`
  );
}

console.log("customer-api-postgres-migration-source-catalog-ok");
