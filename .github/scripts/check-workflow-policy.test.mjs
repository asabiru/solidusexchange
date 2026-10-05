import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkflowText } from "./check-workflow-policy.mjs";

const checkoutSha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";
const validationTriggers = `on:
  pull_request:
  push:
    branches:
      - main`;

function workflow(step, permissions = "permissions:\n  contents: read") {
  return `name: Policy fixture
${validationTriggers}

${permissions}

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
${step}
`;
}

test("rejects validation workflows missing required pull request or main push triggers", () => {
  const valid = workflow("      - uses: ./local-action");

  for (const mutation of [
    valid.replace("  pull_request:\n", ""),
    valid.replace("  push:\n    branches:\n      - main\n", ""),
    valid.replace("      - main", "      - feature"),
    valid.replace("  pull_request:", "  pull_request: false"),
  ]) {
    const errors = validateWorkflowText(mutation);

    assert.match(
      errors.join("\n"),
      /validation workflow must run for (pull requests|pushes to main)|push branches must include main|trigger must use a block mapping/,
    );
  }
});

test("accepts unfiltered main pushes and the approved manual deployment trigger", () => {
  assert.deepEqual(
    validateWorkflowText(
      workflow("      - uses: ./local-action").replace(
        "  push:\n    branches:\n      - main",
        "  push:",
      ),
    ),
    [],
  );

  assert.deepEqual(
    validateWorkflowText(
      `name: Deploy
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: ./local-action
`,
      ".github/workflows/deploy.yml",
    ),
    [],
  );
});

test("rejects automatic triggers on the approved manual deployment workflow", () => {
  const manualWorkflow = `name: Deploy
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: ./local-action
`;

  for (const automaticTrigger of [
    "  pull_request:\n",
    "  push:\n",
    "  schedule:\n    - cron: '0 0 * * *'\n",
  ]) {
    const errors = validateWorkflowText(
      manualWorkflow.replace(
        "  workflow_dispatch:\n",
        `${automaticTrigger}  workflow_dispatch:\n`,
      ),
      ".github/workflows/deploy.yml",
    );

    assert.match(errors.join("\n"), /must use only workflow_dispatch/);
  }
});

test("normalizes quoted trigger keys without changing unrelated YAML", () => {
  const errors = validateWorkflowText(
    workflow("      - uses: ./local-action")
      .replace("on:", String.raw`"o\u006e":`)
      .replace("  pull_request:", "  'pull_request':")
      .replace("  push:", String.raw`  "pu\u0073h":`)
      .replace("    branches:", "    'branches':"),
  );

  assert.deepEqual(errors, []);
});

test("rejects additional automatic triggers on validation workflows", () => {
  const valid = workflow("      - uses: ./local-action");

  for (const extraTrigger of [
    "  schedule:\n    - cron: '0 0 * * *'\n",
    "  pull_request_target:\n",
    "  workflow_run:\n    workflows: [Backoffice CI]\n",
    "  'pull_request_target':\n",
    String.raw`  "pull_request_t\u0061rget":` + "\n",
    "  <<: { schedule: [{ cron: '0 0 * * *' }] }\n",
    "  ? schedule\n  : [{ cron: '0 0 * * *' }]\n",
  ]) {
    const errors = validateWorkflowText(
      valid.replace("  pull_request:\n", `  pull_request:\n${extraTrigger}`),
    );

    assert.match(
      errors.join("\n"),
      /validation workflow triggers must be only pull_request and push/,
    );
  }
});

test("accepts filtered pull_request and push triggers on validation workflows", () => {
  const errors = validateWorkflowText(
    workflow("      - uses: ./local-action")
      .replace(
        "  pull_request:\n",
        "  'pull_request':\n    # Path filters keep validation scoped.\n    paths:\n      - \"backoffice/**\"\n",
      )
      .replace("      - main", "      - main\n    paths:\n      - \"backoffice/**\""),
  );

  assert.deepEqual(errors, []);
});

test("rejects workflow_dispatch outside the approved manual workflow", () => {
  const errors = validateWorkflowText(
    workflow("      - uses: ./local-action").replace(
      "  pull_request:",
      "  workflow_dispatch:\n  pull_request:",
    ),
  );

  assert.match(errors.join("\n"), /workflow_dispatch is only allowed/);
});

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
${validationTriggers}

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
${validationTriggers}

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
${validationTriggers}

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
${validationTriggers}

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
${validationTriggers}

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
${validationTriggers}

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
${validationTriggers}

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
${validationTriggers}

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
${validationTriggers}

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

test("accepts quoted and escaped checkout credential keys", () => {
  for (const step of [
    `      - uses: actions/checkout@${checkoutSha}
        'with':
          'persist-credentials': false`,
    `      - uses: actions/checkout@${checkoutSha}
        "with":
          "persist-credentials": false`,
    String.raw`      - uses: actions/checkout@${checkoutSha}
        "w\u0069th":
          "persist-credentia\u006cs": false`,
  ]) {
    assert.deepEqual(validateWorkflowText(workflow(step)), []);
  }
});

