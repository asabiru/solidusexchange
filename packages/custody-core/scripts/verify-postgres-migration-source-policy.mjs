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

const versions = migrationNames.map((name) => {
  const match = /^([0-9]{4})_[a-z0-9_]+\.sql$/.exec(name);
  assert(match, `PostgreSQL custody migration filename is not canonical: ${name}`);
  return Number(match[1]);
});

assert.deepStrictEqual(
  versions,
  migrationNames.map((_, index) => index + 1),
  "PostgreSQL custody migration source versions must form a contiguous sequence starting at 0001"
);

for (const name of migrationNames) {
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
}

console.log("custody-postgres-migration-source-policy-ok");
