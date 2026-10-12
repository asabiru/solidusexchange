import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedSources = [
  [
    "0001_matching_journal.sql",
    "b089af61c56aa530628594ae74a9d81ba8547b306a061ad96ddf6d99232455f5"
  ],
  [
    "0002_journal_event_grammar.sql",
    "23f1cff35807f074f0387f222aa52564842f0c83729d614f2e5781b37daa215e"
  ],
  [
    "0003_journal_event_timestamp.sql",
    "b8b43c56b3f7ab64be32614f99302a1650862b340232e0b60e2c2de902a90c73"
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
  "PostgreSQL matching-core migration source files differ from canonical manifest"
);

for (const [name, expectedSha256] of expectedSources) {
  const actualSha256 = createHash("sha256")
    .update(readFileSync(join(migrationDirectory, name)))
    .digest("hex");
  assert.equal(
    actualSha256,
    expectedSha256,
    `PostgreSQL matching-core migration source digest differs for ${name}`
  );
}

console.log("matching-core-postgres-migration-source-catalog-ok");
