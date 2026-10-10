import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "src");

/** The book is pure data-in/data-out: only sibling modules may be imported. */
const ALLOWED_IMPORTS = new Set();
const IMPORT_SPECIFIER = /\bfrom\s+"([^"]+)"/g;
/** @type {[string, RegExp][]} */
const FORBIDDEN = [
  ["network client", /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\./],
  ["ambient wall clock", /\bDate\.now\s*\(|new\s+Date\s*\(\s*\)|performance\.now/],
  ["ambient randomness", /Math\.random|randomUUID|getRandomValues|randomInt\s*\(/],
  ["floating-point money", /parseFloat|toFixed\s*\(|Number\.parseFloat/],
  ["environment or credentials", /\bprocess\s*\.\s*env\b|\bAPI_KEY\b|\bSECRET\b/],
  ["timers", /\bset(?:Timeout|Interval|Immediate)\s*\(/],
  ["filesystem or child processes", /\bnode:(?:fs|net|http|https|child_process|worker_threads|dgram|tls)\b/],
  ["serving or routing", /\bcreateServer\b|\blisten\s*\(/],
];
const EXPORTED_NAME = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;
const OBJECT_METHOD = /^\s{4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
/**
 * Order book vocabulary (order, fill, match, trade, cancel) is the domain.
 * What stays banned is anything that would move value or leave the data
 * plane: ledger postings, settlement, custody, signing, transfers, serving.
 */
const MONEY_MOVING_NAME =
  /^(?:approve|broadcast|charge|confirm|credit|custod|debit|deposit[A-Z]|execute|journal|ledger|mint|pay(?!ment)|payout|post|refund|release|serve|settle|sign[A-Z](?!ature)|transfer|withdraw)/;
const MONEY_MOVING_WORD =
  /(?:Broadcast|Custod|Deposit|Journal|Ledger|Posting|Payout|Posting|Settlement|Settle|Signature|Signer|Transfer|Withdraw)/;

/** @param {string} directory @returns {string[]} */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : entry.name.endsWith(".mjs")
        ? [join(directory, entry.name)]
        : [],
  );
}

const errors = [];
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
  errors.push("package.json: runtime dependencies are not allowed");
}
if (packageJson.private !== true) {
  errors.push("package.json: package must stay private");
}

for (const file of sourceFiles(source)) {
  const name = file.slice(root.length);
  const text = readFileSync(file, "utf8");
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const match of code.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1];
    if (!specifier.startsWith("./") && !ALLOWED_IMPORTS.has(specifier)) {
      errors.push(`${name}: import of ${specifier} is outside the library boundary`);
    }
  }
  for (const [label, pattern] of FORBIDDEN) {
    if (pattern.test(code)) {
      errors.push(`${name}: ${label} is not allowed`);
    }
  }
  for (const pattern of [EXPORTED_NAME, OBJECT_METHOD]) {
    for (const match of code.matchAll(pattern)) {
      const identifier = match[1];
      if (MONEY_MOVING_NAME.test(identifier) || MONEY_MOVING_WORD.test(identifier)) {
        errors.push(`${name}: ${identifier} looks like an execution or money-moving operation`);
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("matching-core boundary check passed");
}
