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
  const valid = workflow("      - run: echo ok");

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
      workflow("      - run: echo ok").replace(
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
      - run: echo ok
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
      - run: echo ok
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
    workflow("      - run: echo ok")
      .replace("on:", String.raw`"o\u006e":`)
      .replace("  pull_request:", "  'pull_request':")
      .replace("  push:", String.raw`  "pu\u0073h":`)
      .replace("    branches:", "    'branches':"),
  );

  assert.deepEqual(errors, []);
});

test("rejects additional automatic triggers on validation workflows", () => {
  const valid = workflow("      - run: echo ok");

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
    workflow("      - run: echo ok")
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
    workflow("      - run: echo ok").replace(
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

test("rejects local actions whose contents bypass workflow policy", () => {
  for (const step of [
    "      - uses: ./.github/actions/unpinned",
    "      - 'uses': ./local-action",
    '      - "u\\u0073es": ./local-action',
    "      - name: nested\n        uses: ./.github/workflows/action.yml",
    "      - &step\n        uses: ./",
  ]) {
    assert.match(
      validateWorkflowText(workflow(step)).join("\n"),
      /local actions are not allowed/,
      step,
    );
  }

  for (const target of [
    "./.github/actions/unpinned",
    "./.github/workflows/../actions/unpinned.yml",
    "./reusable.yml",
  ]) {
    assert.match(
      jobsWorkflow(`  call-local:\n    uses: ${target}`).join("\n"),
      /local actions are not allowed/,
      target,
    );
  }
});

test("rejects mutable container and service images in any key spelling or placement", () => {
  const digest = `postgres@sha256:${"a".repeat(64)}`;
  for (const job of [
    "    container: node:latest",
    "    container:\n      image: node:latest",
    "    container: { image: node }",
    "    container:\n      { image: node }",
    "    container: ${{ matrix.image }}",
    "    container: *image",
    `    container: node@sha256:${"a".repeat(64)}x`,
    `    container:\n      image: ${digest}\n      image: node`,
    '    "cont\\x61iner":\n      "im\\u0061ge": node',
    "    services:\n      redis:\n        image: redis:7",
    "    services:\n      redis: redis",
    "    services:\n      redis: { image: redis }",
    "    services: { redis: { image: redis } }",
    "    services:\n      redis:\n        env:\n          A: b",
    "    'services':\n      redis:\n        'image': redis",
  ]) {
    const errors = jobsWorkflow(
      `  verify:\n    runs-on: ubuntu-latest\n${job}\n    steps:\n      - run: echo ok`,
    );
    assert.match(
      errors.join("\n"),
      /container and service images must use an immutable sha256 digest|services must be block mappings/,
      job,
    );
  }

  for (const job of [
    "  verify: { runs-on: ubuntu-latest, container: node, steps: [{ run: echo ok }] }",
    '  verify:\n    { runs-on: ubuntu-latest,\n      "services": { redis: { image: redis } }, steps: [{ run: echo ok }] }',
    "  verify: &verify\n    runs-on: ubuntu-latest\n    container: node\n    steps:\n      - run: echo ok",
  ]) {
    assert.match(
      jobsWorkflow(job).join("\n"),
      /container and services must use block mappings|immutable sha256 digest/,
      job,
    );
  }

  assert.match(
    validateWorkflowText(
      workflow("      - run: echo ok")
        .replace("jobs:", '"jobs":')
        .replace("    steps:", "    container: node\n    steps:"),
    ).join("\n"),
    /immutable sha256 digest/,
  );
});

test("accepts digest-pinned container and service images and unrelated image data", () => {
  const digest = `postgres:16@sha256:${"a".repeat(64)}`;
  const errors = jobsWorkflow(`  verify:
    runs-on: ubuntu-latest
    container:
      image: ${digest}
      options: --cpus 1
    services:
      postgres2:
        image: "${digest}" # pinned
        ports:
          - 5432:5432
    strategy:
      matrix:
        include: [{ image: node, container: node }]
    steps:
      - uses: actions/setup-node@${checkoutSha}
        with:
          container: node
          image: node
      - run: echo container: node
  scalar:
    runs-on: ubuntu-latest
    container: ${digest}
    steps:
      - run: echo ok`);

  assert.deepEqual(errors, []);
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
    workflow("      - run: echo ok", "permissions:\n  contents: write"),
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
        env:
          REPORT: \${{ !cancelled() && !startsWith(github.ref, 'refs/tags/') }}
        run: |
          [ ! -f missing.txt ] && echo "policy fixture!"`),
  );

  assert.deepEqual(errors, []);
});

function jobsWorkflow(jobs, fileName) {
  return validateWorkflowText(
    `name: Policy fixture
${validationTriggers}

permissions:
  contents: read

jobs:
${jobs}
`,
    fileName,
  );
}

test("rejects expressions interpolated into run scripts in any key or scalar spelling", () => {
  for (const step of [
    '      - run: echo "${{ github.head_ref }}"',
    "      - run: |\n          echo \"${{ github.event.pull_request.title }}\"",
    "      - run: >-\n          echo\n          ${{ github.event.issue.body }}",
    "      - run: echo safe\n          ${{ github.event.comment.body }}",
    "      - 'run': echo ${{ github.head_ref }}",
    '      - "r\\u0075n": echo ${{ github.head_ref }}',
    String.raw`      - run: "echo \x24{{ github.head_ref }}"`,
    String.raw`      - run: "echo $\u007b{ github.head_ref }}"`,
    "      - run: \"echo $\\\n          {{ github.head_ref }}\"",
    "      - name: Echo\n        run: echo ${{ toJSON(github.event) }}",
    "      - { name: Echo, run: \"echo ${{ github['head_ref'] }}\" }",
    "      - &echo { run: echo ${{ GITHUB.HEAD_REF }} }",
    "      - {\n          run: \"echo ${{ github.event.pull_request.head.ref }}\" }",
    "      - name: Echo\n        env:\n          TITLE: &title ${{ github.event.pull_request.title }}\n        run: *title",
  ]) {
    const errors = validateWorkflowText(workflow(step));

    assert.match(errors.join("\n"), /run steps must not interpolate expressions/, step);
  }

  for (const step of ["      - run: echo ${{ github.head_ref }}"]) {
    const errors = validateWorkflowText(
      `name: Deploy
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
${step}
`,
      ".github/workflows/deploy.yml",
    );

    assert.match(errors.join("\n"), /run steps must not interpolate expressions/);
  }
});

test("accepts untrusted values passed to run scripts through env", () => {
  const errors = validateWorkflowText(
    workflow(`      - name: Echo branch
        env:
          HEAD_REF: \${{ github.head_ref }}
          TITLE: \${{ github.event.pull_request.title }}
        working-directory: \${{ github.workspace }}
        run: |
          echo "$HEAD_REF" "$TITLE" "\${HOME}" '$\\{{ literal }}'
          printf '%s\\n' "$ {{ not an expression }}"`),
  );

  assert.deepEqual(errors, []);
});

test("rejects continue-on-error that hides failing jobs or steps", () => {
  for (const jobs of [
    "  verify:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n    steps:\n      - run: npm test",
    "  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n        continue-on-error: true",
    "  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n        'continue-on-error': ${{ true }}",
    String.raw`  verify:
    runs-on: ubuntu-latest
    "continue-on-error": True
    steps:
      - run: npm test`,
    String.raw`  verify:
    runs-on: ubuntu-latest
    "continue-on-\u0065rror":
      true
    steps:
      - run: npm test`,
    "  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - { run: npm test, continue-on-error: true }",
    "  verify: { runs-on: ubuntu-latest, continue-on-error: true, steps: [{ run: npm test }] }",
  ]) {
    const errors = jobsWorkflow(jobs);

    assert.match(errors.join("\n"), /continue-on-error must be omitted or false/, jobs);
  }
});

test("accepts explicit continue-on-error false", () => {
  const errors = jobsWorkflow(
    "  verify:\n    runs-on: ubuntu-latest\n    continue-on-error: false\n    steps:\n      - { run: npm test, 'continue-on-error': false }",
  );

  assert.deepEqual(errors, []);
});

test("rejects conditional jobs and steps in validation workflows", () => {
  for (const jobs of [
    "  verify:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test",
    "  verify:\n    if: ${{ always() }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test",
    "  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n        if: ${{ false }}",
    "  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - if: github.event_name == 'never'\n        run: npm test",
    "  verify:\n    runs-on: ubuntu-latest\n    'if': false\n    steps:\n      - run: npm test",
    String.raw`  verify:
    runs-on: ubuntu-latest
    "i\u0066": false
    steps:
      - run: npm test`,
    "  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - { if: false, run: npm test }",
    "  verify: { if: false, runs-on: ubuntu-latest, steps: [{ run: npm test }] }",
  ]) {
    const errors = jobsWorkflow(jobs);

    assert.match(errors.join("\n"), /must not be conditional/, jobs);
  }
});

test("accepts run script text and data that only resemble conditions", () => {
  const errors = jobsWorkflow(`  verify:
    runs-on: ubuntu-latest
    steps:
      - name: "if: in a name"
        run: |
          if: true
          continue-on-error: true
          if [ -f package.json ]; then echo ok; fi
      - run: >-
          echo
          if: folded`);

  assert.deepEqual(errors, []);
});

test("accepts conditional steps in the approved manual workflow", () => {
  const errors = validateWorkflowText(
    `name: Deploy
on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - if: \${{ !cancelled() }}
        run: echo deploy
`,
    ".github/workflows/deploy.yml",
  );

  assert.deepEqual(errors, []);
});
