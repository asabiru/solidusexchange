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

test("rejects block-style steps with quoted uses keys hiding mutable external refs", () => {
  for (const usesKey of ["'uses'", '"uses"']) {
    const errors = validateWorkflowText(
      workflow(`      - ${usesKey}: actions/setup-node@v4`),
    );

    assert.match(errors.join("\n"), /full 40-character commit SHA/);
  }
});

test("rejects double-quoted escaped uses keys hiding mutable external refs", () => {
  const errors = validateWorkflowText(
    workflow(String.raw`      - "u\u0073es": actions/setup-node@v4`),
  );

  assert.match(errors.join("\n"), /full 40-character commit SHA/);
});

test("rejects flow-style steps that hide mutable external action refs", () => {
  for (const step of [
    "{ uses: actions/setup-node@v4 }",
    '{ name: Setup, "uses": actions/setup-node@v4 }',
    "{ name: Setup, 'uses': actions/setup-node@v4 }",
  ]) {
    const errors = validateWorkflowText(
      workflow(`      - ${step}`),
    );

    assert.match(errors.join("\n"), /flow-style uses mappings are not allowed/);
  }
});

test("rejects anchored flow-style steps that hide mutable external action refs", () => {
  const errors = validateWorkflowText(
    workflow("      - &setup-node { uses: actions/setup-node@v4 }"),
  );

  assert.match(errors.join("\n"), /flow-style uses mappings are not allowed/);
});

test("rejects flow-style jobs with valid ID syntaxes that hide mutable reusable workflow refs", () => {
  for (const jobId of ["call-external", "'call-external'", '"call-external"']) {
    const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  ${jobId}: { uses: example/repository/.github/workflows/reusable.yml@main }
`);

    assert.match(
      errors.join("\n"),
      /flow-style reusable workflow jobs are not allowed/,
    );
  }
});

test("rejects anchored flow-style jobs that hide mutable reusable workflow refs", () => {
  const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  call-external: &external { uses: example/repository/.github/workflows/reusable.yml@main }
`);

  assert.match(
    errors.join("\n"),
    /flow-style reusable workflow jobs are not allowed/,
  );
});

test("rejects block-style jobs with quoted uses keys hiding mutable reusable workflow refs", () => {
  for (const usesKey of ["'uses'", '"uses"']) {
    const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  call-external:
    ${usesKey}: example/repository/.github/workflows/reusable.yml@main
`);

    assert.match(errors.join("\n"), /full 40-character commit SHA/);
  }
});

test("accepts unrelated flow-style jobs with quoted IDs", () => {
  const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  'build-job': { runs-on: ubuntu-latest, steps: [{ run: "echo policy fixture" }] }
`);

  assert.deepEqual(errors, []);
});

test("accepts unrelated anchored flow-style steps and aliases", () => {
  const errors = validateWorkflowText(
    workflow(`      - &echo-step { name: Echo, run: echo policy fixture }
      - *echo-step`),
  );

  assert.deepEqual(errors, []);
});

test("accepts unrelated anchored flow-style jobs and aliases", () => {
  const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  build: &base-job { runs-on: ubuntu-latest, steps: [{ run: "echo policy fixture" }] }
  verify: *base-job
`);

  assert.deepEqual(errors, []);
});

test("accepts block-style local reusable workflow jobs", () => {
  for (const usesKey of ["uses", "'uses'", '"uses"']) {
    const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  call-local:
    ${usesKey}: ./.github/workflows/reusable.yml
`);

    assert.deepEqual(errors, []);
  }
});

test("accepts quoted keys unrelated to workflow policy", () => {
  const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

'env':
  "POLICY_FIXTURE": quoted

jobs:
  verify:
    'runs-on': ubuntu-latest
    steps:
      - "run": echo policy fixture
`);

  assert.deepEqual(errors, []);
});

test("accepts escaped quoted keys unrelated to workflow policy", () => {
  const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - "na\\u006de": Echo
        run: echo policy fixture
`);

  assert.deepEqual(errors, []);
});

test("accepts unrelated flow-style list data", () => {
  const errors = validateWorkflowText(`name: Policy fixture
on: pull_request

permissions:
  contents: read

jobs:
  verify:
    strategy:
      matrix:
        include:
          - { os: ubuntu-latest, node: 24 }
    runs-on: \${{ matrix.os }}
    steps:
      - run: node --version
`);

  assert.deepEqual(errors, []);
});

test("rejects excessive workflow permissions", () => {
  const errors = validateWorkflowText(
    workflow("      - uses: ./local-action", "permissions:\n  contents: write"),
  );

  assert.match(errors.join("\n"), /permissions must be exactly contents: read/);
});

test("rejects double-quoted escaped job-level permissions", () => {
  const errors = validateWorkflowText(
    workflow(String.raw`      - run: echo policy fixture`).replace(
      "    runs-on: ubuntu-latest",
      String.raw`    "permi\u0073sions":
      contents: write
    runs-on: ubuntu-latest`,
    ),
  );

  assert.match(errors.join("\n"), /job-level permissions are not allowed/);
});

test("rejects checkout credentials unless persistence is explicitly disabled", () => {
  for (const usesKey of ["uses", "'uses'", '"uses"']) {
    const errors = validateWorkflowText(
      workflow(`      - ${usesKey}: actions/checkout@${checkoutSha}`),
    );

    assert.match(errors.join("\n"), /persist-credentials: false/);
  }
});
