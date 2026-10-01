# Regulated Data Lifecycle Baseline — Proposed

- Status: Proposed
- Scope: future regulated-core personal, financial, compliance, security, provider and operational data
- Owners: Legal/Privacy / MLRO / Finance / Security
- Required approvers: Legal/Privacy, MLRO, Finance, Security, CTO, affected data owner
- Production effect: none

## Purpose

This baseline defines how regulated data is classified, created or received, retained, placed on hold, corrected, restricted, exported and disposed of. It converts the open retention questions in the data-classification register into a control model without selecting legal retention periods or authorizing production processing.

The repository contains synthetic fixtures and dev-only evidence. This document does not approve a production data store, processor, location, retention schedule, legacy migration, customer-data deletion workflow or cryptographic-erasure design.

## Principles

1. Every retained data set has an approved purpose, owner, classification, jurisdiction, system of record and lifecycle policy.
2. Collection and retention are minimized; operational convenience is not a legal basis.
3. Missing or ambiguous policy blocks new production collection, migration and automated disposal.
4. Legal hold, dispute, AML, accounting and security obligations override ordinary disposal only within approved scope.
5. Deletion from a primary table is not complete while recoverable copies remain in replicas, indexes, queues, caches, exports, backups or processors.
6. Immutable financial, audit and custody records are corrected through linked evidence, not rewritten or silently erased.
7. Lower environments use synthetic or explicitly approved masked data and never receive raw production clones.
8. Lifecycle actions require authenticated actors, authorization, immutable evidence and reconciliation.
9. A passing job or expired timestamp is not authority to erase regulated data.
10. AI may summarize approved evidence but cannot decide legal basis, hold scope, retention or final disposal.

## Non-goals

This baseline does not:

- define legal advice or fixed retention durations;
- authorize collection of KYC, biometric, bank, wallet, device or provider data;
- make the legacy database a regulated system of record;
- permit deletion of journals, audit events, custody approvals or incident evidence to satisfy a generic customer request;
- allow unrestricted exports, raw production test data or developer access;
- approve a processor, subprocessor, country, encryption key or backup service;
- permit operators, services or agents to place or release holds without approved authority;
- replace incident response, financial reconciliation, audit integrity or release authorization.

## Lifecycle states

Each governed record or immutable evidence reference must be in one explicit lifecycle state:

| State | Meaning | Allowed transition authority |
|---|---|---|
| Collected | Accepted for an approved purpose with provenance | Approved source and schema |
| Active | Required for the current customer, product, case or operational purpose | Data owner policy |
| Restricted | Preserved but excluded from ordinary processing or access | Legal/Privacy, MLRO, Security or Finance as applicable |
| Held | Ordinary disposal suspended for a named matter and scope | Approved hold authority |
| Retention due | Ordinary purpose ended and policy evaluation is required | Lifecycle service; no deletion authority |
| Disposal approved | Exact objects, copies and method have human-approved authority | Required domain approvers |
| Disposed | Approved method completed and independently verified | Authorized executor plus verifier |
| Exception | Reconciliation, processor, backup or evidence gap prevents completion | Named owner and deadline |

Transitions are append-only evidence. A record cannot skip from `Active` to `Disposed`, and unknown state fails closed.

## Lifecycle policy record

Every production data category requires a versioned policy containing:

```text
policy_id:
policy_version:
data_category:
data_classification:
system_of_record:
business_purpose:
legal_basis_reference:
jurisdictions:
data_owner:
security_owner:
processors:
retention_trigger:
retention_rule_reference:
hold_eligibility:
correction_method:
disposal_method:
backup_disposition:
verification_method:
approved_by:
approved_at_utc:
effective_at_utc:
supersedes:
```

The policy stores references, not secret values or customer data. Approval applies only to the named category, purpose, jurisdictions, systems and processors.

## Retention schedule

Legal/Privacy, MLRO, Finance, Security and the affected data owner must approve the schedule. It must define a trigger and rule, not only a duration.

