import assert from "node:assert/strict";
import test from "node:test";

import {
  validateBaselineShape,
  validateLegacyRemoval,
  validatePackageScripts,
  validateRepoCompleteness,
  validateRunSteps,
  validateScriptReferences,
  validateSourceText,
  validateTestFileContent,
  validateWorkflowRefs,
  validateWorkflowSurface,
} from "./check-verification-integrity.mjs";

const DOT = ".";
const SKIP = "s" + "kip";
const ONLY = "o" + "nly";
const TODO = "t" + "odo";
const EXIT = "e" + "xit";
const PROCESS = "pro" + "cess";
const EXIT_CODE = "exit" + "Code";
const GLOBAL = "global" + "This";
const IMPORT = "im" + "port";

const baselineFixture = {
  scripts: { "pkg/package.json": { test: "npm test" } },
  runSteps: { ".github/workflows/ci.yml": [{ run: "npm test" }] },
  testFiles: { "pkg/tests/a.test.mjs": { minLines: 2, minCases: 1 } },
  uses: { ".github/workflows/ci.yml": ["actions/checkout@abc123"] },
  containerImages: { ".github/workflows/ci.yml": ["img@sha256:x"] },
  triggerPaths: {
    ".github/workflows/ci.yml": { pull_request: ["pkg/**"] },
  },
  unpinnedTestFiles: ["pkg/tests/helper.mjs"],
};

test("rejects malformed or empty baselines", () => {
  assert.match(
    validateBaselineShape([]).join("\n"),
    /baseline must be a JSON object/,
  );
  assert.match(
    validateBaselineShape({}).join("\n"),
    /missing "scripts" section/,
  );
  assert.match(
    validateBaselineShape({ ...baselineFixture, testFiles: {} }).join("\n"),
    /"testFiles" must pin at least one test file/,
  );
  assert.match(
    validateBaselineShape({ ...baselineFixture, scripts: {} }).join("\n"),
    /"scripts" must pin at least one package manifest/,
  );
  assert.match(
    validateBaselineShape({
      ...baselineFixture,
      testFiles: { "a.test.mjs": { minLines: "two", minCases: 1 } },
    }).join("\n"),
    /must pin integer minLines/,
  );
  assert.match(
    validateBaselineShape({
      ...baselineFixture,
      unpinnedTestFiles: ["a.mjs", "a.mjs"],
    }).join("\n"),
    /must list unique file paths/,
  );
});

test("rejects unpinned or swapped workflow action and image references", () => {
  const workflowText = `on:\n  pull_request:\n    paths:\n      - "pkg/**"\njobs:\n  verify:\n    steps:\n      - uses: actions/checkout@abc123\n      - uses: actions/setup-node@def456\n`;
  assert.match(
    validateWorkflowRefs(
      workflowText,
      { uses: {}, containerImages: {}, triggerPaths: {} },
      "ci.yml",
    ).join("\n"),
    /"uses" references must be pinned in the baseline/,
  );
  const pinned = {
    uses: { "ci.yml": ["actions/checkout@abc123"] },
    containerImages: {},
    triggerPaths: { "ci.yml": { pull_request: ["pkg/**"] } },
  };
  assert.match(
    validateWorkflowRefs(workflowText, pinned, "ci.yml").join("\n"),
    /"uses" references must match the baseline exactly/,
  );
});

test("rejects trigger path filter drift in workflows", () => {
  const workflowText = `on:\n  pull_request:\n    paths:\n      - "pkg/**"\n  push:\n    branches:\n      - main\n    paths:\n      - "pkg/**"\n      - "shared/**"\njobs:\n  verify:\n    steps: []\n`;
  const baseline = {
    uses: {},
    containerImages: {},
    triggerPaths: { "ci.yml": { pull_request: ["pkg/**"] } },
  };
  assert.match(
    validateWorkflowRefs(workflowText, baseline, "ci.yml").join("\n"),
    /push path filter must be pinned in the baseline/,
  );
  const drifted = {
    ...baseline,
    triggerPaths: {
      "ci.yml": { pull_request: ["pkg/**"], push: ["pkg/**"] },
    },
  };
  assert.match(
    validateWorkflowRefs(workflowText, drifted, "ci.yml").join("\n"),
    /push path filter must match the baseline exactly/,
  );
});

