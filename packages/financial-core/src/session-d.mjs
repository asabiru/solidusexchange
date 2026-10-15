import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatAmount, parseAmount } from "./amount.mjs";
import { LedgerError, createInMemoryLedger } from "./ledger.mjs";

const sessionDDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "session-d");
const SESSION_D_CHART = JSON.parse(
  readFileSync(join(sessionDDirectory, "chart-draft.json"), "utf8")
);
const SESSION_D_POSTING_RULES = JSON.parse(
  readFileSync(join(sessionDDirectory, "posting-rules-draft.json"), "utf8")
);

export const SESSION_D_ARTIFACTS = Object.freeze({
  chart: SESSION_D_CHART,
  postingRules: SESSION_D_POSTING_RULES,
  status: "session-d-draft-pending-approval"
});

const HOLD_CREATE = "SYNTHETIC_HOLD_CREATE";
const HOLD_RELEASE = "SYNTHETIC_HOLD_RELEASE";
const SUSPENSE_PARK_TYPES = new Set(["SYNTHETIC_SUSPENSE_PARK_IN", "SYNTHETIC_SUSPENSE_PARK_OUT"]);
const SUSPENSE_CLEAR_TYPES = new Set(["SYNTHETIC_SUSPENSE_CLEAR_IN", "SYNTHETIC_SUSPENSE_CLEAR_OUT"]);
const REVERSAL_OF = new Map([
  ["SYNTHETIC_PROVIDER_POSITION", "SYNTHETIC_PROVIDER_POSITION_REVERSAL"]
]);

function reject(code, message) {
  throw new LedgerError(code, message);
}

function holdEntries(command, heldAccounts, settledAccounts, code) {
  // The inner boundary already enforced the registered per-asset pattern; the
  // semantic layer adds the draft's stricter single-asset, two-leg shape so a
  // reservation can name exactly one held/settled account pair.
  if (!Array.isArray(command.entries) || command.entries.length !== 2) {
    reject(code, "A hold journal requires exactly one debit and one credit leg.");
  }
  const held = [];
  const settled = [];
  for (const entry of command.entries) {
    if (heldAccounts.has(entry.account_id)) held.push(entry);
    if (settledAccounts.has(entry.account_id)) settled.push(entry);
  }
  if (held.length !== 1 || settled.length !== 1) {
    reject(code, "A hold journal must touch one held and one settled liability account.");
  }
  return { held: held[0], settled: settled[0] };
}

