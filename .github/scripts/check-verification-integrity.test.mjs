import assert from "node:assert/strict";
import test from "node:test";

import {
  validatePackageScripts,
  validateRunSteps,
  validateScriptReferences,
  validateSourceText,
} from "./check-verification-integrity.mjs";

const DOT = ".";
const SKIP = "s" + "kip";
const ONLY = "o" + "nly";
const TODO = "t" + "odo";
const TEST_FLAG = "--test-" + "skip-pattern";

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

const pinnedSteps = ["npm ci", "npm test"];

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

test("rejects focused, skipped, todo and x-prefixed tests", () => {
  const variants = [
    `test${DOT}${ONLY}("name", () => {});`,
    `describe${DOT}${SKIP}("name", () => {});`,
    `it${DOT}${TODO}("name");`,
    `t${DOT}${SKIP}();`,
    `context${DOT}${ONLY}("name", () => {});`,
    `x` + `describe("name", () => {});`,
    `x` + `test("name", () => {});`,
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
  assert.notDeepEqual(validateSourceText(body, "a.test.mjs"), []);
});

test("rejects process exit and selective test flags in code", () => {
  for (const variant of [
    `process${DOT}exit(0);`,
    `process ${DOT} exit (0);`,
    `node --test ` + TEST_FLAG + ` smoke`,
  ]) {
    assert.notDeepEqual(validateSourceText(variant, "scripts/check.mjs"), [], variant);
  }
});

test("rejects early exit 0 in shell tests", () => {
  const script = "#!/bin/sh\nset -e\nexit 0\n";
  assert.notDeepEqual(validateSourceText(script, "tests/probe.sh"), []);
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
    validateSourceText("kill \"$pid\" 2>/dev/null || true\nexit 1\n", "tests/probe.sh"),
    [],
  );
});
