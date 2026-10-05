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
const PROCESS = "pro" + "cess";
const EXIT_CODE = "exit" + "Code";
const EARLY_PROCESS_EXIT = new RegExp(
  PROCESS +
    "\\s*(?:\\.\\s*|\\[\\s*['\"`])(?:exit|reallyExit)['\"`]?\\s*\\]?\\s*\\(",
);
const PROCESS_REFERENCE = new RegExp(`(?<![\\w$])${PROCESS}(?![\\w$])`, "g");
const PROCESS_MEMBER = /^\s*\.\s*([A-Za-z_$][\w$]*)(?![\w$])/;
const PROSE_WORD = /^[ \t]+([a-z]+)(?![\w$])/;
const OPERATOR_WORDS = new Set(["as", "in", "instanceof", "satisfies"]);
const PROCESS_MEMBERS = new Set([
  "argv",
  "cwd",
  "env",
  "execPath",
  EXIT_CODE,
  "stderr",
  "stdin",
  "stdout",
]);
const PINNED_PROCESS_MEMBERS = {
  "backoffice/scripts/dev.mjs": ["on"],
};
const EXIT_CODE_REFERENCE = new RegExp(`(?<![\\w$])${EXIT_CODE}(?![\\w$])`, "g");
const NONZERO_EXIT_CODE = new RegExp(
  `^${PROCESS}\\.${EXIT_CODE} = (?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]);?$`,
);
const PINNED_EXIT_CODE_LINES = {
  "backoffice/scripts/dev.mjs": [`${PROCESS}.${EXIT_CODE} = code;`],
};
const DYNAMIC_CODE = [
  new RegExp(
    "(?<![\\w$])(?:ev" +
      "al|Func" +
      "tion|createRe" +
      "quire|getBuiltin" +
      "Module|runIn(?:This|New)?Con" +
      "text|compileFunc" +
      "tion)(?![\\w$])",
  ),
  new RegExp(
    `["'\`](?:node:)?(?:${PROCESS}|v` + "m|mod" + "ule|inspe" + "ctor|wa" + "si|re" + "pl)[\"'`]",
  ),
  new RegExp(
    "(?<![\\w$])(?:im" +
      "port|re" +
      "quire)\\s*\\(\\s*(?![\"'][^\"'`$+\\\\]*[\"']\\s*\\))",
  ),
  new RegExp("\\.\\s*con" + "structor(?![\\w$])"),
  new RegExp("[\\w$)\\]]\\s*\\[\\s*[\"'`]con" + "structor"),
  new RegExp("(?<![\\w$.])(?:global" + "This|glo" + "bal)\\s*(?:\\?\\.)?\\s*\\["),
  new RegExp(
    "(?:Object|Reflect)\\s*\\.\\s*[\\w$]+\\s*\\(\\s*(?:global" +
      "This|glo" +
      "bal)(?![\\w$])",
  ),
];
const SHELL_EXIT = /(?:^|[\s;&|{}()=$`])\s*exit\s*([^;\n]*)/g;
const SHELL_QUOTING = /["'\\]/g;
const ASCII_ESCAPE = /\\(?:u\{0*([2-7][0-9a-fA-F])\}|u00([2-7][0-9a-fA-F])|x([2-7][0-9a-fA-F]))/g;
const SHELL_COMMAND_PREFIX = "(?:^|[;&|{}()`]|\\b(?:then|do|else))\\s*";
const SHELL_FORBIDDEN_WORD = new RegExp(
  "(?<![\\w-])(?:ev" + "al|exec|alias|shopt|enable|trap|BASH_ENV|SHELLOPTS)(?![\\w-])",
);
const SHELL_SOURCE = new RegExp(
  `${SHELL_COMMAND_PREFIX}(?:source|\\.)[ \\t]+[^=\\s]`,
);
const SHELL_SET = /(?<![\w-])set(?:\s+[-+]|\s*$)/;
const SHELL_STRICT_MODE = "set -euo pipefail";
const PINNED_TRAP_LINES = new Set([
  "trap cleanup EXIT",
  `trap 'rm -rf "$scratch"' EXIT`,
  `trap 'rm -f "$output_one" "$output_two"' EXIT`,
]);
const SHELL_EXIT_ARG = /^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
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

function decodeAsciiEscapes(text) {
  return text.replace(ASCII_ESCAPE, (escape, ...digits) => {
    const value = Number.parseInt(digits.find(Boolean), 16);
    return value > 0x7e ? escape : String.fromCharCode(value);
  });
}

