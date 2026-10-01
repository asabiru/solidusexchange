# Regulated Audit Evidence Baseline — Proposed

- Status: Proposed
- Scope: future regulated-core security, operator, financial, provider and custody evidence
- Owners: Security / Compliance / SRE
- Required approvers: CTO, Security, MLRO, Legal/Privacy, Finance
- Production effect: none

## Purpose

This baseline defines the evidence required to reconstruct who or what requested, authorized, executed, observed and reviewed a regulated action. Audit evidence is a security and accountability record; it is not a substitute for ledger truth, provider reconciliation, custody policy or legal approval.

The repository currently contains synthetic audit and signed-read controls. This document does not approve a production audit store, retention period, signing key, data processor, operator command plane or customer-money execution.

## Objectives

1. Bind every accepted regulated request to actor, authorization, policy, approval, idempotency and correlation evidence.
2. Preserve ordered append-only evidence without storing secrets or unnecessary customer data.
3. Distinguish a request, decision, attempted action, accepted effect and later observation.
4. Detect deletion, reordering, duplication, mutation and recovery from stale evidence.
5. Make access, search, export, retention and legal hold independently auditable.
6. Support incident, Finance, MLRO, Legal and Security review without granting execution authority.
7. Keep source-system evidence and cross-system claims separate until reconciled.
8. Fail closed when required evidence cannot be durably accepted.

## Non-goals

This baseline does not:

- authorize financial posting, provider commands, custody signing, broadcast or account restriction;
- make application logs or analytics events authoritative audit evidence;
- define production retention or notification deadlines before Legal/MLRO approval;
- require customer PII, secrets, tokens, private keys, signatures or raw provider payloads in audit records;
- permit mutable corrections to ledger, custody or audit history;
- allow AI to approve regulated actions, classify final impact or close an incident;
- treat hash chaining alone as proof that an actor genuinely performed an action.

## Evidence layers

| Layer | Purpose | Authority |
|---|---|---|
| Operational logs | Debugging, health and performance | Non-authoritative; may be sampled or rotated |
| Security telemetry | Detection and investigation signals | Evidence input; not business finality |
| Regulated audit events | Actor, authorization, decision and state-transition evidence | Append-only accountability record |
| Financial ledger | Monetary accounting truth | Authoritative for booked financial effects |
| Custody evidence | Intent, policy, approval, signer and chain observations | Authoritative only within approved custody boundary |
| Provider evidence | Authenticated request/callback/poll observations | External claim pending reconciliation |
| Evidence manifest/export | Verifiable collection for review, incident or legal hold | Reference and integrity layer |

An event may reference another layer by immutable identifier and digest. It must not copy restricted raw payloads merely for convenience.

## Actor model

Every audit event has exactly one initiating actor and may name additional accountable participants.

| Actor type | Required identity evidence |
|---|---|
| Customer | Stable internal subject reference, authenticated session reference, assurance level |
| Operator | Workforce identity, server-side role/capability set, session and step-up references |
| Service/workload | Workload identity, service name, environment, release/artifact digest |
| Provider | Provider account/endpoint reference plus authenticated message or observation reference |
| Automated policy | Policy name/version/digest and the human-approved authority under which it runs |
| Break-glass identity | Named human, reason, incident/change reference, approver and expiry |

Shared user identities and anonymous production administrator actions are prohibited. A scheduler, queue or retry worker carries the original actor and causation references; it does not replace them.

## Canonical event envelope

Every regulated audit event must use a versioned schema containing:

```text
event_id:
schema_version:
event_type:
occurred_at_utc:
recorded_at_utc:
source_system:
source_environment:
source_release_digest:
actor_type:
actor_id:
actor_session_reference:
actor_assurance_level:
on_behalf_of_actor_id:
request_id:
correlation_id:
causation_id:
idempotency_key_digest:
resource_type:
resource_id:
action:
outcome:
reason_code:
policy_reference:
authorization_reference:
approval_references:
state_transition:
evidence_references:
data_classification:
previous_event_hash:
event_hash:
```

Optional fields are omitted, not populated with ambiguous empty values. Unknown required evidence blocks the regulated command rather than producing an incomplete success event.

## Identifier and time rules