| Data category | Trigger examples | Required owner input |
|---|---|---|
| Identity and contact | Relationship closure or superseded attribute | Legal/Privacy + Product |
| KYC and biometric evidence | Verification decision, relationship closure or legal event | Legal/Privacy + MLRO |
| AML/KYT alerts and cases | Case closure, filing or investigation event | MLRO + Legal |
| Financial journals and reconciliation | Posting, settlement, dispute or reporting period | Finance + Legal |
| Bank/provider evidence | Settlement, dispute or contract event | Finance + Legal/Privacy |
| Custody intent and approval evidence | Intent closure, observation or dispute | Custody + Security + Legal |
| Regulated audit evidence | Event acceptance, incident or release reference | Security + Legal/Privacy + MLRO |
| Sessions, devices and security telemetry | Session expiry or security event | Security + Legal/Privacy |
| Support and communications | Case closure or complaint event | Operations + Legal/Privacy |
| Backups and exports | Creation plus source-policy dependency | SRE + Security + data owner |

No duration is inferred from source-code defaults, provider settings, legacy jobs or this document. Policy changes are versioned and prospective unless Legal explicitly approves a different treatment.

## Collection and provenance

Before production collection or import:

- classify every field and prove it is necessary for the approved purpose;
- identify source, subject, processor, jurisdiction, consent or legal-basis reference where applicable;
- validate schema, authenticity, release identity and evidence digest;
- reject prohibited secrets, signing material and unnecessary raw provider payloads;
- define correction, restriction, hold and disposal behavior before accepting records;
- bind derived data to source references, policy version and derivation purpose;
- prevent optional analytics or support collection from becoming an undeclared system of record.

Legacy data is an untrusted migration input until mapping, provenance, legal basis, retention and reconciliation are approved.

## Legal hold and preservation

A hold record must contain:

```text
hold_id:
matter_reference:
authority:
scope:
systems:
subjects_or_resources:
data_categories:
reason_code:
placed_by:
approved_by:
placed_at_utc:
review_at_utc:
released_by:
released_at_utc:
```

- Hold scope is explicit and minimal; it cannot silently preserve unrelated tenants, products or data classes.
- Placement, change, conflict, failed enforcement and release are immutable audit events.
- Hold state is propagated to systems of record, exports, archives and processors with reconciliation evidence.
- Release requires named human authority and never triggers immediate deletion without a fresh disposal evaluation.
- A service, operator or AI cannot release its own preservation obligation.
- If hold enforcement cannot be proved, disposal stops and an incident is raised.

## Correction, restriction and subject requests

- Identity/profile data may use versioned correction where approved.
- Financial journals use reversal or compensating entries; accepted history is not overwritten.
- Audit and custody evidence uses linked correction or supersession events without changing prior content.
- Provider claims remain attributed to the provider and are reconciled rather than silently normalized.
- Requests for access, correction, restriction, portability or deletion are authenticated, scoped, authorized and audited.
- The response distinguishes completed action, lawful exception, immutable record and processor dependency.
- Customer-facing status must not claim completion until all required systems and processors are reconciled.

## Disposal execution

An approved disposal batch must bind:

```text
disposal_id:
policy_id:
policy_version:
scope_manifest_digest:
hold_check_reference:
authorization_reference:
systems_and_processors:
method:
executor:
independent_verifier:
started_at_utc:
completed_at_utc:
exceptions:
evidence_manifest_reference:
```

Execution requirements:

1. produce an immutable candidate manifest without exposing prohibited fields;
2. evaluate active holds, disputes, incidents, AML, accounting and contractual dependencies;
3. require policy-bound authorization for the exact manifest digest;
4. delete or irreversibly transform only the approved scope;
5. reconcile primary stores, search indexes, replicas, queues, caches, object storage and processors;
6. record exceptions with owner, reason and deadline;
7. verify the result independently and retain minimal non-sensitive proof;
8. prevent retries from expanding scope or deleting a changed object under stale approval.

Bulk SQL, mutable file lists, manual production-host deletion and unreviewed provider-console actions are prohibited.

## Backups, replicas and derived copies

- Backup retention is a separate approved schedule bound to D-017.
- A primary-store deletion does not rewrite immutable backups by default; the approved design must define expiry, restore-time suppression and hold behavior.
- Restoring an older backup must not resurrect disposed data into active processing. A restore reconciliation applies current lifecycle policy before traffic resumes.
- Read replicas, analytics stores, indexes, caches, queues and materialized views inherit the source classification and policy.
- Derived scores, embeddings, summaries and pseudonymous identifiers remain governed when they can identify, single out or affect a person.
- Cryptographic erasure requires approved key isolation, scope, recovery impact and independently verifiable evidence; deleting a shared key is not an acceptable shortcut.

