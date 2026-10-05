import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SHA_REF = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)*@[0-9a-f]{40}$/i;
const DOCKER_DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/i;
const IMAGE_DIGEST = /^[^@\s]+@sha256:[0-9a-f]{64}$/i;
const LOCAL_REUSABLE_WORKFLOW = /^\.\/\.github\/workflows\/[^/]+\.ya?ml$/;
const FLOW_USES_KEY =
  /^-\s*(?:&[^\s,[\]{}]+\s+)?\{(?:\s*|[^{}]*,\s*)(?:uses|"uses"|'uses')\s*:/;
const FLOW_JOB_USES_KEY =
  /^(?:[A-Za-z_][A-Za-z0-9_-]*|"[A-Za-z_][A-Za-z0-9_-]*"|'[A-Za-z_][A-Za-z0-9_-]*'):\s*(?:&[^\s,[\]{}]+\s+)?\{(?:\s*|[^{}]*,\s*)(?:uses|"uses"|'uses')\s*:/;
const FLOW_PERMISSIONS_KEY =
  /[{,]\s*(?:\?\s+)?(?:&[^\s,[\]{}]+\s+)?permissions\s*:/;
const YAML_TAG = /(?:^|[:?-]\s+|[{[,]\s*)!\S/;
const EXPRESSION = /\$\{\{.*?\}\}/g;
const EXPLICIT_KEY = /^\?(?:\s|$)/;
const BLOCK_USES_KEY = /^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:\s*(.+)$/;
const DOUBLE_QUOTED_KEY = /"((?:[^"\\]|\\.)*)"(\s*:)/g;
const SINGLE_QUOTED_KEY = /'((?:[^']|'')*)'(\s*:)/g;
const POLICY_KEYS = new Set(["uses", "permissions", "with", "persist-credentials"]);
const EXECUTION_KEYS = new Set(["run", "if", "continue-on-error"]);
const ANY_KEY = { has: () => true };
const FLOW_IMAGE_KEY =
  /[{,]\s*(?:\?\s+)?(?:&[^\s,[\]{}]+\s+)?(?:container|services)\s*:/;
const EXECUTION_KEY_PREFIX = String.raw`(^-\s+|^|[{,]\s*)(?:\?\s+)?(?:&[^\s,[\]{}]+\s+)?`;
const RUN_KEY = new RegExp(`${EXECUTION_KEY_PREFIX}run\\s*:(.*)$`);
const IF_KEY = new RegExp(`${EXECUTION_KEY_PREFIX}if\\s*:`);
const CONTINUE_ON_ERROR_KEY = new RegExp(
  `${EXECUTION_KEY_PREFIX}continue-on-error\\s*:\\s*([^,}]*)`,
);
const EXPRESSION_START = /\$\{\{/;
const TRIGGER_KEYS = new Set([
  "on",
  "pull_request",
  "push",
  "workflow_dispatch",
  "branches",
  "branches-ignore",
]);
const EVENT_KEYS = new Set(["pull_request", "push", "workflow_dispatch"]);
const BRANCH_KEYS = new Set(["branches", "branches-ignore"]);
const MANUAL_WORKFLOWS = new Set([".github/workflows/deploy.yml"]);

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

function decodeDoubleQuotedKey(value) {
  return value.replace(
    /\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8}))/g,
    (escape, short, long, full) => {
      const codePoint = Number.parseInt(short ?? long ?? full, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : escape;
    },
  );
}

function normalizeKeys(line, keys) {
  return line
    .replace(DOUBLE_QUOTED_KEY, (match, value, separator) => {
      const decoded = decodeDoubleQuotedKey(value);
      return keys.has(decoded) ? `${decoded}${separator}` : match;
    })
    .replace(SINGLE_QUOTED_KEY, (match, value, separator) => {
      const decoded = value.replace(/''/g, "'");
      return keys.has(decoded) ? `${decoded}${separator}` : match;
    });
}

function normalizePolicyKeys(line) {
  return normalizeKeys(line, POLICY_KEYS);
}

function childMappings(lines, parentIndex, keys, normalizedKeys = TRIGGER_KEYS) {
  const mappings = [];
  const parentIndent = indentation(lines[parentIndex]);
  let childIndent = -1;

  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = normalizeKeys(lines[index], normalizedKeys);
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = indentation(line);
    if (indent <= parentIndent) {
      break;
    }

    if (childIndent === -1) {
      childIndent = indent;
    }

    if (indent !== childIndent) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!keys || (match && keys.has(match[1]))) {
      mappings.push({
        index,
        indent,
        name: match?.[1],
        value: match ? scalar(match[2]) : trimmed,
      });
    }
  }

  return mappings;
}

