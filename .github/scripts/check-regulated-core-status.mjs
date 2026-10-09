import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REGULATED_CORE_DIRECTORY = "Documentation/regulated-core";
const BASELINE_FILE = fileURLToPath(new URL("./regulated-core-status-baseline.json", import.meta.url));

const CONFUSABLES = new Map(
  Object.entries({
    а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c",
    т: "t", у: "y", х: "x", ѕ: "s", і: "i", ї: "i", ј: "j", ԁ: "d", ԛ: "q", ԝ: "w",
    ӏ: "l", һ: "h", ɡ: "g", ı: "i", α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v",
    ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  }),
);

const STATUS_LINE =
  /^(?:(?:approval|review|decision|current|sign-?off|release|production|go\/no-go)\s+)?(?:status|state|effect)\s*(?:[:=—–]|\s-\s)|^(?:статус|состояние)(?:\s+[\p{L}-]+)?\s*(?:[:=—–]|\s-\s)/u;
const STATUS_WORD_CLAIM =
  /^(?:status|review state|статус)\s+(?:approv|accept|grant|decid|sign|утвержд|одобр|принят|согласова)/u;
const APPROVER_LINE =
  /^[\p{L}\p{N} /().,'—–-]*?(?:approver|approved (?:by|at|on)|approval (?:date|timestamp)|signed (?:by|off)|sign-?off (?:by|date)|decided (?:at|on|by)|decision (?:date|timestamp|maker)|утвердил|одобрил|согласовал)[\p{L}\p{N} /().,'—–-]*?\s*[:=]/u;
const DECISION_STATUS_LINE = /^d-\d{3}\b/u;
const FENCED_KEY_VALUE = /^([\p{L}\p{N} ./()-]+?)\s*[:=]\s*(\S.*)$/u;
const FENCED_EMPTY_KEY = /^[\p{L}\p{N} ./()-]+:$/u;
const FENCED_CLAIM_KEY =
  /approv|sign|decision|decided|status|state|accept|grant|review|date|time|owner|утвержд|одобр|статус|решени/u;
const APPROVAL_VOCABULARY =
  /\b(?:approv\w*|accept\w*|grant\w*|decided|sign(?:ed)?[ -]?off|signed|ratifi\w*|endorse\w*|authori[sz]ed)\b|утвержд|одобр|принят|согласован|подписан|решено/u;
const APPROVAL_TOKEN =
  /^(?:approv\p{L}*|accept\p{L}*|grant\p{L}*|decided|sign-?off|signoff|signed|ratifi\p{L}*|endorse\p{L}*|authori[sz]ed|утвержд\p{L}*|одобр\p{L}*|принят\p{L}*|согласова\p{L}*|подписа\p{L}*|решено)$/u;
const NON_CLAIM_TOKEN = /^(?:approvers?|acceptable|unacceptable|acceptance)$/u;
const NEGATED_TOKEN = /^(?:un|не|dis)(?:approv|accept|grant|sign|ratifi|endorse|authori|утвержд|одобр|принят|согласова|подписа)/u;
const NEGATOR =
  /^(?:not|no|non|un|never|without|pending|until|unless|before|awaiting|require|requires|required|need|needs|must|cannot|can't|isn't|aren't|wasn't|не|нет|без|до|пока|требуется|требует|нужен|нужно|нужна|ожидает|ожидается)$/u;
const NEGATION_FILLER =
  /^(?:approval|approvals|sign-?off|acceptance|yet|formally|explicitly|written|separately|be|been|is|are|was|were|an|a|the|any|final|formal|human|production|still|also|cto|legal|mlro|finance|security|compliance|domain|owner|ещё|еще|явно|письменно|отдельно|был|была|было|были|получен|получено|финальн\p{L}*)$/u;
