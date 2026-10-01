import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(process.argv[2] ?? join(root, "migrations"));
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();

assert(
  migrationNames.length > 0,
  "PostgreSQL custody migration source policy requires migrations"
);

const historyBootstrapVersion = 2;

const migrations = migrationNames.map((name) => {
  const match = /^([0-9]{4})_[a-z0-9_]+\.sql$/.exec(name);
  assert(match, `PostgreSQL custody migration filename is not canonical: ${name}`);
  return {
    name,
    migrationName: name.slice(0, -4),
    version: Number(match[1])
  };
});

assert.deepStrictEqual(
  migrations.map(({ version }) => version),
  migrations.map((_, index) => index + 1),
  "PostgreSQL custody migration source versions must form a contiguous sequence starting at 0001"
);

assert(
  migrations.length >= historyBootstrapVersion,
  "PostgreSQL custody migration source policy requires the history bootstrap migration 0002"
);

function expectedHistoryRows(version) {
  if (version < historyBootstrapVersion) return [];
  if (version === historyBootstrapVersion) {
    return migrations
      .slice(0, historyBootstrapVersion)
      .map(({ migrationName, version: rowVersion }) => [rowVersion, migrationName]);
  }
  const { migrationName } = migrations[version - 1];
  return [[version, migrationName]];
}

for (const { name, version } of migrations) {
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
    `PostgreSQL custody migration must contain exactly one top-level BEGIN and COMMIT transaction boundary: ${name}`
  );
  assert.equal(
    (source.match(/^[ \t]*\\\S+/gmu) ?? []).length,
    0,
    `PostgreSQL custody migration must not execute psql meta-commands: ${name}`
  );

  const historyTableDefinitions =
    source.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?custody_core\.schema_migrations\b/giu) ?? [];
  assert.equal(
    historyTableDefinitions.length,
    version === historyBootstrapVersion ? 1 : 0,
    `PostgreSQL custody migration history table must be created only by the history bootstrap migration: ${name}`
  );

  const historyWrites =
    source.match(
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|COPY|ALTER\s+TABLE(?:\s+ONLY)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+custody_core\.schema_migrations\b/giu
    ) ?? [];
  const historyRows = [
    ...source.matchAll(
      /INSERT\s+INTO\s+custody_core\.schema_migrations\s*\(\s*version\s*,\s*migration_name\s*\)\s*VALUES\s*\(\s*([0-9]+)\s*,\s*'([a-z0-9_]+)'\s*\)\s*;/giu
    )
  ];
  const historyTableAlterations =
    source.match(
      /ALTER\s+TABLE(?:\s+ONLY)?\s+custody_core\.schema_migrations\s+ENABLE\s+ALWAYS\s+TRIGGER\s+schema_migrations_[a-z_]+\s*;/giu
    ) ?? [];

  assert.equal(
    historyWrites.length,
    historyRows.length +
      (version === historyBootstrapVersion ? historyTableAlterations.length : 0),
    `PostgreSQL custody migration must change history only through canonical history rows: ${name}`
  );
  assert.deepStrictEqual(
    historyRows.map((row) => [Number(row[1]), row[2]]),
    expectedHistoryRows(version),
    `PostgreSQL custody migration history rows must match canonical source history: ${name}`
  );
}

console.log("custody-postgres-migration-source-policy-ok");
