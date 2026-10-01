import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkflowText } from "./check-workflow-policy.mjs";

const checkoutSha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";

function workflow(step, permissions = "permissions:\n  contents: read") {
  return `name: Policy fixture
on: pull_request

${permissions}

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
${step}
`;
}

test("accepts pinned actions with least privilege and ephemeral checkout credentials", () => {
  const errors = validateWorkflowText(
    workflow(`      - uses: actions/checkout@${checkoutSha}
        with:
          persist-credentials: false
      - uses: ./local-action
      - uses: docker://alpine@sha256:${"a".repeat(64)}`),
  );

  assert.deepEqual(errors, []);
});

test("rejects mutable external action refs", () => {
  const errors = validateWorkflowText(
    workflow("      - uses: actions/setup-node@v4"),
  );

  assert.match(errors.join("\n"), /full 40-character commit SHA/);
});

test("rejects flow-style steps that hide mutable external action refs", () => {
  const errors = validateWorkflowText(
    workflow("      - { uses: actions/setup-node@v4 }"),
  );

  assert.match(errors.join("\n"), /flow-style sequence mappings are not allowed/);
});

test("rejects excessive workflow permissions", () => {
  const errors = validateWorkflowText(
    workflow("      - uses: ./local-action", "permissions:\n  contents: write"),
  );

  assert.match(errors.join("\n"), /permissions must be exactly contents: read/);
});

test("rejects checkout credentials unless persistence is explicitly disabled", () => {
  const errors = validateWorkflowText(
    workflow(`      - uses: actions/checkout@${checkoutSha}`),
  );

  assert.match(errors.join("\n"), /persist-credentials: false/);
});
