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

const historyTablePattern = String.raw`(?:(?:"financial_core"|financial_core\b)\s*\.\s*)?(?:"schema_migrations"|schema_migrations\b)`;
const historyChangePattern = new RegExp(
  String.raw`\b(?:(?:INSERT\s+INTO(?:\s+ONLY)?|UPDATE(?:\s+ONLY)?|DELETE\s+FROM(?:\s+ONLY)?|TRUNCATE(?:\s+TABLE)?(?:\s+ONLY)?|MERGE\s+INTO(?:\s+ONLY)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+${historyTablePattern}|COPY\s+${historyTablePattern}(?:\s*\([^)]*\))?\s+FROM\b)`,
  "iu"
);
const canonicalHistoryRowPattern =
  /^\s*INSERT\s+INTO\s+financial_core\.schema_migrations\s*\(\s*version\s*,\s*migration_name\s*\)\s*VALUES\s*\(\s*([0-9]+)\s*,\s*'([a-z0-9_]+)'\s*\)\s*;\s*$/iu;
const transactionControlPattern =
  /^(?:BEGIN(?:\s+(?:WORK|TRANSACTION)(?:\s+[^;\n]+)?)?|START\s+TRANSACTION(?:\s+[^;\n]+)?|COMMIT(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?|COMMIT\s+PREPARED\s+'[^']+'|END\s+(?:WORK|TRANSACTION)(?:\s+AND\s+(?:NO\s+)?CHAIN)?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?(?:\s+AND\s+(?:NO\s+)?CHAIN)?|ROLLBACK\s+TO(?:\s+SAVEPOINT)?\s+[a-z_][a-z0-9_]*|ROLLBACK\s+PREPARED\s+'[^']+'|ABORT(?:\s+(?:WORK|TRANSACTION))?|SAVEPOINT\s+[a-z_][a-z0-9_]*|RELEASE(?:\s+SAVEPOINT)?\s+[a-z_][a-z0-9_]*|PREPARE\s+TRANSACTION\s+'[^']+');$/iu;

function dollarQuoteDelimiterAt(source, offset) {
  return /^\$[a-z_][a-z0-9_]*\$|^\$\$/iu.exec(source.slice(offset))?.[0] ?? null;
}

function analyzeSql(source) {
  const masked = [...source];
  const dollarQuotedBodies = [];
  const literals = [];
  let index = 0;

  function mask(start, end) {
    for (let offset = start; offset < end; offset += 1) {
      if (masked[offset] !== "\n") masked[offset] = " ";
    }
  }

  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const lineEnd = source.indexOf("\n", index + 2);
      const end = lineEnd === -1 ? source.length : lineEnd;
      mask(index, end);
      index = end;
    } else if (source.startsWith("/*", index)) {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      mask(start, index);
    } else if (source[index] === "'") {
      const start = index;
      let value = "";
      const usesBackslashEscapes = start > 0 && /e/iu.test(source[start - 1]);
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          break;
        } else if (
          usesBackslashEscapes &&
          source[index] === "\\" &&
          index + 1 < source.length
        ) {
          value += source[index + 1];
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      literals.push({ start, value });
      mask(start, index);
    } else if (source[index] === '"') {
      index += 1;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
    } else {
      const delimiter = dollarQuoteDelimiterAt(source, index);
      if (delimiter !== null) {
        const start = index;
        const bodyStart = index + delimiter.length;
        const bodyEnd = source.indexOf(delimiter, bodyStart);
        if (bodyEnd === -1) {
          const value = source.slice(bodyStart);
          dollarQuotedBodies.push(value);
          literals.push({ start, value });
          index = source.length;
        } else {
          const value = source.slice(bodyStart, bodyEnd);
          dollarQuotedBodies.push(value);
          literals.push({ start, value });
          index = bodyEnd + delimiter.length;
        }
        mask(start, index);
      } else {
        index += 1;
      }
    }
  }

  return {
    masked: masked.join(""),
    dollarQuotedBodies,
    literals
  };
}