- Event, request and correlation identifiers are globally unique and non-secret.
- Retries reuse the accepted idempotency/correlation evidence and create distinct attempt events when materially observable.
- `occurred_at_utc` is the source's claimed event time; `recorded_at_utc` is the audit store acceptance time.
- Provider, customer-device and blockchain timestamps are claims, not trusted platform time.
- Clock source, synchronization status and known offset are retained as separate system evidence.
- Time ordering never replaces causation ordering for distributed actions.
- An event received late is appended with its original source time and a late-arrival reason; history is not backdated.

## Event semantics

The event type and outcome must distinguish at least:

```text
request.received
authentication.succeeded | authentication.failed
authorization.allowed | authorization.denied
approval.requested | approval.granted | approval.rejected | approval.expired
command.accepted | command.rejected | command.conflicted
state.transitioned
provider.requested | provider.observed | provider.reconciled
ledger.journal.accepted | ledger.journal.reversed
custody.intent.created | custody.approval.recorded | custody.observation.recorded
session.created | session.revoked | session.expired
role.mapping.changed
evidence.accessed | evidence.exported | evidence.held | evidence.released
configuration.changed | release.deployed | feature.changed
recovery.started | recovery.verified | recovery.rejected
```

`requested`, `accepted`, `executed`, `observed`, `reconciled` and `reversed` are not interchangeable. A provider callback cannot emit a ledger-finality event, and a UI success response cannot assert provider or blockchain finality.

## Authorization and approval evidence

For a protected operation, the event chain must identify:

- authorization policy and version/digest;
- evaluated role, capability, customer/product eligibility, limits and risk references;
- allow/deny decision with stable reason code;
- maker and checker identities where required;
- step-up method/reference and expiry;
- scope bound to the approval: resource, amount/asset, provider, destination class and validity window as applicable;
- the exact command or intent digest approved;
- conflict, replay and expiry outcomes.

An approver cannot approve a different digest, expanded scope or changed destination through an inherited reference. Self-approval is rejected where segregation of duties applies.

## Integrity and ordering

Within each approved audit partition:

1. canonicalize the event envelope using a versioned deterministic encoding;
2. compute `event_hash` over the canonical event with `event_hash` omitted and `previous_event_hash` populated;
3. commit the event and chain head atomically;
4. reject a duplicate `event_id` with different content;
5. make chain-head and partition metadata independently attestable;
6. periodically seal checkpoints through an approved key and independent storage boundary;
7. verify continuity during export, backup, restore and recovery.

Partitioning must have an explicit key and ordering rule. It cannot silently allow two writers to create conflicting heads. Cryptographic design, key custody and checkpoint frequency require Security/Custody review and are not selected by this document.

Hash chaining detects mutation only when trusted chain heads/checkpoints are retained independently. Database owner access, backup administration and audit verification therefore require separate identities and monitored access.

## Storage and privilege boundary

The future audit store must:

- accept append-only events through a narrow authenticated writer interface;
- deny application roles `UPDATE`, `DELETE`, `TRUNCATE`, trigger disabling and chain-head rewrites;
- separate writer, reader, exporter, verifier, retention and administrator capabilities;
- prevent a service from granting itself reader/exporter or administrator privileges;
- encrypt data in transit and at rest under approved key ownership;
- keep production data and keys out of CI, pull requests and development environments;
- audit every privileged query, export, hold, retention and administration action;
- provide isolated recovery verification before any restored store becomes authoritative.

Database superuser or infrastructure administrator activity remains a monitored residual risk and requires approved break-glass control.

## Data minimization

Audit records store references and stable classifications, not:

- passwords, session cookies, bearer tokens, API credentials or MFA seeds;
- private keys, mnemonic phrases, signing shares or raw signed transactions;
- full KYC documents, biometrics, bank details, addresses or customer messages;
- full provider payloads when an authenticated digest/reference is sufficient;
- unrestricted wallet addresses or device/network data without approved purpose.

Where a value is required for correlation but sensitive, use a domain-separated digest or token generated under an approved policy. A plain unsalted digest of a low-entropy identifier may still be personal data and is not automatically safe.

## Access, search and export

- Reads require purpose, case/incident/change reference and server-side authorization.
- Searches use minimum necessary fields and are recorded with requester, scope and result count.
- Restricted evidence requires additional approval and step-up as defined by the data owner.
- Exports are immutable manifests containing query scope, event range, chain heads, object digests, classification, exporter, approver, destination and expiry.
- Export storage is access-controlled, encrypted, time-bound and subject to the same retention/legal-hold rules.
- Download, forwarding and failed access attempts are auditable.
- Bulk browsing and unrestricted operator search are production stop conditions.