test("rejects unpinned test surface, manifests and stale waivers", () => {
  const files = [
    "pkg/package.json",
    "pkg/tests/a.test.mjs",
    "pkg/tests/helper.mjs",
    "pkg/tests/new.test.mjs",
    ".github/workflows/ci.yml",
    ".github/workflows/new-ci.yml",
    "other/package.json",
  ];
  const errors = validateRepoCompleteness(files, baselineFixture).join("\n");
  assert.match(errors, /new\.test\.mjs: test surface file must be pinned/);
  assert.match(errors, /new-ci\.yml: workflow must be pinned/);
  assert.match(errors, /other\/package\.json: package manifest must be pinned/);
  assert.match(
    validateRepoCompleteness(["pkg/package.json"], baselineFixture).join("\n"),
    /helper\.mjs: stale unpinnedTestFiles entry/,
  );
});
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

test("rejects scripts that are not pinned in the baseline", () => {
  const added = manifest({ postinstall: "node hooks/install.mjs" });
  assert.match(
    validatePackageScripts(added, pinnedScripts, "pkg").join("\n"),
    /script "postinstall" is not pinned in the baseline/,
  );
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

test("rejects added workflow run steps", () => {
  const extended = workflow.replace(
    "        run: npm test\n",
    "        run: npm test\n      - name: Build\n        run: npm run build\n",
  );
  assert.match(
    validateRunSteps(extended, pinnedSteps, "ci.yml").join("\n"),
    /run step is not pinned in the baseline: "npm run build"/,
  );
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
    `${PROCESS}${DOT}${EXIT}(0);`,
    `${PROCESS} ${DOT} ${EXIT} (0);`,
    `${PROCESS}${DOT}really${"Ex"}it(0);`,
    `${PROCESS}["${EXIT}"](0);`,
    `${PROCESS}["really${"Ex"}it"](1);`,
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
  const content = 'test("a", () => {});\nit("b", () => {});\nconst seed = 1;\n';
  assert.deepEqual(validateTestFileContent(content, pinned, "t.test.mjs"), []);
});

test("rejects comment and string padding in pinned test file counts", () => {
  const commentPadded =
    'test("a", () => {});\n// padded comment\n/* block\n   pad */\nit("b", () => {});\n';
  assert.deepEqual(
    validateTestFileContent(commentPadded, { minLines: 3, minCases: 2 }, "t.test.mjs"),
    ["t.test.mjs: pinned test file must keep at least 3 non-blank lines"],
  );
  const stringPadded =
    'test("a", () => {});\nit("b", () => {});\nconst note = "it(\\"fake\\")";\n';
  assert.deepEqual(
    validateTestFileContent(stringPadded, { minLines: 3, minCases: 3 }, "t.test.mjs"),
    ["t.test.mjs: pinned test file must keep at least 3 test cases"],
  );
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
      `${PROCESS}.${EXIT_CODE} = 1;\ndescribe("x", () => { it("y", () => {}); });\n`,
      "tests/a.test.mjs",
    ),
    [],
  );
  assert.deepEqual(
    validateSourceText(
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "trap cleanup EXIT",
        `trap 'rm -rf "$scratch"' EXIT`,
        'kill "$pid" 2>/dev/null || true',
        "set +e",
        'output="$(psql -f probe.sql 2>&1)"',
        "status=$?",
        "  set -e",
        'source="$1"',
        'echo "source state must not change"',
        "exit 1",
        "if false; then exit 2; fi",
        "",
      ].join("\n"),
      "tests/probe.sh",
    ),
    [],
  );
});

test("rejects aliased, reflected and indirect process access", () => {
  for (const variant of [
    `const p = ${PROCESS}; p.${EXIT}(0);`,
    `const { ${EXIT} } = ${PROCESS}; ${EXIT}(0);`,
    `${PROCESS}\n  .${EXIT}(0);`,
    `(${PROCESS} as any).${EXIT}(0);`,
    `${PROCESS}?.${EXIT}(0);`,
    `Reflect.apply(${PROCESS}.${EXIT}, ${PROCESS}, [0]);`,
    `${PROCESS}.${EXIT}.call(${PROCESS}, 0);`,
    `const quit = ${PROCESS}.${EXIT}.bind(${PROCESS});`,
    `${PROCESS}.abort();`,
    `${PROCESS}.kill(${PROCESS}.pid);`,
    `${PROCESS}.on("${EXIT}", () => {});`,
    `${PROCESS}.getBuiltin` + `Module("node:os");`,
    `${GLOBAL}["${PROCESS}"].env;`,
    `${GLOBAL}?.["${PROCESS}"].env;`,
    `Object.values(${GLOBAL});`,
    `import p from "node:${PROCESS}";`,
    `import { ${EXIT} } from "${PROCESS}";`,
    `import vm from "node:v` + `m";`,
    `const m = await ${IMPORT}("node:" + name);`,
    `const m = await ${IMPORT}(\`./\${name}.mjs\`);`,
    `const m = re` + `quire(name);`,
    `ev` + `al("1");`,
    `new Func` + `tion("return 1")();`,
    `(() => {}).con` + `structor("return 1")();`,
    `fn["con` + `structor"]("return 1");`,
    `createRe` + `quire(import.meta.url);`,
  ]) {
    assert.notDeepEqual(
      validateSourceText(variant, "packages/x/tests/a.test.mjs"),
      [],
      variant,
    );
  }
});

