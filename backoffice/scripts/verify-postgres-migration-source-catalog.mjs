import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSources = [
  [
    "0001_append_only_audit.sql",
    "87abc94e175fd4c3e77b7859acbbca4f983bac75c1b40ba106832b3e6032eb60"
  ],
  [
    "0002_operator_sessions.sql",
    "34e50e999d0a0b50f36edc6ba0acd2864846856933318fed1b9fa95b3f6e869a"
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
  "PostgreSQL backoffice migration source files differ from canonical manifest"
);

for (const [name, expectedSha256] of expectedSources) {
  const actualSha256 = createHash("sha256")
    .update(readFileSync(join(migrationDirectory, name)))
    .digest("hex");
  assert.equal(
    actualSha256,
    expectedSha256,
    `PostgreSQL backoffice migration source digest differs for ${name}`
  );
}

console.log("backoffice-postgres-migration-source-catalog-ok");