An audit viewer never provides direct mutation, financial command, custody command or provider-execution capability.

## Retention, hold and disposal

Legal/Privacy, MLRO, Finance and Security must approve a retention schedule by data class, event type, jurisdiction and contractual dependency. Until approved:

- no production retention period is assumed;
- automatic deletion of regulated evidence is prohibited;
- legal hold overrides scheduled disposal;
- hold placement and release require named human authority and immutable evidence;
- disposal requires scope, method, executor, approver and verification records;
- deleting an encryption key is not accepted as disposal without Legal/Security approval and evidence.

Retention changes apply prospectively through reviewed policy. They never rewrite prior event content.

## Recovery and reconciliation

A recovered audit store is not authoritative until:

- migration history, schema, constraints, privileges and chain policy match the approved catalog;
- all retained partitions verify from trusted checkpoint to chain head;
- canonical event counts/digests and cross-system references match the approved recovery point;
- stale, partial, reordered and duplicate evidence is rejected;
- ledger, custody, identity, provider and release references are reconciled where applicable;
- unrelated target state is preserved or explicitly handled by an approved recovery plan;
- Security and the affected domain owner approve the recovery evidence.

Missing audit evidence does not permit a regulated effect to be inferred. It raises an incident and reconciliation requirement.

## Monitoring

Alert on:

- chain, checkpoint, signature or canonicalization verification failure;
- rejected append, duplicate conflict or unexplained sequence gap;
- writer, reader, exporter or administrator privilege drift;
- audit pipeline lag, unavailable storage or retention risk;
- unauthorized search, bulk access or export;
- missing required event between accepted command and domain effect;
- actor, policy, approval, release or environment mismatch;
- restore from a stale or unverified chain head;
- clock drift that affects approval, expiry or incident interpretation.

Alerts are evidence inputs. Automated response must not move money, sign, broadcast, close AML cases or erase evidence.

## AI boundary

AI may:

- summarize events already authorized for its service identity;
- identify missing links, unusual patterns or reconciliation candidates;
- draft incident timelines, case notes and evidence manifests;
- propose queries that a human authorizes.

AI must not:

- receive unrestricted audit-store access by default;
- infer approval from conversation or event proximity;
- alter classifications, events, chain heads, holds or retention;
- approve/reject regulated commands or close regulated cases;
- present probabilistic findings as authoritative facts.

Every AI access and export is audited like any other service access and bound to an approved purpose.
Capability identity, human control, tool evidence, evaluation, release and
withdrawal requirements are defined in the proposed
[AI-governance baseline](ai-governance.md).

## Minimum misuse-case tests

Before production approval, evidence must prove:

1. same `event_id` with changed content fails closed;
2. deleted, mutated, reordered or inserted events break continuity;
3. concurrent writers cannot fork an accepted chain head;
4. required audit failure blocks the regulated command before domain effect;
5. retry/idempotency evidence distinguishes duplicate replay from conflict;
6. maker cannot satisfy checker evidence;
7. unprivileged roles cannot mutate events, chain metadata or retention state;
8. unauthorized search/export and privilege drift are detected;
9. backup/restore rejects stale and partial evidence while preserving canonical state;
10. an export verifies independently without exposing prohibited fields;
11. clock drift and late arrival do not rewrite prior ordering;
12. break-glass access expires and produces independently reviewable evidence.

## Production stop conditions

Production remains prohibited until:

- event schema, canonicalization, partitioning and chain/checkpoint design are approved;
- production identity, authorization, step-up and segregation-of-duties controls exist;
- writer/reader/exporter/verifier/admin roles are independently reviewed and tested;
- trusted clock, release identity and configuration references are available;
- retention, legal hold, disposal, data location and processor decisions are approved;
- evidence storage, checkpoint key custody, backup encryption and recovery targets are approved;
- monitoring, on-call, incident response and independent export verification are exercised;
- applicable D-001 through D-018 decisions and domain gates are approved;
- critical/high threat-model and misuse-case findings are resolved.

Approval of this baseline confirms only the audit-evidence design. It does not authorize a production audit store, operator command plane, customer data migration, financial execution, provider access, custody signing, broadcast or launch.