const COPULA = /^(?:is|are|was|were|be|been|remains?|still|has|have|yet|был|была|было|были|пока|ещё|еще)$/u;
const NEGATED_FOLLOWER = /^(?:pending|required|not|missing|absent|outstanding|не|нет|отсутствует|требуется|ожидается)$/u;
const DATE =
  /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)\p{L}*\.?\s+\d{4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\p{L}*\.?\s+\d{1,2},?\s+\d{4}\b/u;
const STATUS_SECTION = /^(?:(?:current|текущий)\s+)?(?:status|state|статусы?|состояние)(?:\s[^,]*)?$/u;
const STATUS_COLUMN = /\bstatus\b|\bstate\b|статус|состояни|approver|required human approval/u;
const DECISION_ID = /^d-\d{3}$/u;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function fold(text) {
  return text.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
}

function skeleton(text) {
  return [...fold(text)].map((character) => CONFUSABLES.get(character) ?? character).join("");
}

function stripMarkup(text) {
  return text
    .replace(/\\(.)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`~]/g, "")
    .replace(/_/g, " ")
    .replace(/^[\s>#]*/, "")
    .replace(/^(?:[-+]|\d+[.)])\s+/, "")
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function joinHyphens(text) {
  return text.replace(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, "");
}

function forms(text) {
  return [
    stripMarkup(fold(text)),
    stripMarkup(skeleton(text)),
    stripMarkup(joinHyphens(fold(text))),
    stripMarkup(joinHyphens(skeleton(text))),
  ];
}

function matchesAny(text, pattern) {
  return forms(text).some((form) => pattern.test(form));
}

function unquote(line) {
  return line.replace(/^\s*(?:>\s*)+/, "");
}

function tableCells(line) {
  const cells = unquote(line).trim().split(/(?<!\\)\|/).map((cell) => cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function isTableLine(line) {
  return unquote(line).trim().startsWith("|");
}

function detectionText(line) {
  if (!isTableLine(line)) return line;
  const [first = "", ...rest] = tableCells(line);
  return `${first}: ${rest.join(" ")}`;
}

function isStatusLine(line) {
  const text = detectionText(line);
  return (
    matchesAny(text, STATUS_LINE) ||
    matchesAny(text, STATUS_WORD_CLAIM) ||
    (!isTableLine(line) && matchesAny(text, DECISION_STATUS_LINE) && (/[:=—–]/.test(fold(text)) || hasApprovalVocabulary(text)))
  );
}

function isApproverLine(line) {
  return matchesAny(detectionText(line), APPROVER_LINE);
}

function hasApprovalVocabulary(text) {
  return matchesAny(text, APPROVAL_VOCABULARY);
}

function claimTokens(clause) {
  return (clause.match(/[\p{L}\p{N}'-]+/gu) ?? []).flatMap((token) => {
    const parts = token.split("-").filter(Boolean);
    return parts.length > 1 ? [parts.join(""), ...parts] : [token];
  });
}

function clauseHasApprovalClaim(clause, lookalikeClause) {
  const tokens = claimTokens(clause);
  const lookalikeTokens = claimTokens(lookalikeClause);
  return tokens.some((token, index) => {
    const words = [token, lookalikeTokens[index] ?? token].map((word) => word.replace(/^'+|'+$/g, ""));
    const isApprovalWord = words.some(
      (word, form) => APPROVAL_TOKEN.test(word) || (word === "sign" && [tokens, lookalikeTokens][form][index + 1] === "off"),
    );
    if (!isApprovalWord || words.some((word) => NON_CLAIM_TOKEN.test(word) || NEGATED_TOKEN.test(word))) return false;
    for (let before = index - 1; before >= 0 && before >= index - 4; before -= 1) {
      if (NEGATOR.test(tokens[before])) return before > 0 && NEGATOR.test(tokens[before - 1]);
      if (!NEGATION_FILLER.test(tokens[before])) break;
    }
    for (let after = index + 1; after < tokens.length && after <= index + 3; after += 1) {
      if (NEGATED_FOLLOWER.test(tokens[after])) {
        return NEGATED_FOLLOWER.test(tokens[after + 1] ?? "") || NEGATOR.test(tokens[after + 1] ?? "");
      }
      if (!COPULA.test(tokens[after])) break;
    }
    return true;
  });
}

function hasApprovalClaim(line) {
  const [folded, lookalike] = forms(line.replace(/^\s*- Required approvers:/, ""));
  const clauses = folded.split(/[.;:!?,|()]+/u);
  const lookalikeClauses = lookalike.split(/[.;:!?,|()]+/u);
  return clauses.some((clause, index) => clauseHasApprovalClaim(clause, lookalikeClauses[index] ?? clause));
}

function fenceMarker(line) {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  return match ? match[1] : null;
}

function hygieneErrors(text, fileName) {
  const errors = [];
  const lines = text.split("\n");

  if (!lines[0].startsWith("# ")) {
    errors.push(`${fileName}:1: document must start with its H1 title (front matter or preamble is not allowed)`);
  }

  lines.forEach((line, index) => {
    const at = `${fileName}:${index + 1}`;
    if (/[\p{Cc}--[\t]]/v.test(line)) errors.push(`${at}: control character is not allowed`);
    if (/[\p{Cf}\p{Co}\p{Cn}\p{M}]/u.test(line)) {
      errors.push(`${at}: invisible, format, private-use, unassigned or combining character is not allowed`);
    }
    if (/[[\p{Zs}\u2028\u2029\u0085]--[ ]]/v.test(line)) errors.push(`${at}: non-ASCII whitespace is not allowed`);
    for (const character of line.match(/[\p{L}\p{N}]/gu) ?? []) {
      if (/\p{N}/u.test(character) && !/[0-9]/.test(character)) {
        errors.push(`${at}: non-ASCII digit ${JSON.stringify(character)} is not allowed`);
      } else if (/\p{L}/u.test(character) && !/[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(character)) {
        errors.push(`${at}: letter ${JSON.stringify(character)} outside Latin/Cyrillic scripts is not allowed`);
      } else if (character.normalize("NFKC") !== character) {
        errors.push(`${at}: compatibility letter ${JSON.stringify(character)} is not allowed`);
      }
    }
    for (const token of line.match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (/\p{Script=Latin}/u.test(token) && /\p{Script=Cyrillic}/u.test(token)) {
        errors.push(`${at}: mixed Latin/Cyrillic word ${JSON.stringify(token)} is not allowed`);
      }
    }
    if (line.includes("<!--")) errors.push(`${at}: HTML comments are not allowed`);
    if (/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/.test(line)) errors.push(`${at}: raw HTML is not allowed`);
    if (/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(line)) errors.push(`${at}: HTML entities are not allowed`);
    if (line.includes("~~") && !fenceMarker(line)) errors.push(`${at}: strikethrough is not allowed`);
    if (/^ {0,3}\[[^\]]+\]:/.test(line)) errors.push(`${at}: link reference and footnote definitions are not allowed`);
    if (/^[\s>]*(?:[-*+]|\d+[.)])\s+\[(?! \])[^\]]*\]/.test(line)) {
      errors.push(`${at}: checked or non-empty task-list boxes are not allowed`);
    }
  });

  return errors;
}

export function snapshotDocument(text) {
  const lines = text.split("\n");
  const snapshot = {
    title: lines[0],
    statusLines: [],
    approverLines: [],
    statusSections: [],
    statusTables: [],
    decisionRows: [],
    datedApprovalClaims: [],
    approvalClaims: [],
    fencedClaims: [],
  };
  let fence = null;
  let section = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = fenceMarker(line);

    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
        continue;
      }
      const [folded] = forms(line);
      if (FENCED_EMPTY_KEY.test(folded)) continue;
      const keyValue = folded.match(FENCED_KEY_VALUE);
      if ((keyValue && matchesAny(keyValue[1], FENCED_CLAIM_KEY)) || (!keyValue && hasApprovalVocabulary(line))) {
        snapshot.fencedClaims.push(line);
      }
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }

    if (/^#{1,2}\s/.test(line)) {
      section = /^##\s/.test(line) && matchesAny(line, STATUS_SECTION) ? { heading: line, lines: [] } : null;
      if (section) snapshot.statusSections.push(section);
    } else if (section && line.trim() !== "") {
      section.lines.push(line);
    }

    if (isStatusLine(line)) snapshot.statusLines.push(line);
    if (isApproverLine(line)) snapshot.approverLines.push(line);
    if (hasApprovalVocabulary(line) && matchesAny(line, DATE)) snapshot.datedApprovalClaims.push(line);
    if (hasApprovalClaim(line)) snapshot.approvalClaims.push(line);

    if (isTableLine(line)) {
      const [first = ""] = tableCells(line);
      if (matchesAny(first, DECISION_ID)) snapshot.decisionRows.push(first);
    }

    if (isTableLine(line) && TABLE_SEPARATOR.test(unquote(lines[index + 1] ?? ""))) {
      const header = tableCells(line);
      const columns = header
        .map((cell, column) => (matchesAny(cell, STATUS_COLUMN) ? column : -1))
        .filter((column) => column >= 0);
      let row = index + 2;
      const rows = [];
      while (row < lines.length && isTableLine(lines[row])) {
        const cells = tableCells(lines[row]);
        rows.push([cells[0] ?? "", ...columns.map((column) => cells[column] ?? "")]);
        row += 1;
      }
      if (columns.length > 0) snapshot.statusTables.push({ header, rows });
    }
  }

  return snapshot;
}

function firstDifference(actual, expected, where = "") {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return null;
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    const keys = Array.isArray(actual) && Array.isArray(expected)
      ? Array.from({ length: Math.max(actual.length, expected.length) }, (_, index) => index)
      : [...new Set([...Object.keys(actual), ...Object.keys(expected)])];
    for (const key of keys) {
      const label = typeof key === "number" ? `${where}[${key + 1}]` : `${where}.${key}`;
      const difference = firstDifference(actual[key], expected[key], label);
      if (difference) return difference;
    }
  }
  return `${where || "value"}: found ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(expected ?? null)}`;
}

function unpinnedDocumentErrors(snapshot, fileName) {
  const errors = [];
  const fail = (message) => errors.push(`${fileName}: ${message}`);

  if (hasApprovalVocabulary(snapshot.title)) fail(`title claims approval: ${snapshot.title}`);
  for (const line of snapshot.statusLines) {
    if (!/^- Status: (?:Proposed|Draft)$|^- Production effect: none$/.test(line)) {
      fail(`new documents may only declare "- Status: Proposed" or "- Status: Draft": ${line}`);
    }
  }
  for (const line of snapshot.approverLines) {
    const value = line.replace(/^- Required approvers:/, "");
    if (value === line || hasApprovalVocabulary(value)) fail(`approver records are not allowed in new documents: ${line}`);
  }
  for (const section of snapshot.statusSections) {
    for (const line of section.lines) {
      if (hasApprovalVocabulary(line)) fail(`status section claims approval: ${line}`);
    }
  }
  for (const table of snapshot.statusTables) {
    for (const [, ...cells] of table.rows) {
      for (const cell of cells) {
        if (hasApprovalVocabulary(cell)) fail(`status table cell claims approval: ${cell}`);
      }
    }
  }
  for (const line of snapshot.datedApprovalClaims) fail(`dated approval claim: ${line}`);
  for (const line of snapshot.approvalClaims) fail(`approval claim without explicit negation: ${line}`);
  for (const row of snapshot.decisionRows) fail(`decision rows belong only in decision-register.md: ${row}`);
  for (const line of snapshot.fencedClaims) fail(`filled approval/status field in code block: ${line}`);

  return errors;
}

export function validateRegulatedCoreDocuments(documents, baseline, irregular = []) {
  const errors = [];

  for (const fileName of irregular) {
    errors.push(`${fileName}: regulated-core entries must be regular files`);
  }

  for (const fileName of Object.keys(baseline.documents)) {
    if (!documents.has(fileName)) errors.push(`${fileName}: pinned regulated-core document is missing`);
  }

  for (const [fileName, text] of documents) {
    if (!fileName.endsWith(".md")) {
      errors.push(`${fileName}: only Markdown (.md) documents are allowed in ${REGULATED_CORE_DIRECTORY}`);
      continue;
    }
    errors.push(...hygieneErrors(text, fileName));
    const snapshot = snapshotDocument(text);
    const pinned = baseline.documents[fileName];

    if (!pinned) {
      errors.push(...unpinnedDocumentErrors(snapshot, fileName));
      continue;
    }

    for (const field of Object.keys(snapshot)) {
      const difference = firstDifference(snapshot[field], pinned[field]);
      if (difference) {
        errors.push(
          `${fileName}: ${field} differs from the pinned approval baseline (${difference}); ` +
            "approval-status changes need recorded human approval evidence and a deliberate baseline update",
        );
      }
    }
    for (const phrase of baseline.requiredPhrases[fileName] ?? []) {
      if (!text.includes(phrase)) errors.push(`${fileName}: required "not approved" marker is missing: ${phrase}`);
    }
  }

  return errors;
}

async function markdownDocuments(root) {
  const documents = new Map();
  const irregular = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        documents.set(path.relative(root, full).split(path.sep).join("/"), await readFile(full, "utf8"));
      } else {
        irregular.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  return {
    documents: new Map([...documents].sort(([left], [right]) => left.localeCompare(right))),
    irregular,
  };
}

export async function loadRegulatedCore(root = path.resolve(REGULATED_CORE_DIRECTORY)) {
  const { documents, irregular } = await markdownDocuments(root);
  return {
    documents,
    irregular,
    baseline: JSON.parse(await readFile(BASELINE_FILE, "utf8")),
  };
}

async function main() {
  const { documents, baseline, irregular } = await loadRegulatedCore();
  const errors = validateRegulatedCoreDocuments(documents, baseline, irregular);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`regulated-core-status-ok (${documents.size} documents)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
