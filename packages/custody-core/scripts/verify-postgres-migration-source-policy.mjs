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

function normalizeSqlSource(source) {
  let normalized = "";
  let index = 0;

  while (index < source.length) {
    const next = source[index];
    const afterNext = source[index + 1];

    if (next === "-" && afterNext === "-") {
      normalized += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        normalized += " ";
        index += 1;
      }
      continue;
    }

    if (next === "/" && afterNext === "*") {
      normalized += "  ";
      index += 2;
      let depth = 1;
      while (index < source.length && depth > 0) {
        if (source[index] === "/" && source[index + 1] === "*") {
          normalized += "  ";
          index += 2;
          depth += 1;
          continue;
        }
        if (source[index] === "*" && source[index + 1] === "/") {
          normalized += "  ";
          index += 2;
          depth -= 1;
          continue;
        }
        normalized += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      assert.equal(depth, 0, "PostgreSQL custody migration contains an unterminated block comment");
      continue;
    }

    if (next === "'") {
      normalized += next;
      index += 1;
      while (index < source.length) {
        normalized += source[index];
        if (source[index] === "'") {
          if (source[index + 1] === "'") {
            normalized += source[index + 1];
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (next === "\"") {
      let identifier = "";
      let quotedIdentifier = next;
      index += 1;
      while (index < source.length) {
        quotedIdentifier += source[index];
        if (source[index] === "\"") {
          if (source[index + 1] === "\"") {
            identifier += "\"";
            quotedIdentifier += source[index + 1];
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        identifier += source[index];
        index += 1;
      }
      normalized +=
        identifier === "custody_core" || identifier === "schema_migrations"
          ? identifier
          : quotedIdentifier;
      continue;
    }

    if (next === "$") {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(source.slice(index));
      if (match) {
        const delimiter = match[0];
        const closeIndex = source.indexOf(delimiter, index + delimiter.length);
        assert(
          closeIndex !== -1,
          "PostgreSQL custody migration contains an unterminated dollar-quoted string"
        );
        const endIndex = closeIndex + delimiter.length;
        normalized += source.slice(index, endIndex);
        index = endIndex;
        continue;
      }
    }

    normalized += next;
    index += 1;
  }

  return normalized;
}

for (const { name, version } of migrations) {
  const source = readFileSync(join(migrationDirectory, name), "utf8");
  const executableSource = normalizeSqlSource(source);
  const transactionControls =
    executableSource.match(
      /^[ \t]*(?:BEGIN(?:\s+(?:WORK|TRANSACTION)(?:\s+[^;\n]+)?)?|START\s+TRANSACTION(?:\s+[^;\n]+)?|COMMIT(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?|COMMIT\s+PREPARED\s+'[^']+'|END\s+(?:WORK|TRANSACTION)(?:\s+AND\s+(?:NO\s+)?CHAIN)?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?|ROLLBACK\s+TO(?:\s+SAVEPOINT)?\s+[a-z_][a-z0-9_]*|ROLLBACK\s+PREPARED\s+'[^']+'|ABORT(?:\s+(?:WORK|TRANSACTION))?|SAVEPOINT\s+[a-z_][a-z0-9_]*|RELEASE(?:\s+SAVEPOINT)?\s+[a-z_][a-z0-9_]*|PREPARE\s+TRANSACTION\s+'[^']+')[ \t]*;[ \t]*$/gimu
    ) ?? [];
  const normalizedTransactionControls = transactionControls.map((statement) =>
    statement.trim().replace(/\s+/gu, " ").toUpperCase()
  );

  assert(
    executableSource.trimStart().startsWith("BEGIN;") &&
      executableSource.trimEnd().endsWith("COMMIT;") &&
      normalizedTransactionControls.length === 2 &&
      normalizedTransactionControls[0] === "BEGIN;" &&
      normalizedTransactionControls[1] === "COMMIT;",
    `PostgreSQL custody migration must contain exactly one top-level BEGIN and COMMIT transaction boundary: ${name}`
  );
  assert.equal(
    (executableSource.match(/^[ \t]*\\\S+/gmu) ?? []).length,
    0,
    `PostgreSQL custody migration must not execute psql meta-commands: ${name}`
  );

  const historyTableDefinitions =
    executableSource.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?custody_core\s*\.\s*schema_migrations\b/giu
    ) ?? [];
  assert.equal(
    historyTableDefinitions.length,
    version === historyBootstrapVersion ? 1 : 0,
    `PostgreSQL custody migration history table must be created only by the history bootstrap migration: ${name}`
  );

  const historyWrites =
    executableSource.match(
      /\b(?:INSERT\s+INTO(?:\s+ONLY)?|UPDATE(?:\s+ONLY)?|DELETE\s+FROM(?:\s+ONLY)?|TRUNCATE(?:\s+TABLE)?(?:\s+ONLY)?|COPY|ALTER\s+TABLE(?:\s+ONLY)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+custody_core\s*\.\s*schema_migrations\b/giu
    ) ?? [];
  const historyRows = [
    ...executableSource.matchAll(
      /INSERT\s+INTO\s+custody_core\s*\.\s*schema_migrations\s*\(\s*version\s*,\s*migration_name\s*\)\s*VALUES\s*\(\s*([0-9]+)\s*,\s*'([a-z0-9_]+)'\s*\)\s*;/giu
    )
  ];
  const historyTableAlterations =
    executableSource.match(
      /ALTER\s+TABLE(?:\s+ONLY)?\s+custody_core\s*\.\s*schema_migrations\s+ENABLE\s+ALWAYS\s+TRIGGER\s+schema_migrations_[a-z_]+\s*;/giu
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