test("rejects quoted or escaped duplicate with mappings overriding checkout hardening", () => {
  for (const withKey of ["'with'", '"with"', String.raw`"w\u0069th"`]) {
    const errors = validateWorkflowText(
      workflow(`      - uses: actions/checkout@${checkoutSha}
        with:
          persist-credentials: false
        ${withKey}:
          persist-credentials: true`),
    );

    assert.match(errors.join("\n"), /persist-credentials: false exactly once/);
  }
});

test("rejects quoted or escaped duplicate checkout credential inputs", () => {
  for (const persistKey of [
    "'persist-credentials'",
    '"persist-credentials"',
    String.raw`"persist-credentia\u006cs"`,
  ]) {
    const errors = validateWorkflowText(
      workflow(`      - uses: actions/checkout@${checkoutSha}
        with:
          persist-credentials: false
          ${persistKey}: true`),
    );

    assert.match(errors.join("\n"), /persist-credentials: false exactly once/);
  }
});

test("rejects flow-style jobs that declare job-level permissions", () => {
  for (const job of [
    "escalate: { runs-on: ubuntu-latest, permissions: write-all, steps: [{ run: echo policy fixture }] }",
    "'escalate': { runs-on: ubuntu-latest, 'permissions': { contents: write }, steps: [{ run: echo policy fixture }] }",
    String.raw`"escalate": &escalate { runs-on: ubuntu-latest, "permi\u0073sions": { id-token: write }, steps: [{ run: echo policy fixture }] }`,
    `escalate: {
      runs-on: ubuntu-latest, permissions: write-all,
      steps: [{ run: echo policy fixture }] }`,
    `escalate: { runs-on: ubuntu-latest,
      steps: [{ run: echo policy fixture }]
      , permissions: write-all }`,
  ]) {
    const errors = validateWorkflowText(`name: Policy fixture
${validationTriggers}

permissions:
  contents: read

jobs:
  ${job}
`);

    assert.match(errors.join("\n"), /job-level permissions are not allowed/, job);
  }
});

test("accepts flow-style jobs that only mention permissions in step text", () => {
  const errors = validateWorkflowText(`name: Policy fixture
${validationTriggers}

permissions:
  contents: read

jobs:
  build: { runs-on: ubuntu-latest, steps: [{ name: "Check permissions", run: "echo permissions: read-only" }] }
`);

  assert.deepEqual(errors, []);
});

test("rejects job-level permissions hidden by flow placement, tags, anchors or explicit keys", () => {
  for (const job of [
    `escalate:
    { runs-on: ubuntu-latest, permissions: write-all, steps: [{ run: echo policy fixture }] }`,
    "escalate: !!map { runs-on: ubuntu-latest, permissions: write-all, steps: [{ run: echo policy fixture }] }",
    "escalate: !<tag:yaml.org,2002:map> { runs-on: ubuntu-latest, permissions: write-all, steps: [{ run: echo policy fixture }] }",
    "escalate: { runs-on: ubuntu-latest, &perm permissions: write-all, steps: [{ run: echo policy fixture }] }",
    "escalate: { runs-on: ubuntu-latest, ? permissions : write-all, steps: [{ run: echo policy fixture }] }",
    `escalate:
    runs-on: ubuntu-latest
    !!str permissions: write-all
    steps:
      - run: echo policy fixture`,
    `escalate:
    runs-on: ubuntu-latest
    &perm permissions: write-all
    steps:
      - run: echo policy fixture`,
    `escalate:
    runs-on: ubuntu-latest
    ? permissions
    : write-all
    steps:
      - run: echo policy fixture`,
  ]) {
    const errors = validateWorkflowText(`name: Policy fixture
${validationTriggers}

permissions:
  contents: read

jobs:
  ${job}
`);

    assert.match(
      errors.join("\n"),
      /job-level permissions are not allowed|YAML tags are not allowed|explicit YAML keys are not allowed in jobs/,
      job,
    );
  }
});

test("rejects tagged flow-style steps that hide mutable external action refs", () => {
  const errors = validateWorkflowText(
    workflow("      - !!map { uses: actions/checkout@v4 }"),
  );

  assert.match(errors.join("\n"), /YAML tags are not allowed/);
});

test("accepts negated expressions and shell negation that resemble YAML tags", () => {
  const errors = validateWorkflowText(
    workflow(`      - name: Report
        if: \${{ !cancelled() && !startsWith(github.ref, 'refs/tags/') }}
        run: |
          [ ! -f missing.txt ] && echo "policy fixture!"`),
  );

  assert.deepEqual(errors, []);
});
