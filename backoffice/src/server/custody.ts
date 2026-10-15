import type { AuditSourceEvent, CustodyIncidentStatus, CustodyWatcherIncident } from "../data/demo.js";

// Custody overview is read-only: tiers, watcher incidents and the key
// inventory are evidence surfaces — no signing, broadcast, freeze or
// policy commands live in this console.
export const custodyIncidentStatuses: readonly CustodyIncidentStatus[] = Object.freeze([
  "open",
  "investigating",
  "resolved"
]);

export function isCustodyIncidentStatus(value: string): value is CustodyIncidentStatus {
  return (custodyIncidentStatuses as readonly string[]).includes(value);
}

export function custodyIncidentAccessEvent(
  eventId: string,
  actor: string,
  incident: CustodyWatcherIncident
): AuditSourceEvent {
  return {
    eventId,
    occurredAt: new Date().toISOString(),
    actor,
    action: "custody.incident_viewed",
    resource: `custody-incident:${incident.id}`,
    outcome: "recorded",
    evidenceDigest: incident.txId
  };
}
