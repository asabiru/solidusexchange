import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = "infra/local";
const DIGEST = /@sha256:[0-9a-f]{64}$/;
const LOOPBACK_PORT = /^127\.0\.0\.1:[1-9][0-9]{0,4}:[1-9][0-9]{0,4}(?:\/tcp)?$/;
const PRODUCTION_NODE_ENV = /NODE_ENV["']?\s*(?:[:=]|\s)\s*["']?production\b/i;
const ROOT_USER = /^(?:root|0)(?::.*)?$/;
const SECRET_NAME = /(?:PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIAL)/i;
const SECRET_REFERENCE_NAME = /(?:_FILE|_DIR|_PATH)$/;
const EMPTY_REFERENCE = /^\$\{[A-Z][A-Z0-9_]*(?::?-)?\}$/;
const MATERIAL_FILE_REFERENCE = /^@[a-z0-9][a-z0-9.-]*$/;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KNOWN_TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|\d{8,10}:[A-Za-z0-9_-]{35})\b/;
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s/@]+)@/gi;
const HIGH_ENTROPY = /(?<![A-Za-z0-9=_-])(?:sha256:)?[A-Za-z0-9=_-]{32,}(?![A-Za-z0-9=_-])/g;
const TEXT_FILE = /(?:\.(?:ya?ml|mjs|js|sh|sql|conf|md|json)|Dockerfile|\.dockerignore|\.env\.example)$/;
const SKIPPED_DIRECTORY = new Set(["node_modules", ".git"]);