function childListValues(lines, parentIndex) {
  const values = [];
  const parentIndent = indentation(lines[parentIndex]);

  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (indentation(line) <= parentIndent) {
      break;
    }

    const match = trimmed.match(/^-\s*(.+)$/);
    if (match) {
      values.push(scalar(match[1]));
    }
  }

  return values;
}

function triggerErrors(lines, fileName) {
  const errors = [];
  const onMappings = lines.flatMap((line, index) => {
    const normalized = normalizeKeys(line, TRIGGER_KEYS);
    const match =
      indentation(normalized) === 0
        ? normalized.trim().match(/^on:\s*(.*?)\s*$/)
        : null;
    return match ? [{ index, value: scalar(match[1]) }] : [];
  });

  if (onMappings.length !== 1 || onMappings[0].value) {
    return [`${fileName}: workflow must declare one block-style top-level on mapping`];
  }

  const directEvents = childMappings(lines, onMappings[0].index);
  const events = directEvents.filter(({ name }) => EVENT_KEYS.has(name));
  const eventCount = (name) => events.filter((event) => event.name === name).length;

  for (const event of events.filter(({ value }) => value)) {
    errors.push(
      `${fileName}:${event.index + 1}: ${event.name} trigger must use a block mapping`,
    );
  }

  if (MANUAL_WORKFLOWS.has(fileName.replaceAll("\\", "/"))) {
    if (
      directEvents.length !== 1 ||
      eventCount("workflow_dispatch") !== 1
    ) {
      errors.push(`${fileName}: approved manual workflow must use only workflow_dispatch`);
    }
    return errors;
  }

  if (eventCount("pull_request") !== 1) {
    errors.push(`${fileName}: validation workflow must run for pull requests`);
  }
  if (eventCount("push") !== 1) {
    errors.push(`${fileName}: validation workflow must run for pushes to main`);
  }
  if (eventCount("workflow_dispatch") !== 0) {
    errors.push(`${fileName}: workflow_dispatch is only allowed for approved manual workflows`);
  }
  for (const event of directEvents.filter(({ name }) => !EVENT_KEYS.has(name))) {
    errors.push(
      `${fileName}:${event.index + 1}: validation workflow triggers must be only pull_request and push`,
    );
  }

  const push = events.find((event) => event.name === "push");
  if (!push || push.value) {
    return errors;
  }

  const filters = childMappings(lines, push.index, BRANCH_KEYS);
  const branches = filters.filter(({ name }) => name === "branches");
  if (filters.some(({ name }) => name === "branches-ignore")) {
    errors.push(`${fileName}:${push.index + 1}: push trigger must include main explicitly`);
  } else if (branches.length > 0) {
    const branchValues =
      branches.length === 1 && !branches[0].value
        ? childListValues(lines, branches[0].index)
        : [];
    const mainCount = branchValues.filter((branch) => branch === "main").length;
    if (branches.length !== 1 || branches[0].value || mainCount !== 1) {
      errors.push(`${fileName}:${push.index + 1}: push branches must include main exactly once`);
    }
  }

  return errors;
}

