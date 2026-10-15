// Dev-only dry-run migration pipeline per Documentation/regulated-core/
// migration-boundary.md: snapshot → classify → map → reconstruct → reconcile,
// emitting signed-by-contract migration journal commands for the Session D
// draft ledger and routing every discrepancy to a case — never a balancing
// plug. No production data, live cutover or dual-write: everything here is
// synthetic evidence for the migration contract.

import { createHash } from "node:crypto";

import { parseAmount } from "./amount.mjs";
import { LedgerError } from "./ledger.mjs";

const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const CLASSIFICATIONS = new Set([
  "settled",
  "pending",
  "cancelled",
  "disputed",
  "unresolved"
]);
const RECORD_TYPES = new Set(["customer_balance", "identity", "custody_address"]);

function reject(code, message) {
  throw new LedgerError(code, message);
}

function snapshotPlain(value, label) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => snapshotPlain(item, label));
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    reject("MIGRATION_INPUT_INVALID", `${label} must be plain data`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, snapshotPlain(child, `${label}.${key}`)])
  );
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function digestOf(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function assertReference(value, label) {
  if (typeof value !== "string" || !REFERENCE_PATTERN.test(value)) {
    reject("MIGRATION_INPUT_INVALID", `${label} must be an identifier string`);
  }
}

export function createMigrationPipeline({
  transformation_version = "migration-transform-v1",
  legal_entity_id = "solidchange-dev",
  treasury_account_id,
  settled_account_for = undefined,
  clock = () => new Date().toISOString()
} = {}) {
  assertReference(transformation_version, "transformation_version");
  assertReference(legal_entity_id, "legal_entity_id");
  assertReference(treasury_account_id, "treasury_account_id");
  if (settled_account_for !== undefined && typeof settled_account_for !== "function") {
    reject("MIGRATION_INPUT_INVALID", "settled_account_for must be a function");
  }

  const runId = `migration_run_${digestOf({ transformation_version, created: clock() }).slice(0, 24)}`;
  const snapshots = [];
  const classified = new Map();
  const cases = new Map();
  let caseSequence = 0;

  function openCase({ sourceRecord, reason, classification }) {
    caseSequence += 1;
    const record = {
      case_id: `migration_case_${runId.slice(-8)}_${String(caseSequence).padStart(4, "0")}`,
      migration_run_id: runId,
      source_table: sourceRecord.source_table,
      source_primary_key: sourceRecord.source_primary_key,
      classification,
      reason,
      linked: true
    };
    cases.set(record.case_id, record);
    return record;
  }

  function registerSnapshot({ source_system, snapshot_id, extracted_at, records }) {
    assertReference(source_system, "source_system");
    assertReference(snapshot_id, "snapshot_id");
    const extractedMs = Date.parse(extracted_at);
    if (!Number.isFinite(extractedMs)) {
      reject("MIGRATION_INPUT_INVALID", "extracted_at must be an ISO timestamp");
    }
    if (!Array.isArray(records)) {
      reject("MIGRATION_INPUT_INVALID", "records must be an array");
    }
    const seenKeys = new Set();
    const counts = {};
    for (const [index, raw] of records.entries()) {
      const record = snapshotPlain(raw, `records[${index}]`);
      assertReference(record.source_table, `records[${index}].source_table`);
      assertReference(record.source_primary_key, `records[${index}].source_primary_key`);
      if (!RECORD_TYPES.has(record.record_type)) {
        reject("MIGRATION_INPUT_INVALID", `records[${index}] has an unknown record_type`);
      }
      const identity = `${record.source_table}|${record.source_primary_key}`;
      if (seenKeys.has(identity)) {
        reject("MIGRATION_INPUT_INVALID", `duplicate source row ${identity}`);
      }
      seenKeys.add(identity);
      if (record.record_type === "customer_balance") {
        assertReference(record.customer_reference, `records[${index}].customer_reference`);
        if (typeof record.amount !== "string") {
          reject("MIGRATION_INPUT_INVALID", `records[${index}].amount must be a decimal string`);
        }
        if (typeof record.legacy_status !== "string" || !CLASSIFICATIONS.has(record.legacy_status)) {
          reject("MIGRATION_INPUT_INVALID", `records[${index}] has an unknown legacy_status`);
        }
      }
      counts[record.record_type] = (counts[record.record_type] ?? 0) + 1;
    }
    const snapshot = {
      source_system,
      snapshot_id,
      extracted_at,
      record_count: records.length,
      counts,
      payload_digest: digestOf(records),
      records: records.map((record) => snapshotPlain(record, "record"))
    };
    snapshots.push(deepFreeze(snapshot));
    return cloneFreeze(snapshot);
  }

  function classify(record) {
    // Pending/unresolved/disputed rows never become opening balances — they
    // surface as cases for the approved classification path.
    if (record.record_type !== "customer_balance") {
      return { classification: record.record_type === "identity" ? "settled" : "unresolved" };
    }
    if (record.legacy_status === "settled") {
      try {
        parseAmount(record.amount, 18);
        return { classification: "settled" };
      } catch {
        return { classification: "unresolved", reason: "non_positive_or_invalid_amount" };
      }
    }
    return {
      classification: record.legacy_status,
      reason: `legacy_status:${record.legacy_status}`
    };
  }

  function classifyAll(snapshotIndex = 0) {
    const snapshot = snapshots[snapshotIndex];
    if (snapshot === undefined) reject("MIGRATION_STATE", "register a snapshot first");
    for (const [index, record] of snapshot.records.entries()) {
      const key = `${record.source_table}|${record.source_primary_key}`;
      if (classified.has(key)) continue;
      const { classification, reason } = classify(record);
      const entry = {
        migration_run_id: runId,
        source_system: snapshot.source_system,
        source_table: record.source_table,
        source_primary_key: record.source_primary_key,
        canonical_entity_id:
          record.record_type === "customer_balance"
            ? `customer_mig_${digestOf(record.customer_reference).slice(0, 16)}`
            : null,
        source_snapshot_timestamp: snapshot.extracted_at,
        payload_digest: digestOf(record),
        transformation_version,
        classification,
        record_type: record.record_type,
        result: null,
        linked_case: null
      };
      if (classification !== "settled") {
        const opened = openCase({
          sourceRecord: record,
          reason: reason ?? `classification:${classification}`,
          classification
        });
        entry.linked_case = opened.case_id;
        entry.result = "case";
      } else {
        entry.result = "candidate";
      }
      classified.set(key, Object.freeze(entry));
    }
    return classified.size;
  }

  function reconstructPositions() {
    const positions = new Map();
    for (const record of classified.values()) {
      if (record.result !== "candidate" || record.record_type !== "customer_balance") continue;
      const source = snapshotRecord(record);
      const key = `${record.canonical_entity_id}|${source.asset_code}`;
      const existing = positions.get(key) ?? {
        canonical_entity_id: record.canonical_entity_id,
        customer_reference: source.customer_reference,
        asset_code: source.asset_code,
        opening_balance_minor: 0n,
        source_records: []
      };
      existing.opening_balance_minor += parseAmount(source.amount, 18);
      existing.source_records.push(`${record.source_table}:${record.source_primary_key}`);
      positions.set(key, existing);
    }
    return [...positions.values()]
      .sort((left, right) =>
        `${left.canonical_entity_id}|${left.asset_code}` <
        `${right.canonical_entity_id}|${right.asset_code}`
          ? -1
          : 1
      )
      .map((position) =>
        Object.freeze({
          ...position,
          opening_balance_minor: position.opening_balance_minor.toString()
        })
      );
  }

  function snapshotRecord(classifiedRecord) {
    for (const snapshot of snapshots) {
      const found = snapshot.records.find(
        (record) =>
          record.source_table === classifiedRecord.source_table &&
          record.source_primary_key === classifiedRecord.source_primary_key
      );
      if (found) return found;
    }
    reject("MIGRATION_STATE", "classified record lost its source row");
  }

  function buildOpeningCommands({ asset_scale }) {
    if (!Number.isInteger(asset_scale) || asset_scale < 0 || asset_scale > 18) {
      reject("MIGRATION_INPUT_INVALID", "asset_scale must be 0..18");
    }
    const commands = [];
    for (const position of reconstructPositions()) {
      const minor = BigInt(position.opening_balance_minor);
      const ledgerScale = asset_scale;
      const factor = 10n ** BigInt(18 - ledgerScale);
      if (18 - ledgerScale < 0 || minor % factor !== 0n) {
        openCase({
          sourceRecord: {
            source_table: "migration_positions",
            source_primary_key: `${position.canonical_entity_id}:${position.asset_code}`
          },
          reason: "opening_amount_exceeds_asset_scale",
          classification: "unresolved"
        });
        continue;
      }
      const scaled = minor / factor;
      const decimal = formatMinor(scaled, ledgerScale);
      const settledAccount = settled_account_for?.(position) ??
        reject("MIGRATION_INPUT_INVALID", "settled_account_for is required for opening journals");
      const correlation = digestOf({ runId, position: position.canonical_entity_id, asset: position.asset_code });
      commands.push({
        journal_id: migrationUuid(correlation, 0),
        journal_type: "SYNTHETIC_MIGRATION_OPENING",
        legal_entity_id,
        idempotency_key: `migration_opening_${runId}_${position.canonical_entity_id}_${position.asset_code}`,
        correlation_id: migrationUuid(correlation, 1),
        causation_id: null,
        effective_at: clock(),
        actor: { type: "MIGRATION_JOB", id: runId },
        authorization_reference: `migration_approval_${runId}`,
        policy_version: "ledger-dev-policy-v1",
        posting_rule_version: "synthetic-migration-opening-v1",
        source: {
          type: "migration_opening",
          reference: `migration_opening_${position.canonical_entity_id}_${position.asset_code}`,
          evidence_digest: digestOf(position)
        },
        entries: [
          {
            entry_id: migrationUuid(correlation, 2),
            account_id: treasury_account_id,
            asset_code: position.asset_code,
            side: "DEBIT",
            amount: decimal
          },
          {
            entry_id: migrationUuid(correlation, 3),
            account_id: settledAccount,
            asset_code: position.asset_code,
            side: "CREDIT",
            amount: decimal
          }
        ]
      });
    }
    return deepFreeze(commands);
  }

  function reconcileStatements(statements, { asset_scale = 18 } = {}) {
    if (!Array.isArray(statements)) {
      reject("MIGRATION_INPUT_INVALID", "statements must be an array");
    }
    const positions = new Map(
      reconstructPositions().map((position) => [
        `${position.customer_reference}|${position.asset_code}`,
        position
      ])
    );
    const matches = [];
    const breaks = [];
    for (const statement of statements.map((row) => snapshotPlain(row, "statement"))) {
      assertReference(statement.customer_reference, "statement.customer_reference");
      const key = `${statement.customer_reference}|${statement.asset_code}`;
      const position = positions.get(key);
      const expectedMinor = position ? BigInt(position.opening_balance_minor) : 0n;
      let actualMinor;
      try {
        actualMinor = parseAmount(statement.amount, asset_scale);
      } catch {
        actualMinor = null;
      }
      if (actualMinor === null) {
        breaks.push({ ...statement, reason: "unparseable_statement_amount" });
        continue;
      }
      const scaled = actualMinor * 10n ** BigInt(18 - asset_scale);
      if (position === undefined || scaled !== expectedMinor) {
        breaks.push({
          customer_reference: statement.customer_reference,
          asset_code: statement.asset_code,
          expected_minor: expectedMinor.toString(),
          actual_minor: scaled.toString(),
          reason: position === undefined ? "no_reconstructed_position" : "balance_mismatch"
        });
        continue;
      }
      matches.push({
        customer_reference: statement.customer_reference,
        asset_code: statement.asset_code,
        amount: statement.amount
      });
    }
    return deepFreeze({
      migration_run_id: runId,
      matched: matches.length,
      matches,
      breaks,
      balanced: breaks.length === 0
    });
  }

  function report() {
    const body = {
      migration_run_id: runId,
      legal_entity_id,
      transformation_version,
      snapshots: snapshots.map(({ records, ...meta }) => meta),
      classified: [...classified.values()],
      cases: [...cases.values()],
      positions: reconstructPositions()
    };
    return deepFreeze({ ...body, evidence_digest: digestOf(body) });
  }

  return deepFreeze({
    registerSnapshot,
    classifyAll,
    reconstructPositions,
    buildOpeningCommands,
    reconcileStatements,
    report,
    migration_run_id: runId,
    runtime_boundary: "dev-dry-run"
  });
}

function formatMinor(minor, scale) {
  const digits = minor.toString();
  if (scale === 0) return digits;
  const padded = digits.padStart(scale + 1, "0");
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function migrationUuid(seedHex, slot) {
  // Deterministic RFC 4122-shaped UUIDv7 derivation for reproducible
  // migration artifacts: version/variant nibbles pinned, rest seeded.
  const hex = createHash("sha256").update(`${seedHex}:${slot}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${"89ab"[Number(`0x${hex[16]}`) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function cloneFreeze(value) {
  return deepFreeze(structuredClone(value));
}
