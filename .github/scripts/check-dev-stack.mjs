import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = "infra/local";
const DIGEST = /@sha256:[0-9a-f]{64}$/;
const LOOPBACK_PORT = /^127\.0\.0\.1:[1-9][0-9]{0,4}:[1-9][0-9]{0,4}(?:\/tcp)?$/;
const PRODUCTION_NODE_ENV = /NODE_ENV["']?\s*(?:[:=]|\s)\s*["']?production\b/i;
const ROOT_USER = /^(?:root|0+)(?::.*)?$/;
const INTERPOLATION = /\$/;
const COMPOSE_TOP_LEVEL = new Set(["name", "services", "networks", "volumes"]);
const UNSUPPORTED_SERVICE_KEYS = ["extends", "env_file"];
const NETWORK_MODE = /^(?:none|service:[A-Za-z0-9._-]+)$/;
const DANGEROUS_SERVICE_KEYS = [
  "cap_add",
  "cgroup_parent",
  "configs",
  "device_cgroup_rules",
  "devices",
  "dns",
  "dns_opt",
  "dns_search",
  "domainname",
  "extra_hosts",
  "group_add",
  "ipc",
  "logging",
  "pid",
  "secrets",
  "sysctls",
  "userns_mode",
  "uts",
  "volumes_from",
];
const COMPOSE_ALLOWED_BUILD_KEYS = new Set(["context", "dockerfile", "dockerfile_inline"]);
const EDGE_ROUTE_PAIR = /^([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/;
const LOOPBACK_PUBLISH = /^127\.0\.0\.1:([1-9][0-9]{0,4}):([1-9][0-9]{0,4})(?:\/tcp)?$/;
const NAMED_VOLUME = /^[a-z0-9][a-z0-9_.-]*$/i;
const DATASTORE_PORTS = new Set([1433, 1521, 3306, 5432, 6379, 9042, 26257, 27017]);
const NO_NEW_PRIVILEGES = /^no-new-privileges(?::true)?$/;
const PG_HBA_HOSTSSL_ADDRESS = new Set(["127.0.0.1/32", "::1/128"]);
const ASSIGNMENT_FILE = /\.env\.example$|compose\.ya?ml$|\.sh$|\.conf$|Dockerfile$/;
const LOOKUP_REFERENCE = /^\$[A-Za-z_][A-Za-z0-9_]*$|^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const REQUIRED_DOCKERIGNORE_DENIES = [
  "**/.env",
  "**/.env.*",
  "**/*.key",
  "**/*.pem",
  "**/*.p12",
  "**/*.pfx",
  "**/.git",
  "**/.git/**",
];
const REMOTE_CONTEXT = /^[a-z][a-z0-9+.-]*:\/\/|^git@|\.git(?:#.*)?$/i;
const YAML_ANCHOR_OR_ALIAS = /(?:^\s*(?:-\s+)*|:\s+|[[{,]\s*)[&*][^\s,\]}]/;
const YAML_MERGE_KEY = /^\s*(?:-\s+)*<<\s*:/;
const DEV_NODE_ENV = new Set(["development", "test"]);
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

function withoutQuotedStrings(line) {
  return line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}

function checkNodeEnvValue(value, location, errors) {
  if (value === undefined || !DEV_NODE_ENV.has(unquote(value))) {
    errors.push(`${location}: NODE_ENV must be the literal development or test in the dev-only stack`);
  }
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
  if (value.startsWith("$(") || LOOKUP_REFERENCE.test(value)) return;
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
    if (assignment && ASSIGNMENT_FILE.test(file)) {
      checkAssignment(assignment[1], stripComment(assignment[2]), location, errors);
    }
    const dockerAssignment =
      /Dockerfile$/.test(file) &&
      line.match(/^\s*(?:ENV|ARG)\s+["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*=\s*(.*)$/);
    if (dockerAssignment) {
      checkAssignment(dockerAssignment[1], stripComment(dockerAssignment[2]), location, errors);
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

function dockerInstructions(text) {
  const instructions = [];
  let pending;
  lines(text).forEach((line, index) => {
    const part = stripComment(line).trim();
    if (part === "" && pending !== undefined) return;
    if (pending === undefined) pending = { text: "", line: index + 1 };
    if (part.endsWith("\\")) {
      pending.text += `${part.slice(0, -1)} `;
      return;
    }
    pending.text += part;
    instructions.push(pending);
    pending = undefined;
  });
  if (pending !== undefined) instructions.push(pending);
  return instructions;
}

function dockerNodeEnvValue(rest) {
  const legacy = rest.match(/^NODE_ENV\s+(.+)$/);
  if (legacy) return legacy[1].trim();
  return rest.match(/(?:^|\s)NODE_ENV=("[^"]*"|'[^']*'|\S*)/)?.[1];
}

export function checkDockerfile(text, file) {
  const errors = [];
  const stages = new Set();
  let stage;
  let user;
  dockerInstructions(text).forEach(({ text: raw, line }) => {
    const location = `${file}:${line}`;
    const instruction = raw.trim();
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
    const environment = instruction.match(/^(?:ENV|ARG)\s+(.*)$/i);
    if (environment && /(?:^|\s)NODE_ENV(?:[=\s]|$)/.test(environment[1])) {
      checkNodeEnvValue(dockerNodeEnvValue(environment[1].trim()), location, errors);
    }
    const userInstruction = instruction.match(/^USER\s+(\S+)$/i);
    if (userInstruction) {
      user = userInstruction[1];
      if (INTERPOLATION.test(user)) {
        errors.push(`${location}: USER must be a literal non-root user`);
      } else if (ROOT_USER.test(user)) {
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
    const indent = indentation(line);
    if (indent <= parentIndent) break;
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && indent === parentIndent + 2) {
      items.push({ value: item[1], line: index + 1 });
    } else if (indent > parentIndent + 2 && items.length > 0) {
      items.at(-1).value = undefined;
    } else {
      items.push({ value: undefined, line: index + 1 });
    }
  }
  return items;
}

export function checkPgHba(text, file) {
  const errors = [];
  lines(text).forEach((raw, index) => {
    const location = `${file}:${index + 1}`;
    const line = stripComment(raw).trim();
    if (line === "") return;
    const fields = line.split(/\s+/);
    const [type] = fields;
    if (type === "local") {
      if (fields.length !== 4 || fields[3] !== "peer") {
        errors.push(`${location}: local lines must be "local <db> <user> peer" with no options`);
      }
      return;
    }
    if (type !== "host" && type !== "hostssl") {
      errors.push(`${location}: pg_hba entry type ${type} is not allowed; only local, host (reject) and hostssl (scram) are`);
      return;
    }
    if (fields.length !== 5) {
      errors.push(`${location}: ${type} lines must be "${type} <db> <user> <address> <method>" with no options`);
      return;
    }
    const [, database, role, address, method] = fields;
    if (type === "host") {
      if (method !== "reject") {
        errors.push(`${location}: host lines may only reject; authenticated connections come through hostssl`);
      }
      return;
    }
    if (database === "all" || database === "replication" || role === "all") {
      errors.push(`${location}: hostssl lines must name a specific database and role`);
    }
    if (!PG_HBA_HOSTSSL_ADDRESS.has(address)) {
      errors.push(`${location}: hostssl address must be loopback-only (127.0.0.1/32 or ::1/128)`);
    }
    if (method !== "scram-sha-256") {
      errors.push(`${location}: hostssl lines must use scram-sha-256`);
    }
  });
  return errors;
}

function composeNodeEnvValue(line) {
  let body = line.trim();
  if (body.startsWith("-")) body = unquote(body.slice(1));
  const match = body.match(/^["']?NODE_ENV["']?\s*(?::(?:\s+(.*))?$|=(.*)$)/);
  if (!match) return { found: false };
  return { found: true, value: match[1] ?? match[2] ?? "" };
}

function parseCompose(text, file) {
  const errors = [];
  const source = lines(text);
  const services = new Map();
  let inServices = false;
  let current;
  let currentKey;

  source.forEach((raw, index) => {
    const line = stripComment(raw);
    if (line.trim() === "") return;
    const location = `${file}:${index + 1}`;
    const unquoted = withoutQuotedStrings(line);
    if (YAML_ANCHOR_OR_ALIAS.test(unquoted) || YAML_MERGE_KEY.test(unquoted)) {
      errors.push(`${location}: YAML anchors, aliases and merge keys are not allowed`);
    }
    const nodeEnv = composeNodeEnvValue(line);
    if (nodeEnv.found) checkNodeEnvValue(nodeEnv.value, location, errors);
    const indent = indentation(line);
    if (indent === 0) {
      const top = line.match(/^([A-Za-z0-9_-]+):(?:\s|$)/);
      if (!top || !COMPOSE_TOP_LEVEL.has(top[1])) {
        errors.push(`${location}: top-level key ${top?.[1] ?? line.trim()} is not allowed`);
      }
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
      currentKey = undefined;
      return;
    }
    if (indent === 4 && current) {
      const key = line.match(/^ {4}([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
      if (!key) {
        errors.push(`${location}: service ${current.name} keys must be plain block-mapping keys`);
        currentKey = undefined;
        return;
      }
      currentKey = { value: key[2] ?? "", line: index + 1, children: new Map() };
      current.keys.set(key[1], currentKey);
      return;
    }
    if (indent === 6 && currentKey) {
      const child = line.match(/^ {6}([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
      if (child) currentKey.children.set(child[1], { value: child[2] ?? "", line: index + 1 });
    }
  });
  return { errors, services, source };
}

export function composeBuilds(text) {
  const builds = [];
  for (const service of parseCompose(text, "compose").services.values()) {
    const build = service.keys.get("build");
    if (!build) continue;
    const context = build.value.trim() === "" ? build.children.get("context")?.value : build.value;
    const dockerfile = build.children.get("dockerfile")?.value;
    builds.push({
      service: service.name,
      context: unquote(context ?? "."),
      dockerfile: unquote(dockerfile ?? "Dockerfile")
    });
  }
  return builds;
}

export function checkCompose(text, file, repoRoot) {
  const { errors, services, source } = parseCompose(text, file);
  const composeDir = path.dirname(path.resolve(file));
  const repositoryRoot = repoRoot ?? path.resolve(composeDir, "../..");

  if (services.size === 0) {
    errors.push(`${file}: compose file must declare services`);
  }

  for (const service of services.values()) {
    const where = (entry) => `${file}:${entry?.line ?? service.line}`;
    for (const key of UNSUPPORTED_SERVICE_KEYS) {
      const entry = service.keys.get(key);
      if (entry) {
        errors.push(`${where(entry)}: service ${service.name} must not use ${key}; the checker only vouches for this file`);
      }
    }
    const user = service.keys.get("user");
    if (!user || unquote(user.value) === "") {
      errors.push(`${where(service)}: service ${service.name} must set a non-root user`);
    } else if (INTERPOLATION.test(user.value)) {
      errors.push(`${where(user)}: service ${service.name} user must be a literal non-root user`);
    } else if (ROOT_USER.test(unquote(user.value))) {
      errors.push(`${where(user)}: service ${service.name} must not run as root`);
    }
    for (const key of DANGEROUS_SERVICE_KEYS) {
      const entry = service.keys.get(key);
      if (entry) {
        errors.push(`${where(entry)}: service ${service.name} must not use ${key}; the dev stack fixes capability, namespace and egress isolation`);
      }
    }
    const readOnly = service.keys.get("read_only");
    if (!readOnly || unquote(readOnly.value) !== "true") {
      errors.push(`${where(readOnly)}: service ${service.name} must set read_only: true`);
    }
    const capDrop = service.keys.get("cap_drop");
    const capDropItems = capDrop && capDrop.value.trim() === "" ? blockList(source, capDrop.line, 4) : [];
    if (!capDrop || !capDropItems.some((item) => unquote(item.value ?? "") === "ALL")) {
      errors.push(`${where(capDrop)}: service ${service.name} must drop all capabilities (cap_drop with ALL)`);
    }
    const securityOpt = service.keys.get("security_opt");
    const securityOptItems = securityOpt && securityOpt.value.trim() === "" ? blockList(source, securityOpt.line, 4) : [];
    if (
      !securityOpt ||
      securityOptItems.length === 0 ||
      securityOptItems.some((item) => !NO_NEW_PRIVILEGES.test(unquote(item.value ?? "")))
    ) {
      errors.push(`${where(securityOpt)}: service ${service.name} must set security_opt to no-new-privileges entries only`);
    }
    const environment = service.keys.get("environment");
    if (environment && environment.value.trim() !== "") {
      errors.push(`${where(environment)}: service ${service.name} environment must be a block mapping or list`);
    }
    const edgeRoutes = [];
    if (environment && environment.value.trim() === "") {
      const child = environment.children.get("EDGE_ROUTES");
      if (child) edgeRoutes.push({ value: unquote(child.value), line: child.line });
      for (const item of blockList(source, environment.line, 4)) {
        const match = unquote(item.value ?? "").match(/^EDGE_ROUTES=(.*)$/);
        if (match) edgeRoutes.push({ value: match[1], line: item.line });
      }
    }
    const privileged = service.keys.get("privileged");
    if (privileged && unquote(privileged.value) !== "false") {
      errors.push(`${where(privileged)}: service ${service.name} must not be privileged`);
    }
    const networkMode = service.keys.get("network_mode");
    if (networkMode && !NETWORK_MODE.test(unquote(networkMode.value))) {
      errors.push(`${where(networkMode)}: service ${service.name} must not use network_mode ${unquote(networkMode.value)}`);
    }
    const image = service.keys.get("image");
    if (image && !DIGEST.test(unquote(image.value))) {
      errors.push(`${where(image)}: service ${service.name} image must be pinned by @sha256 digest`);
    }
    const build = service.keys.get("build");
    if (!image && !build) {
      errors.push(`${where(service)}: service ${service.name} must declare a pinned image or a build`);
    }
    if (build) {
      for (const [key, child] of build.children) {
        if (!COMPOSE_ALLOWED_BUILD_KEYS.has(key)) {
          errors.push(`${where(child)}: service ${service.name} must not use build.${key}; the checker only vouches for context and dockerfile`);
        }
      }
      const inline = build.children.get("dockerfile_inline");
      if (inline) {
        errors.push(`${where(inline)}: service ${service.name} must not use dockerfile_inline`);
      }
      const context = build.value.trim() === "" ? build.children.get("context") : build;
      if (context && REMOTE_CONTEXT.test(unquote(context.value))) {
        errors.push(`${where(context)}: service ${service.name} must build from a local context`);
      }
    }
    const ports = service.keys.get("ports");
    if (ports) {
      if (ports.value.trim() !== "") {
        errors.push(`${where(ports)}: service ${service.name} ports must be a block list of "127.0.0.1:host:container" strings`);
      } else {
        const items = blockList(source, ports.line, 4);
        if (items.length === 0) {
          errors.push(`${where(ports)}: service ${service.name} must publish ports only on 127.0.0.1 ("127.0.0.1:host:container")`);
        }
        for (const item of items) {
          const value = item.value === undefined ? undefined : unquote(item.value);
          if (value === undefined || !LOOPBACK_PORT.test(value)) {
            errors.push(`${file}:${item.line}: service ${service.name} must publish ports only on 127.0.0.1 ("127.0.0.1:host:container")`);
          }
        }
      }
    }
    const published = new Map();
    for (const item of ports ? blockList(source, ports.line, 4) : []) {
      const match = unquote(item.value ?? "").match(LOOPBACK_PUBLISH);
      if (match) published.set(Number(match[2]), Number(match[1]));
    }
    const routed = new Map();
    for (const { value, line } of edgeRoutes) {
      for (const entry of value.split(",").map((part) => part.trim()).filter(Boolean)) {
        const match = entry.match(EDGE_ROUTE_PAIR);
        if (!match) {
          errors.push(`${file}:${line}: service ${service.name} EDGE_ROUTES entries must be listenPort:targetPort pairs`);
          continue;
        }
        const [listen, target] = [Number(match[1]), Number(match[2])];
        if (DATASTORE_PORTS.has(target)) {
          errors.push(`${file}:${line}: service ${service.name} EDGE_ROUTES ${listen}:${target} must not target a datastore port`);
          continue;
        }
        routed.set(listen, target);
      }
    }
    for (const [listen, target] of routed) {
      if (published.get(listen) !== target) {
        errors.push(`${file}:${service.line}: service ${service.name} EDGE_ROUTES ${listen}:${target} must pair a published "127.0.0.1:${target}:${listen}" port`);
      }
    }
    if (routed.size > 0) {
      for (const [container, host] of published) {
        if (routed.get(container) !== host) {
          errors.push(`${file}:${service.line}: service ${service.name} published "127.0.0.1:${host}:${container}" must have a matching EDGE_ROUTES "${container}:${host}" entry`);
        }
      }
    }
    const volumes = service.keys.get("volumes");
    if (volumes) {
      if (volumes.value.trim() !== "") {
        errors.push(`${where(volumes)}: service ${service.name} volumes must be a block list of NAME:path[:mode] or ./repo-path:path:ro entries`);
      } else {
        for (const item of blockList(source, volumes.line, 4)) {
          const value = item.value === undefined ? undefined : unquote(item.value);
          const location = `${file}:${item.line}`;
          if (value === undefined || INTERPOLATION.test(value)) {
            errors.push(`${location}: service ${service.name} volumes must use literal NAME:path[:mode] or ./repo-path:path:ro entries`);
            continue;
          }
          const [volumeSource, target, ...modes] = value.split(":");
          if (
            !volumeSource ||
            !target?.startsWith("/") ||
            target.split("/").includes("..") ||
            modes.length > 1 ||
            modes.some((mode) => !/^(?:ro|rw|z|Z|nocopy)$/.test(mode))
          ) {
            errors.push(`${location}: service ${service.name} volumes must use <src>:/abs/container-path[:ro|:rw] entries`);
            continue;
          }
          if (NAMED_VOLUME.test(volumeSource)) continue;
          if (!volumeSource.startsWith(".")) {
            errors.push(`${location}: service ${service.name} may only bind-mount paths relative to the repository`);
            continue;
          }
          const resolved = path.resolve(composeDir, volumeSource);
          if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
            errors.push(`${location}: service ${service.name} may only bind-mount paths inside the repository`);
            continue;
          }
          if (modes.length !== 1 || modes[0] !== "ro") {
            errors.push(`${location}: service ${service.name} repository bind mounts must be read-only (:ro)`);
          }
        }
      }
    }
  }
  return errors;
}

async function* walk(directory, nonRegular = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY.has(entry.name)) yield* walk(resolved, nonRegular);
    } else if (entry.isFile()) {
      yield resolved;
    } else {
      nonRegular.push(resolved);
    }
  }
}

function trackedEnvErrors(envFiles) {
  const errors = [];
  for (const absolute of envFiles) {
    let tracked = false;
    try {
      execFileSync(
        "git",
        [
          "-C",
          path.dirname(absolute),
          "ls-files",
          "--error-unmatch",
          "--",
          path.basename(absolute),
        ],
        { stdio: "pipe" },
      );
      tracked = true;
    } catch {
      tracked = false;
    }
    if (tracked) {
      errors.push(
        `${relativeFile(absolute)}: committed .env files are not allowed under the dev stack root`,
      );
    }
  }
  return errors;
}

export async function checkE2ePackage(packageRoot = "packages/e2e-dev") {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8"),
    );
  } catch {
    return [`${packageRoot}/package.json: must be readable JSON`];
  }
  const scripts = manifest.scripts ?? {};
  const lint = typeof scripts.lint === "string" ? scripts.lint : "";
  const test = typeof scripts.test === "string" ? scripts.test : "";
  if (!/\bnode --check\b/.test(lint)) {
    errors.push(`${packageRoot}: the lint script must use node --check`);
  }
  if (!/\bnode --test\b/.test(test)) {
    errors.push(`${packageRoot}: the test script must use node --test`);
  }

  let entries;
  try {
    entries = await readdir(path.join(packageRoot, "tests"), {
      withFileTypes: true,
    });
  } catch {
    return [...errors, `${packageRoot}/tests: directory must exist`];
  }
  const mjs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => `tests/${entry.name}`);
  const onDisk = new Set(mjs);
  for (const file of mjs) {
    if (!lint.includes(file)) {
      errors.push(`${file}: the e2e lint script must cover this file`);
    }
    if (file.endsWith(".test.mjs") && !test.includes(file)) {
      errors.push(`${file}: the e2e test script must run this file`);
    }
  }
  for (const script of [lint, test]) {
    for (const match of script.matchAll(/tests\/[\w.-]+\.mjs/g)) {
      if (!onDisk.has(match[0])) {
        errors.push(`${match[0]}: referenced by an e2e script but missing on disk`);
      }
    }
  }
  return errors;
}

function relativeFile(absolute) {
  return path.relative(process.cwd(), absolute).replaceAll("\\", "/");
}

async function isFile(absolute) {
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

async function checkDockerignore(dockerfilePath, label) {
  const errors = [];
  let text;
  try {
    text = await readFile(`${dockerfilePath}.dockerignore`, "utf8");
  } catch {
    return [
      `${label}.dockerignore: missing; every dev-stack Dockerfile needs a deny-all build-context ignore file`,
    ];
  }
  const patterns = lines(text)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (patterns[0] !== "*") {
    errors.push(`${label}.dockerignore: the first pattern must be * (deny-all context, then re-include)`);
  }
  const lastInclude = patterns.reduce((max, pattern, index) => (pattern.startsWith("!") ? index : max), -1);
  for (const deny of REQUIRED_DOCKERIGNORE_DENIES) {
    const index = patterns.indexOf(deny);
    if (index < 0) {
      errors.push(`${label}.dockerignore: missing a ${deny} deny pattern after the ! re-includes`);
    } else if (index <= lastInclude) {
      errors.push(`${label}.dockerignore: ${deny} must come after every ! re-include to take effect`);
    }
  }
  return errors;
}

async function checkExternalDockerfiles(text, composePath, root, checked) {
  const errors = [];
  const resolvedRoot = path.resolve(root);
  for (const { context, dockerfile } of composeBuilds(text)) {
    if (REMOTE_CONTEXT.test(context)) continue;
    const absolute = path.resolve(path.dirname(composePath), context, dockerfile);
    const inside = absolute === resolvedRoot || absolute.startsWith(`${resolvedRoot}${path.sep}`);
    if (inside || checked.has(absolute) || !(await isFile(absolute))) continue;
    checked.add(absolute);
    errors.push(...checkDockerfile(await readFile(absolute, "utf8"), relativeFile(absolute)));
    errors.push(...(await checkDockerignore(absolute, relativeFile(absolute))));
  }
  return errors;
}

export async function checkDevStack(root = DEFAULT_ROOT) {
  const errors = [];
  const externalDockerfiles = new Set();
  const nonRegular = [];
  const envFiles = [];
  const dockerfilePaths = [];
  const repositoryRoot = path.resolve(root, "../..");
  let composeFiles = 0;
  let dockerfiles = 0;
  for await (const absolute of walk(root, nonRegular)) {
    const file = relativeFile(absolute);
    const base = path.basename(file);
    if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) {
      envFiles.push(absolute);
      continue;
    }
    const text = await readFile(absolute, "utf8");
    const isCompose = /^(?:docker-)?compose\.ya?ml$/.test(base);
    const isYaml = /\.ya?ml$/i.test(base);
    const isDockerfile = /(?:^|\.)Dockerfile$/.test(base);
    const isText = TEXT_FILE.test(base) || base.startsWith(".env");
    if (isCompose) {
      composeFiles += 1;
      errors.push(...checkCompose(text, file, repositoryRoot));
      errors.push(...(await checkExternalDockerfiles(text, absolute, root, externalDockerfiles)));
    } else if (isYaml) {
      errors.push(`${file}: unexpected YAML file; the dev stack is a single compose file (no override, extends or include files)`);
    }
    if (isDockerfile) {
      dockerfiles += 1;
      errors.push(...checkDockerfile(text, file));
      dockerfilePaths.push({ absolute, file });
    }
    if (base === "pg_hba.conf") {
      errors.push(...checkPgHba(text, file));
    }
    if (isText) {
      errors.push(...checkNodeEnv(text, file), ...checkSecrets(text, file));
    }
    if (!isCompose && !isYaml && !isDockerfile && !isText) {
      errors.push(`${file}: unexpected file under the dev stack root`);
    }
  }
  for (const { absolute, file } of dockerfilePaths) {
    errors.push(...(await checkDockerignore(absolute, file)));
  }
  for (const absolute of nonRegular) {
    errors.push(
      `${relativeFile(absolute)}: non-regular file entries are not allowed under the dev stack root`,
    );
  }
  errors.push(...trackedEnvErrors(envFiles));
  if (composeFiles === 0) errors.push(`${root}: no compose file found`);
  if (dockerfiles === 0) errors.push(`${root}: no Dockerfile found`);
  return errors;
}

async function main() {
  const root = process.argv[2] ?? DEFAULT_ROOT;
  const errors = await checkDevStack(root);
  if (root === DEFAULT_ROOT) {
    errors.push(...(await checkE2ePackage()));
  }
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