function checkoutCredentialErrors(lines, usesIndex, usesIndent, fileName) {
  const withMappings = [];

  for (let index = usesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = normalizePolicyKeys(line).trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = indentation(line);
    if (indent < usesIndent) {
      break;
    }

    if (indent === usesIndent) {
      const withMatch = trimmed.match(/^with:\s*(.*)$/);
      if (withMatch) {
        withMappings.push({ index, value: scalar(withMatch[1]) });
      }
    }
  }

  if (withMappings.length === 0) {
    return [`${fileName}:${usesIndex + 1}: actions/checkout must set persist-credentials: false`];
  }

  if (withMappings.length !== 1 || withMappings[0].value) {
    return [
      `${fileName}:${usesIndex + 1}: actions/checkout must set persist-credentials: false exactly once`,
    ];
  }

  const withIndex = withMappings[0].index;
  const values = [];
  for (let index = withIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = normalizePolicyKeys(line).trim();

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

  const errors = [];
  if (values.length !== 1 || values[0].value !== "false") {
    errors.push(
      `${fileName}:${usesIndex + 1}: actions/checkout must set persist-credentials: false exactly once`,
    );
  }

  return errors;
}

function decodeRunText(text) {
  return decodeDoubleQuotedKey(text.replace(/\\\r?\n\s*/g, ""));
}

export function collectRunCommands(lines) {
  const commands = [];
  let contentIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = normalizeKeys(line, EXECUTION_KEYS).trim();
    const indent = indentation(line);

    if (contentIndent !== -1) {
      if (!trimmed || indent > contentIndent) {
        continue;
      }
      contentIndent = -1;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const runMatch = trimmed.match(RUN_KEY);
    if (!runMatch) {
      continue;
    }

    const keyIndent =
      runMatch.index === 0 ? indent + runMatch[1].length : indent;
    const parts = [runMatch[2]];
    for (let child = index + 1; child < lines.length; child += 1) {
      if (lines[child].trim() && indentation(lines[child]) <= keyIndent) {
        break;
      }
      parts.push(lines[child]);
    }

    const envParts = [];
    const grabEnv = (sibling) => {
      const envMatch = normalizeKeys(lines[sibling], EXECUTION_KEYS)
        .trim()
        .match(/^(?:env|"env"|'env')\s*:\s*(.*)$/);
      if (!envMatch) {
        return;
      }
      envParts.push(envMatch[1]);
      for (let child = sibling + 1; child < lines.length; child += 1) {
        if (lines[child].trim() && indentation(lines[child]) <= keyIndent) {
          break;
        }
        envParts.push(lines[child]);
      }
    };
    for (let sibling = index - 1; sibling >= 0; sibling -= 1) {
      const line2 = lines[sibling];
      if (!line2.trim()) {
        continue;
      }
      const siblingIndent = indentation(line2);
      if (siblingIndent < keyIndent) {
        break;
      }
      if (siblingIndent === keyIndent) {
        grabEnv(sibling);
      }
    }
    for (let sibling = index + 1; sibling < lines.length; sibling += 1) {
      const line2 = lines[sibling];
      if (!line2.trim()) {
        continue;
      }
      const siblingIndent = indentation(line2);
      if (siblingIndent < keyIndent) {
        break;
      }
      if (siblingIndent === keyIndent) {
        grabEnv(sibling);
      }
    }

    commands.push({
      index,
      text: decodeRunText(parts.join("\n")),
      env: decodeRunText(envParts.join("\n")),
    });
    contentIndent = keyIndent;
  }

  return commands;
}

function executionErrors(lines, fileName) {
  const errors = [];
  const validation = !MANUAL_WORKFLOWS.has(fileName.replaceAll("\\", "/"));
  let contentIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = normalizeKeys(line, EXECUTION_KEYS).trim();
    const indent = indentation(line);

    if (contentIndent !== -1) {
      if (!trimmed || indent > contentIndent) {
        continue;
      }
      contentIndent = -1;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const runMatch = trimmed.match(RUN_KEY);
    if (runMatch) {
      const keyIndent = runMatch.index === 0 ? indent + runMatch[1].length : indent;
      const parts = [runMatch[2]];
      for (let child = index + 1; child < lines.length; child += 1) {
        if (lines[child].trim() && indentation(lines[child]) <= keyIndent) {
          break;
        }
        parts.push(lines[child]);
      }

      const runText = decodeRunText(parts.join("\n"));
      if (EXPRESSION_START.test(runText) || /^\s*\*/.test(runMatch[2])) {
        errors.push(
          `${fileName}:${index + 1}: run steps must not interpolate expressions; pass values through env`,
        );
      }
      contentIndent = keyIndent;
    }

    const continueMatch = trimmed.match(CONTINUE_ON_ERROR_KEY);
    if (continueMatch && scalar(continueMatch[2]) !== "false") {
      errors.push(
        `${fileName}:${index + 1}: continue-on-error must be omitted or false`,
      );
    }

    if (validation && IF_KEY.test(trimmed)) {
      errors.push(
        `${fileName}:${index + 1}: validation workflow jobs and steps must not be conditional`,
      );
    }
  }

  return errors;
}

function imageReferenceErrors(lines, mapping, fileName) {
  const error = `${fileName}:${mapping.index + 1}: container and service images must use an immutable sha256 digest`;

  if (mapping.value) {
    return IMAGE_DIGEST.test(mapping.value) ? [] : [error];
  }

  const children = childMappings(lines, mapping.index, undefined, ANY_KEY);
  const images = children.filter(({ name }) => name === "image");
  if (
    children.some(({ name }) => !name) ||
    images.length !== 1 ||
    !IMAGE_DIGEST.test(images[0].value)
  ) {
    return [error];
  }

  return [];
}

function containerErrors(lines, fileName) {
  const errors = [];
  const jobsLine = lines.findIndex((line) =>
    /^jobs:\s*(?:#.*)?$/.test(normalizeKeys(line, ANY_KEY)),
  );
  if (jobsLine === -1) {
    return errors;
  }

  for (const job of childMappings(lines, jobsLine, undefined, ANY_KEY)) {
    const keys = childMappings(lines, job.index, undefined, ANY_KEY);
    if (job.value || keys.some(({ name }) => !name)) {
      const text = [lines[job.index]];
      for (let index = job.index + 1; index < lines.length; index += 1) {
        if (lines[index].trim() && indentation(lines[index]) <= job.indent) {
          break;
        }
        text.push(lines[index]);
      }
      if (FLOW_IMAGE_KEY.test(normalizeKeys(text.join(" "), ANY_KEY))) {
        errors.push(
          `${fileName}:${job.index + 1}: container and services must use block mappings`,
        );
      }
    }

    for (const key of keys) {
      if (key.name === "container") {
        errors.push(...imageReferenceErrors(lines, key, fileName));
      } else if (key.name === "services") {
        const services = key.value
          ? [{ ...key, name: undefined }]
          : childMappings(lines, key.index, undefined, ANY_KEY);
        for (const service of services) {
          errors.push(
            ...(service.name
              ? imageReferenceErrors(lines, service, fileName)
              : [
                  `${fileName}:${service.index + 1}: services must be block mappings of named services`,
                ]),
          );
        }
      }
    }
  }

  return errors;
}

function jobText(lines, jobIndex, jobIndent) {
  const parts = [normalizePolicyKeys(lines[jobIndex])];

  for (let index = jobIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (indentation(line) <= jobIndent) {
      break;
    }

    parts.push(normalizePolicyKeys(line));
  }

  return parts.join(" ");
}

export function validateWorkflowText(text, fileName = "<workflow>") {
  const lines = text.split(/\r?\n/);
  const errors = [
    ...triggerErrors(lines, fileName),
    ...executionErrors(lines, fileName),
    ...containerErrors(lines, fileName),
  ];
  const rootPermissions = [];
  let jobsIndent = -1;
  let jobIndent = -1;
  let jobChildIndent = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const policyLine = normalizePolicyKeys(line);
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

    if (jobsIndent !== -1 && indent === jobIndent) {
      jobChildIndent = -1;
    } else if (jobsIndent !== -1 && indent > jobIndent && jobChildIndent === -1) {
      jobChildIndent = indent;
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

    if (YAML_TAG.test(trimmed.replace(EXPRESSION, ""))) {
      errors.push(`${fileName}:${index + 1}: YAML tags are not allowed`);
    }

    if (jobsIndent !== -1 && indent > jobIndent && EXPLICIT_KEY.test(trimmed)) {
      errors.push(`${fileName}:${index + 1}: explicit YAML keys are not allowed in jobs`);
    }

    if (
      jobsIndent !== -1 &&
      indent === jobIndent &&
      FLOW_PERMISSIONS_KEY.test(jobText(lines, index, jobIndent))
    ) {
      errors.push(`${fileName}:${index + 1}: job-level permissions are not allowed`);
    }

    if (FLOW_USES_KEY.test(trimmed)) {
      errors.push(
        `${fileName}:${index + 1}: flow-style uses mappings are not allowed`,
      );
      continue;
    }

    const permissionsMatch = policyLine.match(
      /^(\s*)(?:&[^\s,[\]{}]+\s+)?permissions:\s*(.*?)\s*$/,
    );
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
      const jobLevel = indent === jobChildIndent && !trimmed.startsWith("-");
      if (!jobLevel || !LOCAL_REUSABLE_WORKFLOW.test(action)) {
        errors.push(
          `${fileName}:${index + 1}: local actions are not allowed; only job-level reusable workflows in .github/workflows`,
        );
      }
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
