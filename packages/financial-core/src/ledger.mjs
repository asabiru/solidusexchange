import { createHash } from "node:crypto";
import { types } from "node:util";

import { formatAmount, parseAmount } from "./amount.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/;
const ASSET_PATTERN = /^[A-Z0-9]{2,12}$/;
const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;
const JOURNAL_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$/;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const MAX_ENTRIES = 1000;
const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/;

const CHART_KEYS = new Set([
  "account_definitions",
  "chart_version",
  "direct_balance_updates_allowed",
  "financial_execution_enabled",
  "holds_in_scope",
  "production_assets_enabled",
  "reconciliation_in_scope",
  "reversals_in_scope",
  "runtime_boundary",
  "status"
]);
const COMMAND_KEYS = new Set([
  "actor",
  "authorization_reference",
  "causation_id",
  "correlation_id",
  "effective_at",
  "entries",
  "idempotency_key",
  "journal_id",
  "journal_type",
  "legal_entity_id",
  "policy_version",
  "posting_rule_version",
  "source"
]);
const ACTOR_KEYS = new Set(["id", "type"]);
const SOURCE_KEYS = new Set(["evidence_digest", "reference", "type"]);
const ENTRY_KEYS = new Set(["account_id", "amount", "asset_code", "entry_id", "side"]);
const ACTOR_TYPES = new Set(["MIGRATION_JOB", "OPERATOR", "SERVICE"]);
const SIDES = new Set(["CREDIT", "DEBIT"]);
const NORMAL_SIDE = new Map([
  ["ASSET", "DEBIT"],
  ["EQUITY", "CREDIT"],
  ["EXPENSE", "DEBIT"],
  ["LIABILITY", "CREDIT"],
  ["REVENUE", "CREDIT"]
]);
const REQUIRED_CATEGORIES = new Set([
  "customer",
  "custody",
  "fee",
  "provider",
  "suspense",
  "treasury"
]);
const RULE_REGISTRY_KEYS = new Set([
  "production_execution_enabled",
  "registry_version",
  "rules",
  "runtime_boundary",
  "status"
]);
const RULE_KEYS = new Set([
  "allowed_actor_types",
  "entry_pattern",
  "journal_type",
  "posting_rule_version",
  "purpose",
  "scope"
]);
const RULE_LEG_KEYS = new Set(["definition_code", "side"]);

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new LedgerError(code, message);
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("LEDGER_VALIDATION_FAILED", `${label} must be an object.`);
  }
  const actual = Object.keys(value);
  for (const key of actual) {
    if (!expected.has(key)) {
      reject("LEDGER_VALIDATION_FAILED", `${label} contains unsupported field ${key}.`);
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      reject("LEDGER_VALIDATION_FAILED", `${label} is missing ${key}.`);
    }
  }
}

function assertString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    reject("LEDGER_VALIDATION_FAILED", `${label} has an invalid format.`);
  }
}