export function createSessionDLedger({ accounts, assets, clock, maxJournals }) {
  const ledger = createInMemoryLedger({
    accounts,
    assets,
    chart: SESSION_D_CHART,
    postingRules: SESSION_D_POSTING_RULES,
    clock,
    maxJournals
  });
  const definitionsByCode = new Map(
    SESSION_D_CHART.account_definitions.map((definition) => [definition.code, definition])
  );
  const accountsById = new Map(accounts.map((account) => [account.account_id, account]));
  const definitionOf = (accountId) => {
    const account = accountsById.get(accountId);
    return account === undefined ? undefined : account.definition_code;
  };
  const heldAccounts = new Set(
    accounts
      .filter((account) => account.definition_code === "CUSTOMER_HELD_LIABILITY")
      .map((account) => account.account_id)
  );
  const settledAccounts = new Set(
    accounts
      .filter((account) => account.definition_code === "CUSTOMER_SETTLED_LIABILITY")
      .map((account) => account.account_id)
  );
  const scaleOf = new Map(assets.map((asset) => [asset.code, asset.scale]));

  const holds = new Map();
  const breaks = new Map();
  const reversedJournalIds = new Set();

  function post(command) {
    return ledger.post(command);
  }

  function createHold(command) {
    if (command.journal_type !== HOLD_CREATE) {
      reject("SESSION_D_JOURNAL_TYPE", `createHold requires a ${HOLD_CREATE} journal.`);
    }
    const { held, settled } = holdEntries(
      command,
      heldAccounts,
      settledAccounts,
      "SESSION_D_JOURNAL_SHAPE"
    );
    if (held.side !== "CREDIT" || settled.side !== "DEBIT") {
      reject(
        "SESSION_D_JOURNAL_SHAPE",
        "A hold creation must debit the settled leg and credit the held leg."
      );
    }
    if (held.asset_code !== settled.asset_code) {
      reject("SESSION_D_JOURNAL_SHAPE", "A hold must stay within one asset.");
    }
    if (held.amount !== settled.amount) {
      reject("SESSION_D_JOURNAL_SHAPE", "Hold legs must carry equal amounts.");
    }
    const reservationId = command.source?.reference;
    if (holds.has(reservationId)) {
      reject("SESSION_D_HOLD_STATE", `Hold ${reservationId} already exists.`);
    }
    const journal = ledger.post(command);
    holds.set(reservationId, Object.freeze({
      reservation_id: reservationId,
      create_journal_id: journal.journal_id,
      held_account_id: held.account_id,
      settled_account_id: settled.account_id,
      asset_code: held.asset_code,
      amount: held.amount,
      state: "open"
    }));
    return journal;
  }

  function releaseHold(command) {
    if (command.journal_type !== HOLD_RELEASE) {
      reject("SESSION_D_JOURNAL_TYPE", `releaseHold requires a ${HOLD_RELEASE} journal.`);
    }
    const reservationId = command.source?.reference;
    const hold = holds.get(reservationId);
    if (hold === undefined) {
      reject("SESSION_D_HOLD_STATE", `No open hold named ${reservationId}.`);
    }
    if (hold.state !== "open") {
      reject("SESSION_D_HOLD_STATE", `Hold ${reservationId} was already released.`);
    }
    if (command.causation_id !== hold.create_journal_id) {
      reject(
        "SESSION_D_BINDING",
        "A hold release must carry the hold creation journal as causation."
      );
    }
    const { held, settled } = holdEntries(
      command,
      heldAccounts,
      settledAccounts,
      "SESSION_D_JOURNAL_SHAPE"
    );
    if (held.side !== "DEBIT" || settled.side !== "CREDIT") {
      reject(
        "SESSION_D_JOURNAL_SHAPE",
        "A hold release must debit the held leg and credit the settled leg."
      );
    }
    if (
      held.account_id !== hold.held_account_id ||
      settled.account_id !== hold.settled_account_id ||
      held.asset_code !== hold.asset_code ||
      held.amount !== hold.amount ||
      settled.amount !== hold.amount
    ) {
      reject(
        "SESSION_D_BINDING",
        "A hold release must mirror the held account pair, asset and amount."
      );
    }
    const journal = ledger.post(command);
    holds.set(reservationId, Object.freeze({ ...hold, state: "released" }));
    return journal;
  }

  function reverseJournal(command) {
    const originalId = command.causation_id;
    if (typeof originalId !== "string") {
      reject("SESSION_D_BINDING", "A reversal must name the journal it corrects.");
    }
    const original = ledger.listJournals().find((journal) => journal.journal_id === originalId);
    if (original === undefined) {
      reject("SESSION_D_BINDING", `No accepted journal ${originalId} to reverse.`);
    }
    const expectedType = REVERSAL_OF.get(original.journal_type);
    if (expectedType === undefined) {
      reject(
        "SESSION_D_JOURNAL_TYPE",
        `Journal type ${original.journal_type} has no registered reversal arm.`
      );
    }
    if (command.journal_type !== expectedType) {
      reject(
        "SESSION_D_JOURNAL_TYPE",
        `Reversing ${original.journal_type} requires a ${expectedType} journal.`
      );
    }
    if (reversedJournalIds.has(originalId)) {
      reject("SESSION_D_REVERSAL_STATE", `Journal ${originalId} was already reversed.`);
    }
    if (command.source?.type !== "journal_reversal" || command.source?.reference !== originalId) {
      reject(
        "SESSION_D_BINDING",
        "A reversal must cite the original journal as journal_reversal source."
      );
    }
    if (!Array.isArray(command.entries) || command.entries.length !== original.entries.length) {
      reject("SESSION_D_JOURNAL_SHAPE", "A reversal must mirror every original entry.");
    }
    const pool = command.entries.map((entry) => ({
      account_id: entry.account_id,
      asset_code: entry.asset_code,
      amount: entry.amount,
      side: entry.side
    }));
    for (const entry of original.entries) {
      const mirroredSide = entry.side === "DEBIT" ? "CREDIT" : "DEBIT";
      const index = pool.findIndex(
        (candidate) =>
          candidate.account_id === entry.account_id &&
          candidate.asset_code === entry.asset_code &&
          candidate.amount === entry.amount &&
          candidate.side === mirroredSide
      );
      if (index === -1) {
        reject(
          "SESSION_D_JOURNAL_SHAPE",
          "A reversal must mirror each original account, asset, amount and flipped side."
        );
      }
      pool.splice(index, 1);
    }
    const journal = ledger.post(command);
    reversedJournalIds.add(originalId);
    return journal;
  }

  function reconcileAccount({ account_id: accountId, expected_normal_balance: expected }) {
    const projection = ledger.getProjection(accountId);
    const scale = scaleOf.get(projection.asset_code);
    const actual = parseAmount(
      projection.normal_balance.startsWith("-")
        ? projection.normal_balance.slice(1)
        : projection.normal_balance,
      scale
    );
    const expectedMinor = parseAmount(
      expected.startsWith("-") ? expected.slice(1) : expected,
      scale
    );
    const signedActual = projection.normal_balance.startsWith("-") ? -actual : actual;
    const signedExpected = expected.startsWith("-") ? -expectedMinor : expectedMinor;
    const difference = signedActual - signedExpected;
    return Object.freeze({
      account_id: projection.account_id,
      asset_code: projection.asset_code,
      matched: difference === 0n,
      actual_normal_balance: projection.normal_balance,
      expected_normal_balance: expected,
      difference: formatAmount(difference, scale)
    });
  }

  function parkSuspense(command) {
    if (!SUSPENSE_PARK_TYPES.has(command.journal_type)) {
      reject("SESSION_D_JOURNAL_TYPE", "parkSuspense requires a suspense park journal.");
    }
    if (command.source?.type !== "reconciliation_break") {
      reject(
        "SESSION_D_BINDING",
        "A suspense park must cite a reconciliation_break source."
      );
    }
    const reference = command.source.reference;
    if (breaks.has(reference)) {
      reject("SESSION_D_BREAK_STATE", `Reconciliation break ${reference} already parked.`);
    }
    const journal = ledger.post(command);
    breaks.set(reference, Object.freeze({
      reference,
      park_journal_id: journal.journal_id,
      direction: command.journal_type === "SYNTHETIC_SUSPENSE_PARK_IN" ? "IN" : "OUT",
      state: "open"
    }));
    return journal;
  }

  function clearSuspense(command) {
    if (!SUSPENSE_CLEAR_TYPES.has(command.journal_type)) {
      reject("SESSION_D_JOURNAL_TYPE", "clearSuspense requires a suspense clear journal.");
    }
    const parkId = command.causation_id;
    const entry = [...breaks.values()].find((record) => record.park_journal_id === parkId);
    if (entry === undefined) {
      reject("SESSION_D_BINDING", "A suspense clear must cite an open park journal.");
    }
    if (entry.state !== "open") {
      reject("SESSION_D_BREAK_STATE", `Suspense break ${entry.reference} is already resolved.`);
    }
    const expectedType =
      entry.direction === "IN" ? "SYNTHETIC_SUSPENSE_CLEAR_IN" : "SYNTHETIC_SUSPENSE_CLEAR_OUT";
    if (command.journal_type !== expectedType) {
      reject(
        "SESSION_D_JOURNAL_TYPE",
        `A ${entry.direction} break clears through ${expectedType}.`
      );
    }
    // A clear is not a reversal — it moves the parked position into its
    // resolution account — but the suspense leg must name the same suspense
    // account, asset and amount the park journal booked.
    const park = ledger.listJournals().find((journal) => journal.journal_id === parkId);
    const suspenseDefinitions = new Set(
      entry.direction === "IN" ? ["SUSPENSE_ASSET"] : ["SUSPENSE_LIABILITY"]
    );
    const parkSuspenseEntry = park.entries.find(
      (record) => suspenseDefinitions.has(definitionOf(record.account_id))
    );
    const clearSuspenseEntry = command.entries.find(
      (record) => suspenseDefinitions.has(definitionOf(record.account_id))
    );
    if (
      parkSuspenseEntry === undefined ||
      clearSuspenseEntry === undefined ||
      clearSuspenseEntry.account_id !== parkSuspenseEntry.account_id ||
      clearSuspenseEntry.asset_code !== parkSuspenseEntry.asset_code ||
      clearSuspenseEntry.amount !== parkSuspenseEntry.amount
    ) {
      reject(
        "SESSION_D_BINDING",
        "A suspense clear must reuse the parked suspense account, asset and amount."
      );
    }
    const journal = ledger.post(command);
    breaks.set(entry.reference, Object.freeze({ ...entry, state: "resolved" }));
    return journal;
  }

  return Object.freeze({
    createHold,
    releaseHold,
    reverseJournal,
    reconcileAccount,
    parkSuspense,
    clearSuspense,
    post,
    ledger,
    holds: () => [...holds.values()].map((hold) => ({ ...hold })),
    breaks: () => [...breaks.values()].map((record) => ({ ...record })),
    runtime_boundary: "dev-dry-run",
    session_scope: "session-d-draft"
  });
}
