// Testnet on-chain watcher and reconciliation prototype
// (hsm-custody-program.md §"Engineering work possible now"). An injectable
// event source feeds synthetic chain observations; every outflow from a
// custody address must match a recorded live intent — anything else opens a
// critical incident and freezes the affected network, exactly as the
// production watcher must. No network access, key material or addresses:
// destinations stay `destination_ref_` references end to end.

import { snapshotPlainData } from "./unsigned-intent.mjs";

const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,127}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const TX_PATTERN = /^[a-z][a-z0-9_]{4,127}$/u;
const DIRECTIONS = new Set(["inflow", "outflow"]);

function fail(message) {
  throw new Error(message);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function assertEvent(event) {
  if (typeof event.tx_id !== "string" || !TX_PATTERN.test(event.tx_id)) {
    fail("event tx_id must be a reference");
  }
  if (typeof event.network !== "string" || !event.network.endsWith("_TESTNET")) {
    fail("event network must be testnet");
  }
  if (!DIRECTIONS.has(event.direction)) fail("event direction must be inflow or outflow");
  if (typeof event.asset !== "string" || !/^[A-Z][A-Z0-9]{1,15}$/u.test(event.asset)) {
    fail("event asset is invalid");
  }
  if (typeof event.amount !== "string" || !DECIMAL_PATTERN.test(event.amount)) {
    fail("event amount must be a canonical decimal string");
  }
  if (event.destination_reference !== null &&
      (typeof event.destination_reference !== "string" ||
        !REFERENCE_PATTERN.test(event.destination_reference) ||
        !event.destination_reference.startsWith("destination_ref_"))) {
    fail("event destination must be a reference, never a raw address");
  }
  if (!Number.isSafeInteger(event.observed_at)) fail("event observed_at must be epoch ms");
}

export function createCustodyWatcher({ intents = [] } = {}) {
  const liveIntents = new Map();
  for (const intent of snapshotPlainData(intents, "watcher intents")) {
    if (
      intent === null ||
      typeof intent !== "object" ||
      typeof intent.intent_digest !== "string" ||
      !/^[0-9a-f]{64}$/u.test(intent.intent_digest) ||
      intent.command === undefined
    ) {
      fail("watcher intents must be verified envelopes with digest and command");
    }
    liveIntents.set(intent.intent_digest, { intent, consumed: false });
  }

  const incidents = [];
  const reconciliations = [];
  const seenTx = new Set();
  const frozenNetworks = new Set();

  function observe(eventInput) {
    const event = snapshotPlainData(eventInput, "watcher event");
    assertEvent(event);
    if (seenTx.has(event.tx_id)) {
      return deepFreeze({ kind: event.direction, duplicate: true });
    }
    seenTx.add(event.tx_id);

    if (event.direction === "inflow") {
      const record = {
        kind: "inflow",
        tx_id: event.tx_id,
        network: event.network,
        asset: event.asset,
        amount: event.amount,
        destination_reference: event.destination_reference,
        observed_at: event.observed_at
      };
      reconciliations.push(record);
      return deepFreeze({ ...record, duplicate: false });
    }

    if (frozenNetworks.has(event.network)) {
      const incident = {
        severity: "critical",
        reason: "outflow_on_frozen_network",
        tx_id: event.tx_id,
        network: event.network,
        observed_at: event.observed_at
      };
      incidents.push(incident);
      return deepFreeze({ kind: "outflow", matched: false, incident });
    }

    const match = [...liveIntents.values()].find(
      ({ intent, consumed }) =>
        !consumed &&
        intent.command.network === event.network &&
        intent.command.asset === event.asset &&
        intent.command.amount === event.amount &&
        intent.command.destination_reference === event.destination_reference &&
        Date.parse(intent.command.expires_at) > event.observed_at
    );

    if (match === undefined) {
      const incident = {
        severity: "critical",
        reason: "outflow_without_intent",
        tx_id: event.tx_id,
        network: event.network,
        asset: event.asset,
        amount: event.amount,
        destination_reference: event.destination_reference,
        observed_at: event.observed_at
      };
      incidents.push(incident);
      // Any unexplained outflow freezes the affected tier surface.
      frozenNetworks.add(event.network);
      return deepFreeze({ kind: "outflow", matched: false, incident });
    }

    match.consumed = true;
    const record = {
      kind: "outflow",
      tx_id: event.tx_id,
      intent_digest: match.intent.intent_digest,
      network: event.network,
      asset: event.asset,
      amount: event.amount,
      destination_reference: event.destination_reference,
      observed_at: event.observed_at
    };
    reconciliations.push(record);
    return deepFreeze({ ...record, matched: true });
  }

  function report() {
    return deepFreeze({
      reconciliations: [...reconciliations],
      incidents: [...incidents],
      frozen_networks: [...frozenNetworks].sort(),
      live_intents: [...liveIntents.values()].map(({ intent, consumed }) => ({
        intent_digest: intent.intent_digest,
        consumed
      })),
      runtime_boundary: "dev-dry-run"
    });
  }

  return deepFreeze({ observe, report, runtime_boundary: "dev-dry-run" });
}
