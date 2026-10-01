# Regulated Incident Response Baseline — Proposed

- Status: Proposed
- Scope: regulated-core architecture and dev-only evidence
- Owners: Security / SRE
- Required approvers: CTO, Security, MLRO, Legal/Privacy, Finance
- Production effect: none

## Purpose

This baseline defines how SolidChange must coordinate, preserve evidence and make human decisions when an event could affect regulated data, financial truth, custody, operator access, provider evidence or the software supply chain.

It is not a production runbook. Provider contacts, regulator timelines, customer-notification rules, infrastructure commands, production identities and emergency command paths remain undefined until their owners approve them. Missing ownership or notification guidance is a production stop condition.

Provider assessment, monitoring, cooperation and exit requirements are defined
in the proposed [third-party risk baseline](third-party-risk.md). Provider
communications remain claims until bound to preserved evidence.

Business-service impact tolerances, degraded modes, capacity, continuity and
recovery exercises are defined in the proposed
[operational-resilience baseline](operational-resilience.md). An incident
resume decision cannot substitute for missing resilience approval.

## Objectives

1. Protect customers and prevent additional unauthorized activity.
2. Preserve append-only financial, custody and audit evidence.
3. Keep containment separate from financial correction and legal conclusions.
4. Restore only to an independently verified canonical state.
5. Give Legal, MLRO, Finance, Security and Custody accountable human decision points.
6. Maintain a timestamped record of observations, decisions, approvals and actions.
7. Notify affected parties only through approved legal and communications channels.
8. Convert confirmed causes into tested controls without erasing original evidence.

## Non-goals

This document does not:

- authorize money movement, account freezing, transaction reversal, signing or broadcast;
- establish regulatory or contractual notification deadlines;
- approve production monitoring, logging, identity, provider or custody systems;
- permit an AI agent to declare severity, make a regulatory filing or approve containment;
- replace provider-specific, HSM/MPC, cloud, identity or data-breach runbooks;
- treat green CI, synthetic evidence or a successful development restore as production readiness.

## Activation triggers

An accountable human must open an incident record when there is credible evidence of:

- unauthorized customer or operator access;
- suspected compromise of credentials, secrets, signing material or recovery material;
- unbalanced, duplicated, missing, reordered or unexplained financial effects;
- custody intent, approval, signer or chain-observation mismatch;
- forged, replayed or contradictory bank, provider or blockchain evidence;
- loss or corruption of audit, migration, backup or reconciliation evidence;
- restricted-data disclosure, unauthorized export or unexpected processing location;
- dependency, workflow, artifact or deployment provenance compromise;
- failure of a deny-by-default control or evidence that a disabled command executed;
- production restoration from a stale, partial or unverified state.

An alert alone is not proof of compromise. It is evidence that must be preserved and triaged.

## Severity model

| Severity | Working definition | Initial coordination |
|---|---|---|
| SEV-0 | Confirmed or strongly suspected unauthorized signing, customer-money movement, systemic ledger-integrity loss, Restricted-data exposure or active compromise across trust zones | Incident Commander, Security, CTO, MLRO, Finance, Custody and Legal immediately |
| SEV-1 | Material compromise of production identity, provider evidence, Highly confidential data, reconciliation or recovery integrity without confirmed systemic loss | Incident Commander, Security and affected domain owners immediately |
| SEV-2 | Contained security/control failure with limited scope and no evidence of unauthorized regulated effect | Security and affected service owner; domain escalation based on evidence |
| SEV-3 | Suspicious event, policy drift or failed attack requiring investigation but no confirmed regulated impact | Service owner and Security triage |

Severity is provisional until a named human Incident Commander records it. Uncertainty raises coordination; it does not justify irreversible action.

## Roles and authority