test("rejects success exit codes and reflective exit code writes", () => {
  for (const variant of [
    `${PROCESS}.${EXIT_CODE} = 0;`,
    `${PROCESS}.${EXIT_CODE} = 00;`,
    `${PROCESS}.${EXIT_CODE} = failed ? 1 : 0;`,
    `${PROCESS}.${EXIT_CODE} = 1; ${PROCESS}.${EXIT_CODE} = 0;`,
    `${PROCESS}.${EXIT_CODE} ??= 0;`,
    `${PROCESS}.${EXIT_CODE} = code;`,
    `delete ${PROCESS}.${EXIT_CODE};`,
    `target.${EXIT_CODE} = 0;`,
    `Object.defineProperty(target, "${EXIT_CODE}", { value: 0 });`,
  ]) {
    assert.notDeepEqual(
      validateSourceText(variant, "scripts/check.mjs"),
      [],
      variant,
    );
  }
});

test("accepts plain process members and pinned launcher code", () => {
  assert.deepEqual(
    validateSourceText(
      [
        `const root = ${PROCESS}.cwd();`,
        `const file = ${PROCESS}.argv[1];`,
        `const value = ${PROCESS}.env[name]?.trim();`,
        `spawnSync(${PROCESS}.execPath, ["--version"]);`,
        `for await (const chunk of ${PROCESS}.stdin) {}`,
        `${PROCESS}.stdout.write("ok\\n");`,
        `  ${PROCESS}.${EXIT_CODE} = 1;`,
        `const text = "No ${PROCESS} outside the signer boundary";`,
        `const client = await import("./client.js");`,
        `globalThis.fetch = stub;`,
        `const groups = ["con` + `structor", "toString"];`,
      ].join("\n"),
      "packages/x/scripts/check.mjs",
    ),
    [],
  );
  const launcher = `${PROCESS}.${EXIT_CODE} = code;\n${PROCESS}.on("SIGINT", stop);\n`;
  assert.deepEqual(validateSourceText(launcher, "backoffice/scripts/dev.mjs"), []);
  assert.notDeepEqual(validateSourceText(launcher, "backoffice/scripts/other.mjs"), []);
});

function shellTest(...body) {
  return ["#!/usr/bin/env bash", "set -euo pipefail", ...body, ""].join("\n");
}

test("rejects traps that override a failing shell test status", () => {
  for (const variant of [
    `trap "${EXIT} 0" EXIT`,
    `trap '${EXIT} 0' ERR`,
    "trap - ERR",
    "trap '' ERR",
    "trap ok EXIT",
    "trap cleanup EXIT ERR",
    "trap cleanup INT",
    `tr""ap cleanup EXIT`,
    "builtin trap cleanup EXIT",
    `trap 'rm -rf "$scratch"; ${EXIT} 0' EXIT`,
  ]) {
    assert.notDeepEqual(
      validateSourceText(shellTest(variant, "false"), "tests/probe.sh"),
      [],
      variant,
    );
  }
});

test("rejects disabled errexit and dynamic shell evaluation", () => {
  const variants = [
    ["set +e", "false"],
    ["set +e", "set +e", "set -e"],
    ["set -e"],
    ["set +o errexit"],
    ["set +eu"],
    ["set -euo pipefail; set +e"],
    ["shopt -u -o errexit"],
    [`ev` + `al "${EXIT} 0"`],
    [`ex""it 0`],
    [`$'${EXIT}' 0`],
    [`e\\xit 0`],
    [`cmd=${EXIT}`, "$cmd 0"],
    ["exec true"],
    ["source ./neutral.sh"],
    [". ./neutral.sh"],
    ["true && . ./neutral.sh"],
    ["alias ok=true"],
    ["enable -n false"],
  ];
  for (const body of variants) {
    assert.notDeepEqual(
      validateSourceText(shellTest(...body), "tests/probe.sh"),
      [],
      body.join("; "),
    );
  }
  for (const header of ["set -eu", "set -uo pipefail", ""]) {
    const script = `#!/usr/bin/env bash\n${header}\nfalse\n`;
    assert.notDeepEqual(validateSourceText(script, "tests/probe.sh"), [], header);
  }
});

