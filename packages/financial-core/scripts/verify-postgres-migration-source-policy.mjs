import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(process.argv[2] ?? join(root, "migrations"));
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();

assert(migrationNames.length > 0, "PostgreSQL migration source policy requires migrations");

const migrations = migrationNames.map((name) => {
  const match = /^([0-9]{4})_[a-z0-9_]+\.sql$/.exec(name);
  assert(match, `PostgreSQL migration filename is not canonical: ${name}`);
  return {
    name,
    migrationName: name.slice(0, -4),
    version: Number(match[1])
  };
});

assert.deepStrictEqual(
  migrations.map(({ version }) => version),
  migrations.map((_, index) => index + 1),
  "PostgreSQL migration source versions must form a contiguous sequence starting at 0001"
);

for (const { name, migrationName, version } of migrations) {
  const source = readFileSync(join(migrationDirectory, name), "utf8");
  const transactionControls =
    source.match(
      /^[ \t]*(?:BEGIN(?:\s+(?:WORK|TRANSACTION)(?:\s+[^;\n]+)?)?|START\s+TRANSACTION(?:\s+[^;\n]+)?|COMMIT(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?|COMMIT\s+PREPARED\s+'[^']+'|END\s+(?:WORK|TRANSACTION)(?:\s+AND\s+(?:NO\s+)?CHAIN)?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?|ROLLBACK\s+TO(?:\s+SAVEPOINT)?\s+[a-z_][a-z0-9_]*|ROLLBACK\s+PREPARED\s+'[^']+'|ABORT(?:\s+(?:WORK|TRANSACTION))?|SAVEPOINT\s+[a-z_][a-z0-9_]*|RELEASE(?:\s+SAVEPOINT)?\s+[a-z_][a-z0-9_]*|PREPARE\s+TRANSACTION\s+'[^']+')[ \t]*;[ \t]*$/gimu
    ) ?? [];
  const normalizedTransactionControls = transactionControls.map((statement) =>
    statement.trim().replace(/\s+/gu, " ").toUpperCase()
  );

  assert(
    source.trimStart().startsWith("BEGIN;") &&
      source.trimEnd().endsWith("COMMIT;") &&
      normalizedTransactionControls.length === 2 &&
      normalizedTransactionControls[0] === "BEGIN;" &&
      normalizedTransactionControls[1] === "COMMIT;",
    `PostgreSQL migration must contain exactly one top-level BEGIN and COMMIT transaction boundary: ${name}`
  );
  assert.equal(
    (source.match(/^[ \t]*\\\S+/gmu) ?? []).length,
    0,
    `PostgreSQL migration must not execute psql meta-commands: ${name}`
  );

  const historyRows = [
    ...source.matchAll(
      /INSERT\s+INTO\s+financial_core\.schema_migrations\s*\(\s*version\s*,\s*migration_name\s*\)\s*VALUES\s*\(\s*([0-9]+)\s*,\s*'([a-z0-9_]+)'\s*\)\s*;/giu
    )
  ];

  assert.equal(
    historyRows.length,
    1,
    `PostgreSQL migration must record exactly one canonical history row: ${name}`
  );
  assert.deepStrictEqual(
    [Number(historyRows[0][1]), historyRows[0][2]],
    [version, migrationName],
    `PostgreSQL migration history row must match its filename: ${name}`
  );
}

console.log("postgres-migration-source-policy-ok");