function lines(text) {
  return text.split(/\r?\n/);
}

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function stripComment(line) {
  return line.replace(/(^|\s)#.*$/, "").trimEnd();
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function shannonBitsPerChar(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function looksRandom(value) {
  return /[0-9]/.test(value) && /[A-Za-z]/.test(value) && shannonBitsPerChar(value) >= 3.5;
}

function checkAssignment(name, rawValue, location, errors) {
  if (!SECRET_NAME.test(name) || SECRET_REFERENCE_NAME.test(name)) return;
  const value = unquote(rawValue);
  if (value === "" || EMPTY_REFERENCE.test(value) || MATERIAL_FILE_REFERENCE.test(value)) return;
  errors.push(`${location}: ${name} must not have a committed literal value; generate it at start-up or set it in the gitignored .env`);
}

export function checkSecrets(text, file) {
  const errors = [];
  lines(text).forEach((line, index) => {
    const location = `${file}:${index + 1}`;
    if (PRIVATE_KEY_BLOCK.test(line)) {
      errors.push(`${location}: committed private key material`);
    }
    if (KNOWN_TOKEN.test(line)) {
      errors.push(`${location}: committed literal looks like a provider credential or token`);
    }
    for (const match of line.matchAll(URL_CREDENTIALS)) {
      if (!match[1].startsWith("$")) {
        errors.push(`${location}: committed URL embeds a literal password`);
      }
    }
    for (const match of line.matchAll(HIGH_ENTROPY)) {
      if (!match[0].startsWith("sha256:") && looksRandom(match[0])) {
        errors.push(`${location}: committed literal looks like a secret (high-entropy string)`);
      }
    }
    const assignment = line.match(/^\s*(?:-\s*)?(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*(?:=|:\s)\s*(.*)$/);
    if (assignment && /\.env\.example$|compose\.ya?ml$/.test(file)) {
      checkAssignment(assignment[1], stripComment(assignment[2]), location, errors);
    }
  });
  return errors;
}

export function checkNodeEnv(text, file) {
  const errors = [];
  lines(text).forEach((line, index) => {
    if (PRODUCTION_NODE_ENV.test(line)) {
      errors.push(`${file}:${index + 1}: NODE_ENV must never be production in the dev-only stack`);
    }
  });
  return errors;
}

export function checkDockerfile(text, file) {
  const errors = [];
  const stages = new Set();
  let stage;
  let user;
  lines(text).forEach((line, index) => {
    const location = `${file}:${index + 1}`;
    const instruction = stripComment(line).trim();
    const from = instruction.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$/i);
    if (/^FROM\s/i.test(instruction)) {
      if (!from) {
        errors.push(`${location}: unsupported FROM syntax`);
        return;
      }
      const [, image, name] = from;
      if (!stages.has(image.toLowerCase()) && !DIGEST.test(image)) {
        errors.push(`${location}: base image ${image} must be pinned by @sha256 digest`);
      }
      if (name) stages.add(name.toLowerCase());
      stage = name ?? image;
      user = undefined;
      return;
    }
    const userInstruction = instruction.match(/^USER\s+(\S+)$/i);
    if (userInstruction) {
      user = userInstruction[1];
      if (ROOT_USER.test(user)) {
        errors.push(`${location}: final image must not switch to root`);
      }
    }
  });
  if (stage === undefined) {
    errors.push(`${file}: Dockerfile has no FROM instruction`);
  } else if (user === undefined) {
    errors.push(`${file}: final stage ${stage} must set a non-root USER`);
  }
  return errors;
}

function blockList(source, start, parentIndent) {
  const items = [];
  for (let index = start; index < source.length; index += 1) {
    const line = stripComment(source[index]);
    if (line.trim() === "") continue;
    if (indentation(line) <= parentIndent) break;
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && indentation(line) === parentIndent + 2) {
      items.push({ value: item[1], line: index + 1 });
    } else if (indentation(line) === parentIndent + 2) {
      items.push({ value: undefined, line: index + 1 });
    }
  }
  return items;
}

export function checkCompose(text, file) {
  const errors = [];
  const source = lines(text);
  const services = new Map();
  let inServices = false;
  let current;

  source.forEach((raw, index) => {
    const line = stripComment(raw);
    if (line.trim() === "") return;
    const indent = indentation(line);
    if (indent === 0) {
      inServices = /^services:\s*$/.test(line);
      current = undefined;
      return;
    }
    if (!inServices) return;
    if (indent === 2) {
      const name = line.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
      if (!name) {
        errors.push(`${file}:${index + 1}: services must use block mappings`);
        return;
      }
      current = { name: name[1], line: index + 1, keys: new Map() };
      services.set(current.name, current);
      return;
    }
    if (indent === 4 && current) {
      const key = line.match(/^ {4}([A-Za-z0-9_-]+):\s*(.*)$/);
      if (key) current.keys.set(key[1], { value: key[2], line: index + 1 });
    }
  });

  if (services.size === 0) {
    errors.push(`${file}: compose file must declare services`);
  }

  for (const service of services.values()) {
    const where = (entry) => `${file}:${entry?.line ?? service.line}`;
    const user = service.keys.get("user");
    if (!user || unquote(user.value) === "") {
      errors.push(`${where(service)}: service ${service.name} must set a non-root user`);
    } else if (ROOT_USER.test(unquote(user.value))) {
      errors.push(`${where(user)}: service ${service.name} must not run as root`);
    }
    const privileged = service.keys.get("privileged");
    if (privileged && unquote(privileged.value) !== "false") {
      errors.push(`${where(privileged)}: service ${service.name} must not be privileged`);
    }
    const networkMode = service.keys.get("network_mode");
    if (networkMode && /^(?:host|container:)/.test(unquote(networkMode.value))) {
      errors.push(`${where(networkMode)}: service ${service.name} must not use network_mode ${unquote(networkMode.value)}`);
    }
    const image = service.keys.get("image");
    if (image && !DIGEST.test(unquote(image.value))) {
      errors.push(`${where(image)}: service ${service.name} image must be pinned by @sha256 digest`);
    }
    if (!image && !service.keys.has("build")) {
      errors.push(`${where(service)}: service ${service.name} must declare a pinned image or a build`);
    }
    const ports = service.keys.get("ports");
    if (ports) {
      if (ports.value.trim() !== "") {
        errors.push(`${where(ports)}: service ${service.name} ports must be a block list of "127.0.0.1:host:container" strings`);
      } else {
        for (const item of blockList(source, ports.line, 4)) {
          const value = item.value === undefined ? undefined : unquote(item.value);
          if (value === undefined || !LOOPBACK_PORT.test(value)) {
            errors.push(`${file}:${item.line}: service ${service.name} must publish ports only on 127.0.0.1 ("127.0.0.1:host:container")`);
          }
        }
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
      if (!SKIPPED_DIRECTORY.has(entry.name)) yield* walk(resolved);
    } else if (entry.isFile()) {
      yield resolved;
    }
  }
}

export async function checkDevStack(root = DEFAULT_ROOT) {
  const errors = [];
  let composeFiles = 0;
  let dockerfiles = 0;
  for await (const absolute of walk(root)) {
    const file = path.relative(process.cwd(), absolute).replaceAll("\\", "/");
    const base = path.basename(file);
    if (base === ".env") continue;
    const text = await readFile(absolute, "utf8");
    if (/^(?:docker-)?compose\.ya?ml$/.test(base)) {
      composeFiles += 1;
      errors.push(...checkCompose(text, file));
    }
    if (/(?:^|\.)Dockerfile$/.test(base)) {
      dockerfiles += 1;
      errors.push(...checkDockerfile(text, file));
    }
    if (TEXT_FILE.test(base) || base.startsWith(".env")) {
      errors.push(...checkNodeEnv(text, file), ...checkSecrets(text, file));
    }
  }
  if (composeFiles === 0) errors.push(`${root}: no compose file found`);
  if (dockerfiles === 0) errors.push(`${root}: no Dockerfile found`);
  return errors;
}

async function main() {
  const errors = await checkDevStack(process.argv[2] ?? DEFAULT_ROOT);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("dev-stack-ok");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