test("rejects escaped identifiers, specifiers and wrapped status codes", () => {
  const BS = "\\";
  for (const variant of [
    `pro${BS}u0063ess.${EXIT}(0);`,
    `${BS}u{70}rocess.${EXIT}(0);`,
    `${PROCESS}.${BS}u0065xit(0);`,
    `test.${BS}u0073` + `kip("name");`,
    `import p from "node:proc${BS}x65ss";`,
    `const m = await ${IMPORT}("node:proc${BS}x65ss");`,
    `import { Module } from "node:mod` + `ule";`,
    `import { Session } from "node:inspe` + `ctor";`,
    `import { WASI } from "node:wa` + `si";`,
    `const m = module.re` + `quire(name);`,
    `${PROCESS}.${EXIT_CODE} = 256;`,
  ]) {
    assert.notDeepEqual(
      validateSourceText(variant, "packages/x/tests/a.test.mjs"),
      [],
      variant,
    );
  }
  for (const body of [
    [`${EXIT} 256`],
    [`${EXIT} 512`],
    ["builtin set +e", "false"],
    ["command set +e", "false"],
    ["true; set +e"],
  ]) {
    assert.notDeepEqual(
      validateSourceText(shellTest(...body), "tests/probe.sh"),
      [],
      body.join("; "),
    );
  }
  assert.deepEqual(
    validateSourceText(shellTest(`${EXIT} 255`), "tests/probe.sh"),
    [],
  );
});

test("rejects focused and skipped tests hidden by comments and line breaks", () => {
  for (const variant of [
    `it /* focus */ ${DOT}${ONLY}("x", () => {});`,
    `test("x")${DOT}\n  ${DOT}${ONLY}`,
    `it\n${DOT}${ONLY}("x", () => {});`,
    `describe("s")\n${DOT}${SKIP}(() => {});`,
    `it("x", {\n  ${ONLY}: true\n}, () => {});`,
  ]) {
    assert.notDeepEqual(
      validateSourceText(`import test from "node:test";\n${variant}\n`, "a.test.mjs"),
      [],
      variant,
    );
  }
});

test("rejects shell exit aliases built from glued expansions", () => {
  for (const variant of [
    `e$(:)${EXIT} 0`,
    `e$(echo xi)t 0`,
    `e\`echo xi\`t 0`,
    `e$VARt 0`,
  ]) {
    assert.notDeepEqual(
      validateSourceText(shellTest(variant), "tests/probe.sh"),
      [],
      variant,
    );
  }
  assert.deepEqual(
    validateSourceText(shellTest("value=$(git rev-parse HEAD)\necho \"$value\""), "tests/probe.sh"),
    [],
  );
});

test("rejects reappearing legacy application paths", () => {
  // every removed root directory trips the tripwire on its first file
  for (const dir of [
    "app",
    "assets",
    "bootstrap",
    "config",
    "database",
    "deployment",
    "resources",
    "routes",
    "SQL",
    "storage",
    "tests",
    "vendor",
  ]) {
    const file = `${dir}/x.php`;
    assert.notDeepEqual(validateLegacyRemoval([file]), [], file);
  }

  // every removed root file trips the tripwire on its own name
  for (const file of [
    ".env.example",
    ".editorconfig",
    ".gitattributes",
    ".github/workflows/deploy.yml",
    ".htaccess",
    "artisan",
    "composer.json",
    "composer.lock",
    "firebase-messaging-sw.js",
    "index.php",
    "package-lock.json",
    "php.local.ini",
    "phpunit.xml",
    "vite.config.js",
    "Documentation/bybit-exchange-engine.md",
    "Documentation/cryptocloud-setup.md",
    "Documentation/exchange-treasury-foundation.md",
    "Documentation/index.html",
    "Documentation/safe-deploy.md",
    "Documentation/sumsub-local-setup.md",
  ]) {
    assert.notDeepEqual(validateLegacyRemoval([file]), [], file);
  }

  // a bare dir name at the root is a removed legacy entry too
  assert.notDeepEqual(validateLegacyRemoval(["app"]), []);

  // the same names nested inside the new core are legitimate
  assert.deepEqual(
    validateLegacyRemoval([
      "packages/x/tests/probe.mjs",
      "packages/x/config/index.ts",
      "packages/x/package-lock.json",
      "miniapp/src/app/App.tsx",
      "backoffice/tests/postgres-store.sh",
      "Documentation/regulated-core/safe-deploy.md",
      "packages/vendor/x/package.json",
    ]),
    [],
  );

  // one error per reappearing entry, not per file
  assert.equal(
    validateLegacyRemoval([
      "app/Http/Kernel.php",
      "app/Services/x.php",
      "routes/api.php",
    ]).length,
    2,
  );
});
