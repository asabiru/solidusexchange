import type { AuditSourceEvent, SubjectTimeline } from "../data/demo.js";
import { sha256 } from "./controls.js";

// Cross-entity subject timeline lookup, read-only over synthetic data.
// Operators get one chronological feed of a subject's checks, support tickets,
// withdrawal intents, KYC/AML cases, investigations, fraud alerts and audit
// touches; every lookup appends an audit event and no route accepts commands.

export const subjectRefPattern = /^[a-z0-9_-]{4,64}$/i;

export function isSubjectRef(value: string): boolean {
  return subjectRefPattern.test(value);
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