export function validateSourceText(raw, fileName) {
  const code = CODE_FILE.test(fileName);
  const text = code ? decodeAsciiEscapes(raw) : raw;
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
        `${fileName}:${index + 1}: checked-in scripts and tests must not call ${PROCESS}.exit`,
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

  if (code && (testFile || !fileName.startsWith("assets/"))) {
    errors.push(...validateProcessAccess(text, fileName));
  }

  if (SHELL_FILE.test(fileName) && testFile) {
    errors.push(...validateShellControl(text, fileName));
    const unquoted = text.replace(SHELL_QUOTING, "");
    for (const match of unquoted.matchAll(SHELL_EXIT)) {
      const argument = match[1].trim().split(/\s+/)[0] ?? "";
      if (!SHELL_EXIT_ARG.test(argument)) {
        const line = lineAt(unquoted, match.index);
        errors.push(
          `${fileName}:${line}: test scripts must only exit with an explicit nonzero status`,
        );
      }
    }
  }

  return errors;
}

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function validateProcessAccess(text, fileName) {
  const errors = [];
  const lines = text.split("\n");
  const pinnedMembers = PINNED_PROCESS_MEMBERS[fileName] ?? [];
  const pinnedExitCodes = PINNED_EXIT_CODE_LINES[fileName] ?? [];

  for (const match of text.matchAll(PROCESS_REFERENCE)) {
    const rest = text.slice(match.index + PROCESS.length);
    const member = rest.match(PROCESS_MEMBER)?.[1];
    const prose = rest.match(PROSE_WORD)?.[1];
    if (
      member
        ? !PROCESS_MEMBERS.has(member) && !pinnedMembers.includes(member)
        : !prose || OPERATOR_WORDS.has(prose)
    ) {
      errors.push(
        `${fileName}:${lineAt(text, match.index)}: ${PROCESS} may only be used as ${PROCESS}.<${[...PROCESS_MEMBERS].join("|")}>`,
      );
    }
  }

  for (const match of text.matchAll(EXIT_CODE_REFERENCE)) {
    const line = lineAt(text, match.index);
    const statement = lines[line - 1].trim();
    if (
      !NONZERO_EXIT_CODE.test(statement) &&
      !pinnedExitCodes.includes(statement)
    ) {
      errors.push(
        `${fileName}:${line}: ${EXIT_CODE} may only be set to a literal nonzero status`,
      );
    }
  }

  lines.forEach((line, index) => {
    if (DYNAMIC_CODE.some((pattern) => pattern.test(line))) {
      errors.push(
        `${fileName}:${index + 1}: dynamic code, module or global-object access is not allowed`,
      );
    }
  });

  return errors;
}

function validateShellControl(text, fileName) {
  const errors = [];
  const modes = [];

  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(SHELL_QUOTING, "");
    const statement = raw.trim();
    const location = `${fileName}:${index + 1}`;

    if (
      SHELL_FORBIDDEN_WORD.test(line) &&
      !PINNED_TRAP_LINES.has(statement)
    ) {
      errors.push(
        `${location}: test scripts must not use dynamic evaluation, exec, alias, shopt, enable or unpinned traps`,
      );
    }
    if (SHELL_SOURCE.test(line)) {
      errors.push(`${location}: test scripts must not source other files`);
    }
    if (SHELL_SET.test(line)) {
      if (
        statement !== SHELL_STRICT_MODE &&
        statement !== "set +e" &&
        statement !== "set -e"
      ) {
        errors.push(
          `${location}: test scripts may only use "${SHELL_STRICT_MODE}", "set +e" and "set -e"`,
        );
      } else {
        modes.push({ statement, location });
      }
    }
  });

  if (modes[0]?.statement !== SHELL_STRICT_MODE) {
    errors.push(
      `${fileName}: test scripts must start with "${SHELL_STRICT_MODE}"`,
    );
  }
  let errexit = true;
  for (const { statement, location } of modes.slice(1)) {
    if (statement === SHELL_STRICT_MODE || statement === "set -e" ? errexit : !errexit) {
      errors.push(`${location}: "set +e" must be followed by exactly one "set -e"`);
    }
    errexit = statement !== "set +e";
  }
  if (!errexit) {
    errors.push(`${fileName}: "set +e" is never restored with "set -e"`);
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
