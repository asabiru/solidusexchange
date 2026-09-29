import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chart = JSON.parse(
  readFileSync(join(root, "chart-of-accounts.json"), "utf8")
);

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
const expected = chart.account_definitions
  .toSorted((left, right) =>
    Buffer.compare(
      Buffer.from(left.code, "utf8"),
      Buffer.from(right.code, "utf8")
    )
  )
  .map((definition) => ({
    chart_version: chart.chart_version,
    definition_code: definition.code,
    category: definition.category,
    account_class: definition.account_class,
    normal_side: definition.normal_side,
    owner_scope: definition.owner_scope,
    purpose: definition.purpose
  }));

assert.deepStrictEqual(
  actual,
  expected,
  "PostgreSQL account definitions differ from chart-of-accounts.json"
);

console.log("postgres-chart-of-accounts-ok");
