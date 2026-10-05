import assert from "node:assert/strict";
import test from "node:test";

import {
  validatePackageScripts,
  validateRunSteps,
  validateScriptReferences,
  validateSourceText,
  validateTestFileContent,
  validateWorkflowSurface,
} from "./check-verification-integrity.mjs";

const DOT = ".";
const SKIP = "s" + "kip";
const ONLY = "o" + "nly";
const TODO = "t" + "odo";
const EXIT = "e" + "xit";
const TEST_FLAG = "--test-" + "skip-pattern";
const NODE_ENV_OPTIONS = "NODE_" + "OPTIONS";

const pinnedScripts = {
  check: "node scripts/check.mjs",
  test: "node --test tests/*.test.mjs",
  verify: "npm run check && npm test",
};

function manifest(overrides) {
  return JSON.stringify({ scripts: { ...pinnedScripts, ...overrides } });
}

test("accepts scripts matching the pin exactly", () => {
  assert.deepEqual(validatePackageScripts(manifest(), pinnedScripts, "pkg"), []);
});

test("rejects neutered script commands", () => {
  for (const command of [
    "true",
    "echo ok",
    "exit 0",
    "node --test tests/*.test.mjs || true",
    "node --test tests/*.test.mjs; exit 0",
    "node --test --test-" + "name-pattern smoke tests/*.test.mjs",
    "node --test " + TEST_FLAG + " smoke tests/*.test.mjs",
  ]) {
    assert.notDeepEqual(
      validatePackageScripts(manifest({ test: command }), pinnedScripts, "pkg"),
      [],
      command,
    );
  }
});

test("rejects missing and glob-narrowed scripts", () => {
  const missing = JSON.stringify({ scripts: { check: pinnedScripts.check } });
  assert.match(
    validatePackageScripts(missing, pinnedScripts, "pkg").join("\n"),
    /required script "test" is missing/,
  );

  const narrowed = manifest({ test: "node --test tests/smoke.test.mjs" });
  assert.match(
    validatePackageScripts(narrowed, pinnedScripts, "pkg").join("\n"),
    /script "test" must be exactly/,
  );
});

test("rejects NODE_OPTIONS in package manifests", () => {
  const poisoned = manifest({
    test: `${NODE_ENV_OPTIONS}=--require ./hook.cjs node --test tests/*.test.mjs`,
  });
  assert.match(
    validatePackageScripts(poisoned, { test: "x" }, "pkg").join("\n"),
    /NODE_OPTIONS is not allowed/,
  );
});

test("rejects pinned scripts delegating to an unpinned script", () => {
  const pinned = { verify: "npm run real-verify" };
  assert.match(
    validateScriptReferences(pinned, "pkg").join("\n"),
    /delegates to unpinned script "real-verify"/,
  );
  assert.deepEqual(
    validateScriptReferences(
      { verify: "npm run real-verify", "real-verify": "node check.mjs" },
      "pkg",
    ),
    [],
  );
});

const workflow = `jobs:
  verify:
    steps:
      - name: Install
        run: npm ci
      - name: Test
        run: npm test
`;

const pinnedSteps = [
  { run: "npm ci" },
  { run: "npm test" },
];

test("rejects deleted or rewritten workflow run steps", () => {
  for (const mutation of [
    workflow.replace("      - name: Test\n        run: npm test\n", ""),
    workflow.replace("run: npm test", "run: echo ok"),
    workflow.replace("run: npm test", "run: npm test || true"),
  ]) {
    assert.notDeepEqual(
      validateRunSteps(mutation, pinnedSteps, "ci.yml"),
      [],
      mutation,
    );
  }
});

test("accepts added workflow run steps", () => {
  const extended = workflow.replace(
    "        run: npm test\n",
    "        run: npm test\n      - name: Build\n        run: npm run build\n",
  );
  assert.deepEqual(validateRunSteps(extended, pinnedSteps, "ci.yml"), []);
});

test("rejects env mutations on pinned run steps", () => {
  const pinned = [{ run: "npm test", env: "A: 1" }];
  const base = `jobs:
  verify:
    steps:
      - name: Test
        env:
          A: 1
        run: npm test
`;
  assert.deepEqual(validateRunSteps(base, pinned, "ci.yml"), []);
  assert.notDeepEqual(
    validateRunSteps(base.replace("A: 1", "A: 2"), pinned, "ci.yml"),
    [],
  );
  assert.notDeepEqual(
    validateRunSteps(base.replace("        env:\n          A: 1\n", ""), pinned, "ci.yml"),
    [],
  );
  const injected = base.replace(
    "        env:\n          A: 1\n",
    `        env:\n          A: 1\n          ${NODE_ENV_OPTIONS}: --require ./hook.cjs\n`,
  );
  assert.notDeepEqual(validateRunSteps(injected, pinned, "ci.yml"), []);
  assert.notDeepEqual(validateWorkflowSurface(injected, "ci.yml"), []);
});

test("rejects un-baselined working-directory defaults", () => {
  const mutated = `jobs:
  verify:
    defaults:
      run:
        working-directory: stub
    steps:
      - run: npm test
`;
  assert.notDeepEqual(validateRunSteps(mutated, pinnedSteps, "ci.yml"), []);
});

