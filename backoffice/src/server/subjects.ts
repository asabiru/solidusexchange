import { can, type Capability } from "../auth/access.js";
import type { AuditSourceEvent, SubjectTimeline, SubjectTimelineKind } from "../data/demo.js";
import { sha256 } from "./controls.js";

// Cross-entity subject timeline lookup, read-only over synthetic data.
// Operators get one chronological feed of a subject's checks, support tickets,
// withdrawal intents, KYC/AML cases, investigations, fraud alerts and audit
// touches; every lookup appends an audit event and no route accepts commands.

export const subjectRefPattern = /^[a-z0-9_-]{4,64}$/i;

export function isSubjectRef(value: string): boolean {
  return subjectRefPattern.test(value);
}

// The timeline aggregates across every domain, so each entry kind is gated by
// the same capability that guards the domain's own read route. A role sees a
// kind only when it could read that collection directly.
export const subjectTimelineKindCapability: Readonly<Record<SubjectTimelineKind, Capability>> = Object.freeze({
  check: "checks:read",
  support: "support:read",
  withdrawal: "custody:read",
  kyc: "kyc:read",
  aml: "aml:read",
  investigation: "investigations:read",
  "fraud-alert": "fraud:read",
  audit: "audit:read"
});

export function readableSubjectKinds(role: string): ReadonlySet<SubjectTimelineKind> {
  const kinds = new Set<SubjectTimelineKind>();
  for (const kind of Object.keys(subjectTimelineKindCapability) as SubjectTimelineKind[]) {
    if (can(role, subjectTimelineKindCapability[kind])) kinds.add(kind);
  }
  return kinds;
}

export function subjectTimelineAccessEvent(
  eventId: string,
  actor: string,
  timeline: SubjectTimeline
): AuditSourceEvent {
  return {
    eventId,
    occurredAt: new Date().toISOString(),
    actor,
    action: "subject.timeline.viewed",
    resource: `subject:${timeline.subject}`,
    outcome: "recorded",
    evidenceDigest: `sha256:${sha256({ subject: timeline.subject, entries: timeline.entries.length })}`
  };
}