function assertDateTime(value, label) {
  const match = typeof value === "string" ? DATE_TIME_PATTERN.exec(value) : null;
  if (!match) {
    reject("LEDGER_VALIDATION_FAILED", `${label} must be an ISO date-time.`);
  }
  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] =
    match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = Number(secondValue);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    (offsetHour === 14 && offsetMinute > 0) ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(value))
  ) {
    reject("LEDGER_VALIDATION_FAILED", `${label} must be an ISO date-time.`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function snapshotPlainData(value, code, label, ancestors = new Set()) {
  if (typeof value === "function") reject(code, `${label} must be plain data.`);
  if (value === null || typeof value !== "object") return value;
  if (types.isProxy(value)) reject(code, `${label} must be plain data.`);
  if (ancestors.has(value)) reject(code, `${label} must not be cyclic.`);
  const isArray = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (isArray ? Array.prototype : Object.prototype)) {
    reject(code, `${label} must be plain data.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (isArray && keys.length !== descriptors.length.value + 1) {
    reject(code, `${label} must be a dense array without extra properties.`);
  }
  const snapshot = isArray ? [] : {};
  ancestors.add(value);
  for (const key of keys) {
    if (isArray && key === "length") continue;
    if (typeof key !== "string" || (isArray && !ARRAY_INDEX_PATTERN.test(key))) {
      reject(code, `${label} must not contain symbol or non-index keys.`);
    }
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      reject(code, `${label}.${key} must be an enumerable data property.`);
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: snapshotPlainData(descriptor.value, code, `${label}.${key}`, ancestors),
      writable: true
    });
  }
  ancestors.delete(value);
  return snapshot;
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

export function validateChart(chartInput) {
  const chart = snapshotPlainData(chartInput, "LEDGER_CHART_INVALID", "Chart of accounts");
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) {
    reject("LEDGER_CHART_INVALID", "Chart of accounts must be an object.");
  }
  assertExactKeys(chart, CHART_KEYS, "Chart of accounts");
  if (chart.chart_version !== 1 || chart.status !== "draft") {
    reject("LEDGER_CHART_INVALID", "Chart version 1 must remain draft until Finance approval.");
  }
  if (
    chart.runtime_boundary !== "dev-dry-run" ||
    chart.financial_execution_enabled !== false ||
    chart.production_assets_enabled !== false ||
    chart.direct_balance_updates_allowed !== false
  ) {
    reject("LEDGER_CHART_INVALID", "Chart violates the dev-only runtime boundary.");
  }
  if (
    chart.holds_in_scope !== false ||
    chart.reversals_in_scope !== false ||
    chart.reconciliation_in_scope !== false
  ) {
    reject("LEDGER_CHART_INVALID", "Session D capabilities must remain out of this foundation.");
  }
  if (!Array.isArray(chart.account_definitions) || chart.account_definitions.length === 0) {
    reject("LEDGER_CHART_INVALID", "Chart must define accounts.");
  }

  const codes = new Set();
  const categories = new Set();
  for (const definition of chart.account_definitions) {
    assertExactKeys(
      definition,
      new Set(["account_class", "category", "code", "normal_side", "owner_scope", "purpose"]),
      "Account definition"
    );
    assertString(definition.code, JOURNAL_TYPE_PATTERN, "Account definition code");
    if (codes.has(definition.code)) {
      reject("LEDGER_CHART_INVALID", `Duplicate account definition ${definition.code}.`);
    }
    codes.add(definition.code);
    if (!REQUIRED_CATEGORIES.has(definition.category)) {
      reject("LEDGER_CHART_INVALID", `Invalid category for ${definition.code}.`);
    }
    categories.add(definition.category);
    if (NORMAL_SIDE.get(definition.account_class) !== definition.normal_side) {
      reject("LEDGER_CHART_INVALID", `Invalid normal side for ${definition.code}.`);
    }
    if (!["forbidden", "optional", "required"].includes(definition.owner_scope)) {
      reject("LEDGER_CHART_INVALID", `Invalid owner scope for ${definition.code}.`);
    }
    if (typeof definition.purpose !== "string" || definition.purpose.length < 24) {
      reject("LEDGER_CHART_INVALID", `Purpose is incomplete for ${definition.code}.`);
    }
  }
  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) {
      reject("LEDGER_CHART_INVALID", `Missing chart category ${category}.`);
    }
  }
  return true;
}

function buildPostingRuleRegistry(registry, chart) {
  assertExactKeys(registry, RULE_REGISTRY_KEYS, "Posting rule registry");
  if (
    registry.registry_version !== 1 ||
    registry.status !== "draft" ||
    registry.runtime_boundary !== "dev-dry-run" ||
    registry.production_execution_enabled !== false
  ) {
    reject(
      "LEDGER_POSTING_RULES_INVALID",
      "Posting rules must remain draft, dev-only and non-production."
    );
  }
  if (!Array.isArray(registry.rules) || registry.rules.length === 0) {
    reject("LEDGER_POSTING_RULES_INVALID", "At least one synthetic posting rule is required.");
  }

  const definitions = new Set(chart.account_definitions.map(({ code }) => code));
  const rules = new Map();
  for (const rule of registry.rules) {
    assertExactKeys(rule, RULE_KEYS, "Posting rule");
    assertString(rule.journal_type, JOURNAL_TYPE_PATTERN, "Rule journal type");
    assertString(rule.posting_rule_version, VERSION_PATTERN, "Posting rule version");
    if (rule.scope !== "synthetic-test-only") {
      reject("LEDGER_POSTING_RULES_INVALID", "Only synthetic test rules are allowed.");
    }
    if (typeof rule.purpose !== "string" || rule.purpose.length < 24) {
      reject("LEDGER_POSTING_RULES_INVALID", "Posting rule purpose is incomplete.");
    }
    if (
      !Array.isArray(rule.allowed_actor_types) ||
      rule.allowed_actor_types.length === 0 ||
      new Set(rule.allowed_actor_types).size !== rule.allowed_actor_types.length ||
      rule.allowed_actor_types.some((actorType) => !ACTOR_TYPES.has(actorType))
    ) {
      reject("LEDGER_POSTING_RULES_INVALID", "Posting rule actor types are invalid.");
    }
    if (!Array.isArray(rule.entry_pattern) || rule.entry_pattern.length < 2) {
      reject("LEDGER_POSTING_RULES_INVALID", "Posting rule requires at least two entry legs.");
    }

    const entryPattern = new Set();
    for (const leg of rule.entry_pattern) {
      assertExactKeys(leg, RULE_LEG_KEYS, "Posting rule leg");
      assertString(leg.definition_code, JOURNAL_TYPE_PATTERN, "Rule account definition");
      if (!definitions.has(leg.definition_code) || !SIDES.has(leg.side)) {
        reject("LEDGER_POSTING_RULES_INVALID", "Posting rule leg is invalid.");
      }
      const signature = `${leg.definition_code}|${leg.side}`;
      if (entryPattern.has(signature)) {
        reject("LEDGER_POSTING_RULES_INVALID", `Duplicate posting rule leg ${signature}.`);
      }
      entryPattern.add(signature);
    }

    const identity = `${rule.journal_type}|${rule.posting_rule_version}`;
    if (rules.has(identity)) {
      reject("LEDGER_POSTING_RULES_INVALID", `Duplicate posting rule ${identity}.`);
    }
    rules.set(identity, freezeDeep(clone(rule)));
  }
  return rules;
}

export function validatePostingRules(registryInput, chartInput) {
  const chart = snapshotPlainData(chartInput, "LEDGER_CHART_INVALID", "Chart of accounts");
  const registry = snapshotPlainData(
    registryInput,
    "LEDGER_POSTING_RULES_INVALID",
    "Posting rule registry"
  );
  validateChart(chart);
  buildPostingRuleRegistry(registry, chart);
  return true;
}

function validateAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) {
    reject("LEDGER_CONFIGURATION_INVALID", "At least one synthetic asset is required.");
  }
  const result = new Map();
  for (const asset of assets) {
    assertExactKeys(asset, new Set(["code", "scale"]), "Asset");
    assertString(asset.code, ASSET_PATTERN, "Asset code");
    if (!Number.isInteger(asset.scale) || asset.scale < 0 || asset.scale > 18) {
      reject("LEDGER_CONFIGURATION_INVALID", `Invalid scale for ${asset.code}.`);
    }
    if (result.has(asset.code)) {
      reject("LEDGER_CONFIGURATION_INVALID", `Duplicate asset ${asset.code}.`);
    }
    result.set(asset.code, freezeDeep(clone(asset)));
  }
  return result;
}

function validateAccounts(accounts, chartDefinitions, assets) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    reject("LEDGER_CONFIGURATION_INVALID", "At least one ledger account is required.");
  }
  const result = new Map();
  const identities = new Set();
  for (const account of accounts) {
    assertExactKeys(
      account,
      new Set([
        "account_id",
        "asset_code",
        "created_at",
        "definition_code",
        "legal_entity_id",
        "owner_reference"
      ]),
      "Ledger account"
    );
    assertString(account.account_id, UUID_PATTERN, "Account ID");
    assertString(account.legal_entity_id, IDENTIFIER_PATTERN, "Legal entity ID");
    assertString(account.asset_code, ASSET_PATTERN, "Account asset");
    assertDateTime(account.created_at, "Account created_at");
    if (!assets.has(account.asset_code)) {
      reject("LEDGER_CONFIGURATION_INVALID", `Unknown asset ${account.asset_code}.`);
    }
    const definition = chartDefinitions.get(account.definition_code);
    if (!definition) {
      reject("LEDGER_CONFIGURATION_INVALID", `Unknown definition ${account.definition_code}.`);
    }
    if (definition.owner_scope === "required") {
      if (
        typeof account.owner_reference !== "string" ||
        !IDENTIFIER_PATTERN.test(account.owner_reference)
      ) {
        reject(
          "LEDGER_CONFIGURATION_INVALID",
          `${account.definition_code} requires an owner reference.`
        );
      }
    } else if (definition.owner_scope === "forbidden" && account.owner_reference !== null) {
      reject("LEDGER_CONFIGURATION_INVALID", `${account.definition_code} forbids an owner reference.`);
    } else if (
      definition.owner_scope === "optional" &&
      account.owner_reference !== null &&
      (typeof account.owner_reference !== "string" ||
        !IDENTIFIER_PATTERN.test(account.owner_reference))
    ) {
      reject("LEDGER_CONFIGURATION_INVALID", `${account.definition_code} has an invalid owner reference.`);
    }
    if (result.has(account.account_id)) {
      reject("LEDGER_CONFIGURATION_INVALID", `Duplicate account ID ${account.account_id}.`);
    }
    const identity = [
      account.legal_entity_id,
      account.asset_code,
      account.definition_code,
      account.owner_reference ?? ""
    ].join("|");
    if (identities.has(identity)) {
      reject("LEDGER_CONFIGURATION_INVALID", `Duplicate account identity ${identity}.`);
    }
    identities.add(identity);
    result.set(account.account_id, freezeDeep(clone(account)));
  }
  return result;
}

function validateCommand(command, accounts, assets, postingRules) {
  assertExactKeys(command, COMMAND_KEYS, "Posting command");
  assertString(command.journal_id, UUID_PATTERN, "Journal ID");
  assertString(command.journal_type, JOURNAL_TYPE_PATTERN, "Journal type");
  assertString(command.legal_entity_id, IDENTIFIER_PATTERN, "Legal entity ID");
  assertString(command.idempotency_key, IDEMPOTENCY_KEY_PATTERN, "Idempotency key");
  assertString(command.correlation_id, UUID_PATTERN, "Correlation ID");
  if (command.causation_id !== null) {
    assertString(command.causation_id, UUID_PATTERN, "Causation ID");
  }
  assertDateTime(command.effective_at, "Effective time");
  assertString(command.authorization_reference, IDENTIFIER_PATTERN, "Authorization reference");
  assertString(command.policy_version, VERSION_PATTERN, "Policy version");
  assertString(command.posting_rule_version, VERSION_PATTERN, "Posting rule version");
  const postingRule = postingRules.get(
    `${command.journal_type}|${command.posting_rule_version}`
  );
  if (!postingRule) {
    reject("LEDGER_POSTING_RULE_NOT_FOUND", "Posting rule is not registered.");
  }

  assertExactKeys(command.actor, ACTOR_KEYS, "Actor");
  if (!ACTOR_TYPES.has(command.actor.type)) {
    reject("LEDGER_VALIDATION_FAILED", "Actor type is not permitted.");
  }
  if (!postingRule.allowed_actor_types.includes(command.actor.type)) {
    reject("LEDGER_POSTING_RULE_VIOLATION", "Actor is not permitted by the posting rule.");
  }
  assertString(command.actor.id, IDENTIFIER_PATTERN, "Actor ID");

  assertExactKeys(command.source, SOURCE_KEYS, "Source");
  assertString(command.source.type, IDENTIFIER_PATTERN, "Source type");
  assertString(command.source.reference, IDENTIFIER_PATTERN, "Source reference");
  assertString(command.source.evidence_digest, DIGEST_PATTERN, "Evidence digest");

  if (
    !Array.isArray(command.entries) ||
    command.entries.length < 2 ||
    command.entries.length > MAX_ENTRIES
  ) {
    reject(
      "LEDGER_VALIDATION_FAILED",
      `A journal requires 2 to ${MAX_ENTRIES} entries.`
    );
  }
  const entryIds = new Set();
  const totals = new Map();
  const entryPatterns = new Map();
  for (const entry of command.entries) {
    assertExactKeys(entry, ENTRY_KEYS, "Ledger entry");
    assertString(entry.entry_id, UUID_PATTERN, "Entry ID");
    assertString(entry.account_id, UUID_PATTERN, "Entry account ID");
    assertString(entry.asset_code, ASSET_PATTERN, "Entry asset");
    if (!SIDES.has(entry.side)) {
      reject("LEDGER_VALIDATION_FAILED", "Entry side must be DEBIT or CREDIT.");
    }
    if (entryIds.has(entry.entry_id)) {
      reject("LEDGER_VALIDATION_FAILED", `Duplicate entry ID ${entry.entry_id}.`);
    }
    entryIds.add(entry.entry_id);

    const account = accounts.get(entry.account_id);
    if (!account) reject("LEDGER_ACCOUNT_NOT_FOUND", `Unknown account ${entry.account_id}.`);
    if (account.legal_entity_id !== command.legal_entity_id) {
      reject("LEDGER_BOUNDARY_VIOLATION", "Entry crosses the journal legal-entity boundary.");
    }
    if (account.asset_code !== entry.asset_code) {
      reject("LEDGER_BOUNDARY_VIOLATION", "Entry asset does not match its account.");
    }
    const pattern = entryPatterns.get(entry.asset_code) ?? [];
    pattern.push(`${account.definition_code}|${entry.side}`);
    entryPatterns.set(entry.asset_code, pattern);
    const asset = assets.get(entry.asset_code);
    let minorUnits;
    try {
      minorUnits = parseAmount(entry.amount, asset.scale);
    } catch (error) {
      reject("LEDGER_AMOUNT_INVALID", error.message);
    }
    const signed = entry.side === "DEBIT" ? minorUnits : -minorUnits;
    totals.set(entry.asset_code, (totals.get(entry.asset_code) ?? 0n) + signed);
  }
  for (const [asset, total] of totals) {
    if (total !== 0n) {
      reject("LEDGER_UNBALANCED_JOURNAL", `Journal is not balanced for ${asset}.`);
    }
  }
  const expectedPattern = postingRule.entry_pattern
    .map(({ definition_code: definitionCode, side }) => `${definitionCode}|${side}`)
    .sort();
  for (const [asset, pattern] of entryPatterns) {
    const actualPattern = pattern.sort();
    if (
      actualPattern.length !== expectedPattern.length ||
      actualPattern.some((signature, index) => signature !== expectedPattern[index])
    ) {
      reject(
        "LEDGER_POSTING_RULE_VIOLATION",
        `Journal entries do not match the registered pattern for ${asset}.`
      );
    }
  }
}

export function createInMemoryLedger({
  accounts: accountsInput,
  assets: assetsInput,
  chart: chartInput,
  postingRules: postingRulesInput,
  clock = () => new Date().toISOString()
}) {
  const chart = snapshotPlainData(chartInput, "LEDGER_CHART_INVALID", "Chart of accounts");
  const postingRules = snapshotPlainData(
    postingRulesInput,
    "LEDGER_POSTING_RULES_INVALID",
    "Posting rule registry"
  );
  const assets = snapshotPlainData(assetsInput, "LEDGER_CONFIGURATION_INVALID", "Assets");
  const accounts = snapshotPlainData(
    accountsInput,
    "LEDGER_CONFIGURATION_INVALID",
    "Ledger accounts"
  );
  validateChart(chart);
  if (typeof clock !== "function") {
    reject("LEDGER_CONFIGURATION_INVALID", "Ledger clock must be a function.");
  }
  const definitions = new Map(
    chart.account_definitions.map((definition) => [definition.code, freezeDeep(clone(definition))])
  );
  const postingRuleRegistry = buildPostingRuleRegistry(postingRules, chart);
  const assetRegistry = validateAssets(assets);
  const accountRegistry = validateAccounts(accounts, definitions, assetRegistry);
  const journals = new Map();
  const idempotency = new Map();

  function post(command) {
    const candidate = snapshotPlainData(command, "LEDGER_VALIDATION_FAILED", "Posting command");
    validateCommand(candidate, accountRegistry, assetRegistry, postingRuleRegistry);
    const commandDigest = digest(candidate);
    const idempotencyIdentity = `${candidate.legal_entity_id}|${candidate.idempotency_key}`;
    const prior = idempotency.get(idempotencyIdentity);
    if (prior) {
      if (prior.commandDigest !== commandDigest) {
        reject(
          "LEDGER_IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used with a different command."
        );
      }
      return clone(prior.journal);
    }
    if (journals.has(candidate.journal_id)) {
      reject("LEDGER_DUPLICATE_JOURNAL", "Journal ID already exists.");
    }

    const acceptedAt = clock();
    assertDateTime(acceptedAt, "Accepted time");
    const accepted = freezeDeep({
      ...candidate,
      accepted_at: acceptedAt,
      command_digest: commandDigest
    });
    journals.set(candidate.journal_id, accepted);
    idempotency.set(idempotencyIdentity, freezeDeep({ commandDigest, journal: accepted }));
    return clone(accepted);
  }

  function listJournals() {
    return [...journals.values()].map(clone);
  }

  function getProjection(accountId) {
    const account = accountRegistry.get(accountId);
    if (!account) reject("LEDGER_ACCOUNT_NOT_FOUND", `Unknown account ${accountId}.`);
    const definition = definitions.get(account.definition_code);
    const asset = assetRegistry.get(account.asset_code);
    let debits = 0n;
    let credits = 0n;
    for (const journal of journals.values()) {
      for (const entry of journal.entries) {
        if (entry.account_id !== accountId) continue;
        const amount = parseAmount(entry.amount, asset.scale);
        if (entry.side === "DEBIT") debits += amount;
        else credits += amount;
      }
    }
    const balance = definition.normal_side === "DEBIT" ? debits - credits : credits - debits;
    return freezeDeep({
      account_id: accountId,
      asset_code: account.asset_code,
      as_of_journal_count: journals.size,
      debit_total: formatAmount(debits, asset.scale),
      credit_total: formatAmount(credits, asset.scale),
      normal_balance: formatAmount(balance, asset.scale)
    });
  }

  function getTrialBalance() {
    const totals = new Map();
    for (const journal of journals.values()) {
      for (const entry of journal.entries) {
        const identity = `${journal.legal_entity_id}|${entry.asset_code}`;
        const row = totals.get(identity) ?? {
          legalEntityId: journal.legal_entity_id,
          assetCode: entry.asset_code,
          debits: 0n,
          credits: 0n,
          entryCount: 0,
          journalIds: new Set()
        };
        const amount = parseAmount(entry.amount, assetRegistry.get(entry.asset_code).scale);
        if (entry.side === "DEBIT") row.debits += amount;
        else row.credits += amount;
        row.entryCount += 1;
        row.journalIds.add(journal.journal_id);
        totals.set(identity, row);
      }
    }

    return freezeDeep(
      [...totals.values()]
        .sort(
          (left, right) =>
            left.legalEntityId.localeCompare(right.legalEntityId) ||
            left.assetCode.localeCompare(right.assetCode)
        )
        .map((row) => {
          const scale = assetRegistry.get(row.assetCode).scale;
          const difference = row.debits - row.credits;
          return {
            legal_entity_id: row.legalEntityId,
            asset_code: row.assetCode,
            journal_count: row.journalIds.size,
            entry_count: row.entryCount,
            debit_total: formatAmount(row.debits, scale),
            credit_total: formatAmount(row.credits, scale),
            difference: formatAmount(difference, scale),
            balanced: difference === 0n
          };
        })
    );
  }

  function rebuildProjectionSnapshot() {
    const snapshot = {
      as_of_journal_count: journals.size,
      projections: [...accountRegistry.keys()].sort().map(getProjection),
      trial_balance: getTrialBalance()
    };
    return freezeDeep({
      ...snapshot,
      snapshot_digest: digest(snapshot)
    });
  }

  return freezeDeep({
    getProjection,
    getTrialBalance,
    listJournals,
    post,
    rebuildProjectionSnapshot,
    runtime_boundary: "dev-dry-run"
  });
}
