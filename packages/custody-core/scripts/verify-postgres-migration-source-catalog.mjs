import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSources = [
  [
    "0001_custody_projection_outbox.sql",
    "2c0ee1744180763f0d76a0f0282fd2797c826a622164a04b6d6e0a4eab3b1202"
  ],
  [
    "0002_custody_migration_history.sql",
    "8cec61ccf50fd42ba823398b7f670ce61a0f45ab0ec4e1707d498e7cf929d3c4"
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
  "PostgreSQL custody migration source files differ from canonical manifest"
);

for (const [name, expectedSha256] of expectedSources) {
  const actualSha256 = createHash("sha256")
    .update(readFileSync(join(migrationDirectory, name)))
    .digest("hex");
  assert.equal(
    actualSha256,
    expectedSha256,
    `PostgreSQL custody migration source digest differs for ${name}`
  );
}

console.log("custody-postgres-migration-source-catalog-ok");