| Role | Responsibility | Cannot do alone |
|---|---|---|
| Incident Commander | Owns timeline, scope, coordination and decision log | Approve financial correction, regulatory filing or custody action |
| Security Lead | Leads containment, compromise assessment and evidence integrity | Decide legal notification or financial finality |
| SRE Lead | Executes approved infrastructure isolation and recovery steps | Restore traffic without evidence and domain approval |
| Financial Core / Finance | Reconciles ledger, bank and provider evidence; defines accounting correction | Rewrite history or use direct balance SQL |
| Custody / Security | Assesses intent, approval, signer and chain evidence | Move assets or rotate production keys without approved ceremony |
| MLRO / Compliance | Assesses AML/KYT, reporting and customer-risk implications | Delegate regulated case decisions to automation |
| Legal / Privacy | Determines contractual, regulator, data-subject and processor notification duties | Infer facts not supported by preserved evidence |
| Communications | Issues approved internal/customer/public messages | Publish technical or regulatory conclusions without approval |
| Scribe / Evidence Custodian | Maintains immutable timeline, manifests and chain of custody | Alter source evidence or copy Restricted data into coordination tools |

One person may hold multiple roles only under an approved staffing and segregation-of-duties policy. Maker-checker requirements remain in force during emergencies.

## Coordination boundary

- Use an approved incident channel and record system with access limited to assigned responders.
- Store references and digests in the coordination record; keep raw Restricted and Highly confidential evidence in approved evidence storage.
- Never paste private keys, mnemonic, signing shares, MFA seeds, credentials, raw KYC documents, full bank details or unredacted provider payloads into chat, tickets or email.
- Record all timestamps in UTC and retain source-system timestamps separately.
- Treat provider statements, screenshots and chat messages as claims until bound to authenticated evidence.
- AI may summarize already-authorized evidence, propose queries and draft communications. A named human must validate every conclusion and approve every regulated action.

## Response lifecycle

### 1. Detect and open

Create an incident identifier and record:

- detection time, reporter and source;
- affected trust zone, environment and suspected threat-model IDs;
- initial indicators and confidence;
- potentially affected data classes, customers, assets, providers and jurisdictions;
- current command, provider, signer and deployment enablement state;
- assigned Incident Commander, Security Lead and Evidence Custodian.

If production state is unknown, assume affected entry points are unsafe until the relevant owner verifies them.

### 2. Preserve

Before destructive remediation, when technically and legally safe:

- preserve append-only audit chain head and export manifest;
- capture ledger, custody, migration and recovery attestations;
- preserve provider request/event identifiers and authenticated callback metadata;
- record artifact, image, workflow, configuration and dependency digests;
- snapshot relevant logs and databases through approved read-only mechanisms;
- hash each evidence object and record source, collector, time and storage reference;
- document clock offsets, missing telemetry and retention risks;
- apply legal hold when directed by Legal/Privacy.

Evidence collection must not expose additional secrets or silently change source state.

### 3. Scope and classify

Answer with explicit evidence or `unknown`:

1. Which identity, workload, provider or dependency initiated the event?
2. Which trust zones and data classes were reachable?
3. Did an accepted command, ledger journal, custody intent, approval or broadcast occur?
4. Can every financial effect be reconstructed and reconciled?
5. Is audit, migration and recovery evidence complete and canonical?
6. Are credentials, signing material or recovery paths still trusted?
7. Which contractual, regulatory and jurisdictional dependencies apply?

Do not lower severity because telemetry is absent.

### 4. Contain

Containment actions require a named executor and approver and must be recorded before or, for a documented emergency, immediately after execution.

| Boundary | Safe containment principle |
|---|---|
| Customer/API | Disable the affected entry point or credential class; preserve accepted-command and idempotency evidence |
| Backoffice/identity | Revoke affected sessions and identities; retain authorization, step-up and role-map evidence |
| Provider/callback | Quarantine new provider evidence; do not convert uncertain status into ledger finality |
| Financial core | Stop new posting through approved controls; never update/delete journals or edit balances directly |
| Custody | Disable affected orchestration/signer path under approved custody authority; never improvise key movement |
| Data/privacy | Restrict access and exports; preserve provenance and legal-hold evidence |
| CI/CD | Block affected artifact/deployment path; preserve workflow, runner and provenance records |
| Recovery | Prevent traffic to a restored target until canonical state and role/catalog attestations pass |

