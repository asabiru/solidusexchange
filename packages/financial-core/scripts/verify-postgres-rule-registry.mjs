import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(
  readFileSync(join(root, "posting-rules.json"), "utf8")
);

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
const expected = registry.rules
  .toSorted((left, right) => {
    const leftKey = Buffer.from(
      `${left.journal_type}\0${left.posting_rule_version}`,
      "utf8"
    );
    const rightKey = Buffer.from(
      `${right.journal_type}\0${right.posting_rule_version}`,
      "utf8"
    );
    return Buffer.compare(leftKey, rightKey);
  })
  .map((rule) => ({
    registry_version: registry.registry_version,
    status: registry.status,
    runtime_boundary: registry.runtime_boundary,
    production_execution_enabled: registry.production_execution_enabled,
    journal_type: rule.journal_type,
    posting_rule_version: rule.posting_rule_version,
    scope: rule.scope,
    allowed_actor_types: rule.allowed_actor_types,
    entry_pattern: rule.entry_pattern,
    purpose: rule.purpose
  }));

assert.deepStrictEqual(
  actual,
  expected,
  "PostgreSQL posting-rule registry differs from posting-rules.json"
);

console.log("postgres-posting-rule-registry-ok");