## Processor and location controls

- The processor register identifies purpose, data categories, locations, subprocessors, access model, retention behavior, deletion API/SLA and evidence supplied.
- A processor cannot retain a broader copy or longer period merely because its platform default allows it.
- Processor deletion acknowledgements are external claims until authenticated and reconciled.
- Contract termination includes export, migration, hold, deletion and evidence obligations.
- Unknown location, subprocessor, retention or deletion capability blocks production onboarding or expansion.
- Cross-border transfer mechanisms and regulator/customer notifications require Legal approval.

## Access and segregation of duties

Separate capabilities are required for:

- policy authoring;
- policy approval;
- hold placement and release;
- candidate-manifest generation;
- disposal authorization;
- disposal execution;
- verification and reconciliation;
- exception administration;
- evidence access and export.

No single identity may author policy, approve a disposal batch, execute it and verify completion. Break-glass access is time-bound, independently approved and cannot bypass hold checks or evidence generation.

## Evidence and monitoring

Lifecycle evidence must record actor, policy version, authorization, scope digest, affected systems, outcome, exception and correlation identifiers without copying unnecessary personal data.

Alert on:

- unclassified or purpose-less production data;
- records past policy evaluation without approved action;
- disposal attempted under active or unknown hold state;
- policy, clock, role or processor drift;
- reconciliation differences across primary, derived, backup and processor copies;
- repeated deletion failures, unexpected resurrection or expanded batch scope;
- unauthorized export, hold or lifecycle administration;
- missing evidence between approved manifest and verified outcome.

Automated alerts may restrict further lifecycle execution but cannot release holds, erase evidence or decide legal exceptions.

## Recovery and migration

A recovered or migrated store cannot become authoritative until:

- schema, policy versions, classifications, holds and lifecycle states are restored;
- disposed data has not re-entered active processing;
- candidate manifests and completion evidence reconcile with the approved recovery point;
- processor, export and backup exceptions are identified;
- financial, audit and custody immutable-history rules remain intact;
- Legal/Privacy, Security and the affected data owner approve unresolved exceptions.

Missing lifecycle metadata is a `NO-GO`, not permission to keep everything indefinitely or delete it immediately.

## AI boundary

AI may classify proposed fields, summarize policy evidence, identify likely orphan copies and draft candidate manifests for human review.

AI must not:

- determine legal basis or retention duration;
- place or release a legal hold;
- approve or execute disposal;
- decide that an immutable record may be erased;
- receive unrestricted production data to discover lifecycle scope;
- claim processor or system completion without deterministic evidence.

AI access and output are governed, minimized and audited like any other service.

## Minimum misuse-case tests

Before production approval, evidence must prove:

1. unknown classification, policy or lifecycle state fails closed;
2. active, conflicting or unreachable hold state blocks disposal;
3. a changed scope manifest invalidates prior approval;
4. maker cannot approve, execute and verify the same disposal;
5. retries cannot delete newly changed or out-of-scope records;
6. primary deletion is reconciled across indexes, caches, queues, exports and processors;
7. backup restore does not reactivate disposed data;
8. financial, audit and custody immutable records use approved correction semantics;
9. processor failure produces an exception rather than false completion;
10. lower environments reject raw production data;
11. policy and role drift are detected before execution;
12. evidence proves outcome without retaining the disposed payload.

## Production stop conditions

Production collection, migration and automated disposal remain prohibited until:

- data categories, purposes, legal bases, owners, processors and locations are approved;
- a versioned retention schedule and trigger exist for every production category;
- hold placement, propagation, conflict and release procedures are approved and tested;
- subject-request, correction, restriction and lawful-exception workflows are approved;
- backup, restore, replica, index, cache, queue, export and processor behavior is defined;
- segregation of duties, step-up, break-glass and immutable lifecycle evidence are implemented;
- disposal methods and independent verification are tested with representative synthetic data;
- D-001 through D-018 dependencies applicable to the scope are approved;
- critical/high privacy, security, financial, custody and recovery findings are resolved.

Approval of this baseline confirms only the proposed lifecycle control model. It does not authorize production data processing, select retention periods, approve processors or locations, migrate legacy/customer data, erase regulated evidence or launch the platform.