The current repository contains no production command or signer client. This table specifies future approval requirements, not executable controls.

### 5. Eradicate and recover

Recovery requires:

- identified or bounded root cause;
- corrected configuration, code, identity or dependency through reviewed change control;
- rotation/revocation through the approved owner-specific procedure;
- restore into an isolated target when data integrity is in question;
- exact migration history, catalog, runtime-role and canonical-state attestation;
- ledger trial balance and reconciliation against independent external evidence;
- custody intent/approval/outbox and chain-observation reconciliation where applicable;
- security verification that the original access path is closed;
- rollback criteria if any verification fails.

Corrections use reversal or compensating journals. Historical financial and audit evidence is never rewritten.

### 6. Resume

Traffic or regulated processing may resume only when the Incident Commander records approvals from:

- Security for containment and access-path closure;
- SRE for service and recovery integrity;
- Finance for ledger/reconciliation integrity when financial scope exists;
- Custody and Security when custody scope exists;
- MLRO/Compliance when AML/KYT or regulated reporting scope exists;
- Legal/Privacy when data or notification scope exists;
- the accountable product/service owner for customer impact.

Missing evidence or approval is a `NO-GO`.

### 7. Notify

Legal/Privacy and MLRO must determine, from approved jurisdiction and contract evidence:

- regulator, FIU, data-protection authority, bank, provider, insurer or law-enforcement duties;
- customer or data-subject notification duties;
- deadlines and the event that starts each clock;
- required content, approval and delivery evidence;
- preservation, confidentiality and privilege requirements.

The platform must not encode a generic notification deadline before these dependencies are approved. Every notification or decision not to notify requires an immutable evidence reference, accountable approver and timestamp.

### 8. Close and learn

Closure requires:

- final scope and impact statement with confidence and known gaps;
- complete decision/action timeline;
- financial, custody, provider and data reconciliation as applicable;
- notification decisions and delivery evidence;
- root-cause and contributing-control analysis;
- corrective actions with owner, deadline and verification method;
- updated threat IDs, tests, runbooks and monitoring;
- independent review for SEV-0 and SEV-1;
- retained evidence manifest and approved retention/legal-hold state.

## Evidence manifest

Every evidence object must record:

```text
incident_id:
evidence_id:
classification:
source_system:
source_reference:
collector_identity:
collected_at_utc:
source_time_utc:
sha256:
storage_reference:
access_restrictions:
legal_hold:
notes:
```

The manifest contains no secret values or raw customer data.

## Minimum exercise plan

Before production approval, tabletop and recovery exercises must cover:

1. compromised operator session and role-map drift;
2. duplicate/forged provider callback with no direct balance mutation;
3. unexplained ledger/reconciliation mismatch;
4. stale-but-structurally-valid database recovery;
5. suspected custody approval or signer-path compromise;
6. Restricted or Highly confidential data disclosure;
7. compromised CI dependency, workflow or artifact provenance;
8. outage with missing telemetry and uncertain accepted-command state.

Each exercise must produce a timeline, evidence manifest, decision log, unresolved gaps and owners. At least one exercise must use an isolated restore and independent financial reconciliation.

The operational-resilience baseline adds service-specific outage, dependency,
capacity and return-to-normal scenarios. The same exercise may satisfy both
baselines only when its evidence covers both incident authority and complete
business-service recovery.

## Production stop conditions

Production remains prohibited until:

- every role has a named primary and backup;
- D-001, D-002, D-003, D-008, D-011, D-015, D-016, D-017 and D-018 dependencies applicable to the scope are approved;
- notification jurisdictions, contacts and decision authority are documented by Legal/MLRO;
- provider, bank, cloud, identity, signer and data-processor escalation paths are verified;
- evidence storage, access audit, legal hold and retention are approved;
- production containment and credential/key procedures are independently reviewed;
- monitoring maps to the approved threat model and on-call ownership;
- SEV-0/SEV-1 tabletop exercises and a recovery drill complete without unresolved critical findings.

Approval of this baseline confirms only the coordination model. It does not enable production, approve a live runbook, grant emergency execution authority or replace any domain approval.
