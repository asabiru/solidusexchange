import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { collectRunCommands } from "./check-workflow-policy.mjs";

const BASELINE_FILE = fileURLToPath(
  new URL("./verification-integrity-baseline.json", import.meta.url),
);

const CODE_FILE = /\.(?:cjs|mjs|js|cts|mts|ts)$/;
const SHELL_FILE = /\.sh$/;
const TEST_FILE = /\.test\.[cm]?[jt]s$/;
const TEST_PATH = /\.test\.[^/\\]+$|(?:^|[/\\])tests?[/\\]/;
const SKIPPED_DIRECTORY = new Set([
  ".git",
  ".test-dist",
  ".server-dist",
  "coverage",
  "dist",
  "node_modules",
]);

const NPM_RUN_REFERENCE = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g;
const FOCUSED_OR_SKIPPED_TEST =
  /[A-Za-z_$][\w$]*\??\s*(?:\.\s*|\[\s*['"`])(?:only|skip|todo)['"`]?\s*\]?\s*\(/;
const X_PREFIXED_TEST = /\bx(?:describe|it|test|suite|specify|context)\s*\(/;
const TEST_OPTION_FLAG = /[{,]\s*['"`]?(?:only|skip|todo)['"`]?\s*:\s*\S/;
const SELECTIVE_TEST_FLAG = /--test-(?:only|name-pattern|skip-pattern)\b/;
const EARLY_PROCESS_EXIT =
  /process\s*(?:\.\s*|\[\s*['"`])(?:exit|reallyExit)['"`]?\s*\]?\s*\(/;
const SHELL_EXIT = /(?:^|[\s;&|{}()])\s*exit\s*([^;\n]*)/g;
const SHELL_EXIT_ARG = /^[1-9][0-9]*$/;
const TEST_CASE = /(?:^|[^\w$])(?:test|it|specify)\s*\(/g;
const KEY_LINE = /^["']?([A-Za-z_][\w-]*)["']?\s*:/;
const NODE_OPTIONS = /\bNODE_OPTIONS\b/;
const FLOW_CONTROL_KEY = /[{,]\s*['"`]?(?:env|shell|working-directory|defaults)['"`]?\s*:/;

export function normalizeCommand(text) {
  return text.replace(/\s+/g, " ").trim();
}

function indentation(line) {
  return line.match(/^\s*/)[0].length;
}

export function validatePackageScripts(packageText, pinned, fileName) {
  let manifest;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    return [`${fileName}: package.json must be valid JSON`];
  }

  const errors = [];
  if (NODE_OPTIONS.test(packageText)) {
    errors.push(`${fileName}: NODE_OPTIONS is not allowed`);
  }

  const scripts = manifest.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    errors.push(`${fileName}: package.json must declare a scripts object`);
    return errors;
  }

  for (const [name, command] of Object.entries(pinned)) {
    const actual = scripts[name];
    if (typeof actual !== "string") {
      errors.push(`${fileName}: required script "${name}" is missing`);
    } else if (actual !== command) {
      errors.push(
        `${fileName}: script "${name}" must be exactly ${JSON.stringify(command)}`,
      );
    }
  }

  return errors;
}

export function validateScriptReferences(pinned, fileName) {
  const errors = [];

  for (const [name, command] of Object.entries(pinned)) {
    for (const match of command.matchAll(NPM_RUN_REFERENCE)) {
      if (!Object.hasOwn(pinned, match[1])) {
        errors.push(
          `${fileName}: script "${name}" delegates to unpinned script "${match[1]}"`,
        );
      }
    }
  }

  return errors;
}

export function validateRunSteps(workflowText, pinnedSteps, fileName) {
  const lines = workflowText.split(/\r?\n/);
  const actual = collectRunCommands(lines).map(({ text, env }) => ({
    run: normalizeCommand(text),
    env: normalizeCommand(env),
  }));

  const errors = pinnedSteps
    .filter(
      (pinned) =>
        !actual.some(
          (step) =>
            step.run === pinned.run &&
            step.env === normalizeCommand(pinned.env ?? ""),
        ),
    )
    .map(
      (pinned) =>
        `${fileName}: required run step is missing: ${JSON.stringify(pinned.run)}`,
    );

  const pinnedRuns = new Set(pinnedSteps.map((pinned) => pinned.run));
  for (const step of actual) {
    if (step.run.startsWith("working-directory:") && !pinnedRuns.has(step.run)) {
      errors.push(
        `${fileName}: defaults.run.working-directory must match the baseline: ${JSON.stringify(step.run)}`,
      );
    }
  }

  return errors;
}

export function validateWorkflowSurface(workflowText, fileName) {
  const errors = [];
  const stack = [];

  workflowText.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    if (NODE_OPTIONS.test(line)) {
      errors.push(
        `${fileName}:${index + 1}: NODE_OPTIONS is not allowed in workflows`,
      );
    }
    if (FLOW_CONTROL_KEY.test(trimmed)) {
      errors.push(
        `${fileName}:${index + 1}: flow-style env/shell/working-directory/defaults keys are not allowed`,
      );
    }

    const dash = trimmed.startsWith("- ") || trimmed === "-";
    const body = dash ? trimmed.replace(/^-\s*/, "") : trimmed;
    const keyMatch = body.match(KEY_LINE);
    const lineIndent = indentation(line);

    if (dash) {
      while (stack.length && stack.at(-1).indent >= lineIndent) {
        stack.pop();
      }
      stack.push({ indent: lineIndent, name: "<item>" });
    }

    if (!keyMatch) {
      return;
    }

    const keyIndent = dash ? lineIndent + 2 : lineIndent;
    while (stack.length && stack.at(-1).indent >= keyIndent) {
      stack.pop();
    }

    const ancestors = stack.map(({ name }) => name);
    const key = keyMatch[1];

    if (key === "shell") {
      errors.push(
        `${fileName}:${index + 1}: shell overrides are not allowed`,
      );
    }
    if (
      key === "env" &&
      !ancestors.includes("steps") &&
      !ancestors.includes("services")
    ) {
      errors.push(
        `${fileName}:${index + 1}: env is only allowed inside steps and services`,
      );
    }
    if (key === "working-directory") {
      const [parent, grandparent] = ancestors.slice(-2).reverse();
      if (!(parent === "run" && grandparent === "defaults")) {
        errors.push(
          `${fileName}:${index + 1}: working-directory is only allowed under defaults.run`,
        );
      }
    }

    stack.push({ indent: keyIndent, name: key });
  });

  return errors;
}

export function validateTestFileContent(text, pinned, fileName) {
  const errors = [];
  const nonBlank = text.split(/\r?\n/).filter((line) => line.trim()).length;

  if (nonBlank < pinned.minLines) {
    errors.push(
      `${fileName}: pinned test file must keep at least ${pinned.minLines} non-blank lines`,
    );
  }

  if (pinned.minCases) {
    const cases = (text.match(TEST_CASE) ?? []).length;
    if (cases < pinned.minCases) {
      errors.push(
        `${fileName}: pinned test file must keep at least ${pinned.minCases} test cases`,
      );
    }
  }

  return errors;
}

export function validateSourceText(text, fileName) {
  const code = CODE_FILE.test(fileName);
  const testFile = TEST_PATH.test(fileName);
  const errors = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (
      code &&
      (FOCUSED_OR_SKIPPED_TEST.test(line) || X_PREFIXED_TEST.test(line))
    ) {
      errors.push(
        `${fileName}:${index + 1}: tests must not be focused, skipped or marked todo`,
      );
    }
    if (code && testFile && TEST_OPTION_FLAG.test(line)) {
      errors.push(
        `${fileName}:${index + 1}: test option objects must not set only, skip or todo`,
      );
    }
    if (code && EARLY_PROCESS_EXIT.test(line)) {
      errors.push(
        `${fileName}:${index + 1}: checked-in scripts and tests must not call process.exit`,
      );
    }
    if (
      (code || SHELL_FILE.test(fileName)) &&
      SELECTIVE_TEST_FLAG.test(line)
    ) {
      errors.push(
        `${fileName}:${index + 1}: selective node test flags are not allowed`,
      );
    }
  });

  if (SHELL_FILE.test(fileName) && testFile) {
    for (const match of text.matchAll(SHELL_EXIT)) {
      const argument = match[1].trim().split(/\s+/)[0] ?? "";
      if (!SHELL_EXIT_ARG.test(argument)) {
        const line = text.slice(0, match.index).split("\n").length;
        errors.push(
          `${fileName}:${line}: test scripts must only exit with an explicit nonzero status`,
        );
      }
    }
  }

  return errors;
}

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY.has(entry.name)) {
        yield* walk(resolved);
      }
    } else if (entry.isFile()) {
      yield resolved;
    }
  }
}

async function main() {
  const baseline = JSON.parse(await readFile(BASELINE_FILE, "utf8"));
  const errors = [];

  for (const [file, pinned] of Object.entries(baseline.scripts ?? {})) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      errors.push(`${file}: pinned package manifest is missing`);
      continue;
    }
    errors.push(...validatePackageScripts(text, pinned, file));
    errors.push(...validateScriptReferences(pinned, file));
  }

  for (const [file, steps] of Object.entries(baseline.runSteps ?? {})) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      errors.push(`${file}: pinned workflow file is missing`);
      continue;
    }
    errors.push(...validateRunSteps(text, steps, file));
    errors.push(...validateWorkflowSurface(text, file));
  }

  for (const [file, pinned] of Object.entries(baseline.testFiles ?? {})) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      errors.push(`${file}: pinned test file is missing`);
      continue;
    }
    errors.push(...validateTestFileContent(text, pinned, file));
  }

  for await (const file of walk(process.cwd())) {
    const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
    if (!CODE_FILE.test(relative) && !SHELL_FILE.test(relative)) {
      continue;
    }
    errors.push(
      ...validateSourceText(await readFile(file, "utf8"), relative),
    );
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log("verification-integrity-ok");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