test("rejects shell overrides and misplaced env or working-directory", () => {
  const stepShell = workflow.replace(
    "        run: npm test",
    '        shell: "true {0}"\n        run: npm test',
  );
  const jobEnv = `jobs:
  verify:
    env:
      ${NODE_ENV_OPTIONS}: --require ./hook.cjs
    steps:
      - run: npm test
`;
  const stepWd = workflow.replace(
    "        run: npm test",
    "        working-directory: stub\n        run: npm test",
  );
  const topEnv = `env:\n  ${NODE_ENV_OPTIONS}: --require ./hook.cjs\n` + workflow;
  const defaultsShell = `jobs:
  verify:
    defaults:
      run:
        shell: bash -o pipefail {0}
    steps:
      - run: npm test
`;

  const flowStep = workflow.replace(
    "      - name: Test\n        run: npm test",
    '      - {name: "Test", run: "npm test", shell: bash}',
  );
  const flowDefaults = workflow.replace(
    "    steps:",
    '    defaults: {run: {"working-directory": stub}}\n    steps:',
  );

  for (const mutation of [
    stepShell,
    jobEnv,
    stepWd,
    topEnv,
    defaultsShell,
    flowStep,
    flowDefaults,
  ]) {
    assert.notDeepEqual(
      validateWorkflowSurface(mutation, "ci.yml"),
      [],
      mutation,
    );
  }
});

test("accepts defaults.run.working-directory and services env", () => {
  const valid = `jobs:
  verify:
    defaults:
      run:
        working-directory: pkg
    services:
      postgres:
        env:
          POSTGRES_USER: test
    steps:
      - name: Test
        env:
          PSQL_DOCKER_IMAGE: postgres@sha256:abc
        run: npm test
`;
  assert.deepEqual(validateWorkflowSurface(valid, "ci.yml"), []);
});

test("rejects focused, skipped, todo, x-prefixed and bracket-access tests", () => {
  const variants = [
    `test${DOT}${ONLY}("name", () => {});`,
    `describe${DOT}${SKIP}("name", () => {});`,
    `it${DOT}${TODO}("name");`,
    `t${DOT}${SKIP}();`,
    `context${DOT}${ONLY}("name", () => {});`,
    `test?.${SKIP}("name");`,
    `test["${SKIP}"]("name");`,
    `describe['${ONLY}']("name", () => {});`,
    `x` + `describe("name", () => {});`,
    `x` + `test("name", () => {});`,
    `x` + `it("name", () => {});`,
  ];
  for (const variant of variants) {
    assert.notDeepEqual(
      validateSourceText(`import test from "node:test";\n${variant}\n`, "a.test.mjs"),
      [],
      variant,
    );
  }
});

test("rejects test option objects that skip or focus", () => {
  const body = `test("name", { s` + `kip: true }, () => {});`;
  const quoted = `test("name", { "o` + `nly": true }, () => {});`;
  assert.notDeepEqual(validateSourceText(body, "a.test.mjs"), []);
  assert.notDeepEqual(validateSourceText(quoted, "a.test.mjs"), []);
});

test("rejects process exit aliases and selective test flags in code", () => {
  for (const variant of [
    `process${DOT}${EXIT}(0);`,
    `process ${DOT} ${EXIT} (0);`,
    `process${DOT}really${"Ex"}it(0);`,
    `process["${EXIT}"](0);`,
    `process["really${"Ex"}it"](1);`,
    `node --test ` + TEST_FLAG + ` smoke`,
  ]) {
    assert.notDeepEqual(
      validateSourceText(variant, "scripts/check.mjs"),
      [],
      variant,
    );
  }
});

test("rejects early success exits in shell tests", () => {
  for (const variant of ["exit", "exit 0", "exit 000", "exit $?", 'exit "$status"']) {
    const script = `#!/bin/sh\nset -e\n${variant}\n`;
    assert.notDeepEqual(
      validateSourceText(script, "tests/probe.sh"),
      [],
      variant,
    );
  }
});

test("accepts pinned test files that keep their case count", () => {
  const pinned = { minLines: 3, minCases: 2 };
  const content = 'test("a", () => {});\n// comment\nit("b", () => {});\n';
  assert.deepEqual(validateTestFileContent(content, pinned, "t.test.mjs"), []);
});

test("rejects emptied or thinned pinned test files", () => {
  const pinned = { minLines: 10, minCases: 4 };
  assert.notDeepEqual(validateTestFileContent("", pinned, "t.test.mjs"), []);
  assert.notDeepEqual(
    validateTestFileContent('test("only", () => {});\n', pinned, "t.test.mjs"),
    [],
  );
});

test("accepts ordinary scripts and tests", () => {
  assert.deepEqual(
    validateSourceText(
      'process.exitCode = 1;\ndescribe("x", () => { it("y", () => {}); });\n',
      "tests/a.test.mjs",
    ),
    [],
  );
  assert.deepEqual(
    validateSourceText(
      'kill "$pid" 2>/dev/null || true\nexit 1\nif false; then exit 2; fi\n',
      "tests/probe.sh",
    ),
    [],
  );
});