function splitSqlStatements(source) {
  const { masked } = analyzeSql(source);
  const statements = [];
  let statementStart = 0;

  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === ";") {
      statements.push(source.slice(statementStart, index + 1));
      statementStart = index + 1;
    }
  }
  if (source.slice(statementStart).trim() !== "") {
    statements.push(source.slice(statementStart));
  }

  return statements;
}

function containsHistoryChange(source) {
  return historyChangePattern.test(analyzeSql(source).masked);
}

function containsDynamicHistoryChange(source) {
  return analyzeSql(source).dollarQuotedBodies.some((body) => {
    const analysis = analyzeSql(body);
    return [...analysis.masked.matchAll(/\bEXECUTE\b(?!\s+FUNCTION\b)/giu)].some(
      (execute) =>
        analysis.literals.some(
          (literal) =>
            literal.start >= execute.index + execute[0].length &&
            /^[\s(]*(?:E\s*)?$/iu.test(
              analysis.masked.slice(execute.index + execute[0].length, literal.start)
            ) &&
            containsHistoryChange(literal.value)
        )
    );
  });
}

function isAllowedHistoryChange(statement, version) {
  const canonicalHistoryRow = canonicalHistoryRowPattern.exec(statement);
  if (canonicalHistoryRow !== null) return true;

  const masked = analyzeSql(statement).masked.trim().replace(/\s+/gu, " ");
  if (
    version === 1 &&
    new RegExp(String.raw`^CREATE\s+TABLE\s+${historyTablePattern}\s*\(`, "iu").test(masked)
  ) {
    return true;
  }
  return [
    String.raw`^ALTER\s+TABLE(?:\s+ONLY)?\s+${historyTablePattern}\s+ENABLE\s+ALWAYS\s+TRIGGER\s+schema_migrations_[a-z_]+\s*;$`,
    version === 10
      ? String.raw`^ALTER\s+TABLE(?:\s+ONLY)?\s+${historyTablePattern}\s+ADD\s+CONSTRAINT\s+schema_migrations_applied_at_finite\s+CHECK\s*\(\s*pg_catalog\.isfinite\s*\(\s*applied_at\s*\)\s*\)\s*;$`
      : null
  ].some((pattern) => pattern !== null && new RegExp(pattern, "iu").test(masked));
}

for (const { name, migrationName, version } of migrations) {
  const source = readFileSync(join(migrationDirectory, name), "utf8");
  const statements = splitSqlStatements(source);
  const transactionControls = statements.filter((statement) =>
    transactionControlPattern.test(statement.trim().replace(/\s+/gu, " "))
  );
  const normalizedTransactionControls = transactionControls.map((statement) =>
    statement.trim().replace(/\s+/gu, " ").toUpperCase()
  );

  assert.equal(
    (source.match(/^[ \t]*\\\S+/gmu) ?? []).length,
    0,
    `PostgreSQL migration must not execute psql meta-commands: ${name}`
  );
  assert(
    source.trimStart().startsWith("BEGIN;") &&
      source.trimEnd().endsWith("COMMIT;") &&
      normalizedTransactionControls.length === 2 &&
      normalizedTransactionControls[0] === "BEGIN;" &&
      normalizedTransactionControls[1] === "COMMIT;",
    `PostgreSQL migration must contain exactly one top-level BEGIN and COMMIT transaction boundary: ${name}`
  );

  const historyRows = [
    ...statements.map((statement) => canonicalHistoryRowPattern.exec(statement)).filter(Boolean)
  ];
  const historyChanges = statements.filter(
    (statement) => containsHistoryChange(statement) && !isAllowedHistoryChange(statement, version)
  );

  assert.equal(
    historyRows.length,
    1,
    `PostgreSQL migration must record exactly one canonical history row: ${name}`
  );
  assert.equal(
    historyChanges.length,
    0,
    `PostgreSQL migration must change history only through canonical history rows: ${name}`
  );
  assert(
    !containsDynamicHistoryChange(source),
    `PostgreSQL migration must change history only through canonical history rows: ${name}`
  );
  assert.deepStrictEqual(
    [Number(historyRows[0][1]), historyRows[0][2]],
    [version, migrationName],
    `PostgreSQL migration history row must match its filename: ${name}`
  );
}

console.log("postgres-migration-source-policy-ok");
