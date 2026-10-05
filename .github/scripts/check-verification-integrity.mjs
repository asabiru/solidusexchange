import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { collectRunCommands } from "./check-workflow-policy.mjs";

const BASELINE_FILE = fileURLToPath(
  new URL("./verification-integrity-baseline.json", import.meta.url),
);

const CODE_FILE = /\.(?:cjs|mjs|js|cts|mts|ts)$/;
const SHELL_FILE = /\.sh$/;
const TEST_PATH = /\.test\.[cm]?[jt]s$|(?:^|[/\\])tests?[/\\]/;
const SKIPPED_DIRECTORY = new Set([
  ".git",
  ".test-dist",
  ".server-dist",
  "coverage",
  "dist",
  "node_modules",
]);

const NPM_RUN_REFERENCE = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g;
const FOCUSED_OR_SKIPPED_TEST = /[A-Za-z_$][\w$]*\??\s*\.\s*(?:only|skip|todo)\s*\(/;
const X_PREFIXED_TEST = /\bx(?:describe|it|test|suite|specify|context)\s*\(/;
const TEST_OPTION_FLAG = /[{,]\s*(?:only|skip|todo)\s*:\s*[^\s}]/;
const SELECTIVE_TEST_FLAG = /--test-(?:only|name-pattern|skip-pattern)\b/;
const EARLY_PROCESS_EXIT = /process\s*\.\s*exit\s*\(/;
const EARLY_SHELL_EXIT = /^\s*exit\s+0\b/;

export function normalizeCommand(text) {
  return text.replace(/\s+/g, " ").trim();
}

export function validatePackageScripts(packageText, pinned, fileName) {
  let manifest;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    return [`${fileName}: package.json must be valid JSON`];
  }

  const scripts = manifest.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [`${fileName}: package.json must declare a scripts object`];
  }

  const errors = [];
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

export function validateRunSteps(workflowText, pinnedCommands, fileName) {
  const lines = workflowText.split(/\r?\n/);
  const actual = collectRunCommands(lines).map(({ text }) =>
    normalizeCommand(text),
  );

  return pinnedCommands
    .filter((command) => !actual.includes(command))
    .map(
      (command) =>
        `${fileName}: required run step is missing: ${JSON.stringify(command)}`,
    );
}

export function validateSourceText(text, fileName) {
  const code = CODE_FILE.test(fileName);
  const testFile = TEST_PATH.test(fileName);
  const errors = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (code && (FOCUSED_OR_SKIPPED_TEST.test(line) || X_PREFIXED_TEST.test(line))) {
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
    if ((code || SHELL_FILE.test(fileName)) && SELECTIVE_TEST_FLAG.test(line)) {
      errors.push(
        `${fileName}:${index + 1}: selective node test flags are not allowed`,
      );
    }
    if (SHELL_FILE.test(fileName) && testFile && EARLY_SHELL_EXIT.test(line)) {
      errors.push(
        `${fileName}:${index + 1}: test scripts must not exit 0 early`,
      );
    }
  });

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

  for (const [file, commands] of Object.entries(baseline.runSteps ?? {})) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      errors.push(`${file}: pinned workflow file is missing`);
      continue;
    }
    errors.push(...validateRunSteps(text, commands, file));
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
