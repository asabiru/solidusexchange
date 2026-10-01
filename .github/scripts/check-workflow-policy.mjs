import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SHA_REF = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)*@[0-9a-f]{40}$/i;
const DOCKER_DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/i;
const FLOW_USES_KEY =
  /^-\s*(?:&[^\s,[\]{}]+\s+)?\{(?:\s*|[^{}]*,\s*)(?:uses|"uses"|'uses')\s*:/;
const FLOW_JOB_USES_KEY =
  /^(?:[A-Za-z_][A-Za-z0-9_-]*|"[A-Za-z_][A-Za-z0-9_-]*"|'[A-Za-z_][A-Za-z0-9_-]*'):\s*(?:&[^\s,[\]{}]+\s+)?\{(?:\s*|[^{}]*,\s*)(?:uses|"uses"|'uses')\s*:/;
const BLOCK_USES_KEY = /^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:\s*(.+)$/;
const DOUBLE_QUOTED_KEY = /"((?:[^"\\]|\\.)*)"(\s*:)/g;

function indentation(line) {
  return line.match(/^\s*/)[0].length;
}

function scalar(value) {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  const quote = withoutComment[0];

  if ((quote === '"' || quote === "'") && withoutComment.at(-1) === quote) {
    return withoutComment.slice(1, -1);
  }

  return withoutComment;
}

function decodesToUses(value) {
  const decoded = value.replace(
    /\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8}))/g,
    (escape, short, long, full) => {
      const codePoint = Number.parseInt(short ?? long ?? full, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : escape;
    },
  );

  return decoded === "uses";
}

function normalizeUsesKeys(line) {
  return line.replace(DOUBLE_QUOTED_KEY, (match, value, separator) =>
    decodesToUses(value) ? `uses${separator}` : match,
  );
}

function checkoutCredentialErrors(lines, usesIndex, usesIndent, fileName) {
  const errors = [];
  let withIndex = -1;

  for (let index = usesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = indentation(line);
    if (indent < usesIndent || (indent === usesIndent && !trimmed.startsWith("with:"))) {
      break;
    }

    if (indent === usesIndent && trimmed === "with:") {
      withIndex = index;
      break;
    }
  }

  if (withIndex === -1) {
    return [`${fileName}:${usesIndex + 1}: actions/checkout must set persist-credentials: false`];
  }

  const values = [];
  for (let index = withIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (indentation(line) <= usesIndent) {
      break;
    }

    const match = trimmed.match(/^persist-credentials:\s*(.+)$/);
    if (match) {
      values.push({ line: index + 1, value: scalar(match[1]) });
    }
  }

  if (values.length !== 1 || values[0].value !== "false") {
    errors.push(
      `${fileName}:${usesIndex + 1}: actions/checkout must set persist-credentials: false exactly once`,
    );
  }

  return errors;
}

export function validateWorkflowText(text, fileName = "<workflow>") {
  const lines = text.split(/\r?\n/);
  const errors = [];
  const rootPermissions = [];
  let jobsIndent = -1;
  let jobIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const policyLine = normalizeUsesKeys(line);
    const trimmed = policyLine.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = indentation(line);
    if (indent === 0 && /^jobs:\s*(?:#.*)?$/.test(trimmed)) {
      jobsIndent = indent;
      jobIndent = -1;
    } else if (jobsIndent !== -1 && indent <= jobsIndent) {
      jobsIndent = -1;
      jobIndent = -1;
    } else if (jobsIndent !== -1 && jobIndent === -1) {
      jobIndent = indent;
    }

    if (
      jobsIndent !== -1 &&
      indent === jobIndent &&
      FLOW_JOB_USES_KEY.test(trimmed)
    ) {
      errors.push(
        `${fileName}:${index + 1}: flow-style reusable workflow jobs are not allowed`,
      );
      continue;
    }

    if (FLOW_USES_KEY.test(trimmed)) {
      errors.push(
        `${fileName}:${index + 1}: flow-style uses mappings are not allowed`,
      );
      continue;
    }

    const permissionsMatch = line.match(/^(\s*)permissions:\s*(.*?)\s*$/);
    if (permissionsMatch) {
      if (indent !== 0) {
        errors.push(`${fileName}:${index + 1}: job-level permissions are not allowed`);
        continue;
      }

      rootPermissions.push(index);
      if (scalar(permissionsMatch[2])) {
        errors.push(
          `${fileName}:${index + 1}: workflow permissions must be exactly contents: read`,
        );
        continue;
      }

      const entries = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        const childLine = lines[child];
        const childTrimmed = childLine.trim();

        if (!childTrimmed || childTrimmed.startsWith("#")) {
          continue;
        }

        if (indentation(childLine) === 0) {
          break;
        }

        const entry = childTrimmed.match(/^([A-Za-z-]+):\s*(.+)$/);
        if (entry) {
          entries.push([entry[1], scalar(entry[2])]);
        } else {
          entries.push(["<invalid>", childTrimmed]);
        }
      }

      if (
        entries.length !== 1 ||
        entries[0][0] !== "contents" ||
        entries[0][1] !== "read"
      ) {
        errors.push(
          `${fileName}:${index + 1}: workflow permissions must be exactly contents: read`,
        );
      }
    }

    const usesMatch = policyLine.match(BLOCK_USES_KEY);
    if (!usesMatch) {
      continue;
    }

    const action = scalar(usesMatch[1]);
    if (action.startsWith("./")) {
      continue;
    }

    if (action.startsWith("docker://")) {
      if (!DOCKER_DIGEST.test(action)) {
        errors.push(
          `${fileName}:${index + 1}: Docker actions must use an immutable sha256 digest`,
        );
      }
      continue;
    }

    if (!SHA_REF.test(action)) {
      errors.push(
        `${fileName}:${index + 1}: external actions must use a full 40-character commit SHA`,
      );
    }

    if (action.toLowerCase().startsWith("actions/checkout@")) {
      const usesIndent = /^\s*-\s*(?:uses|"uses"|'uses')\s*:/.test(policyLine)
        ? indent + 2
        : indent;
      errors.push(...checkoutCredentialErrors(lines, index, usesIndent, fileName));
    }
  }

  if (rootPermissions.length !== 1) {
    errors.push(`${fileName}: workflow must declare one top-level permissions block`);
  }

  return errors;
}

async function workflowFiles() {
  const directory = path.resolve(".github/workflows");
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function main() {
  const files = await workflowFiles();
  const errors = [];

  for (const file of files) {
    const relative = path.relative(process.cwd(), file);
    errors.push(...validateWorkflowText(await readFile(file, "utf8"), relative));
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`workflow-policy-ok (${files.length} workflows)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
