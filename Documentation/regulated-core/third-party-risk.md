# Third-Party and Outsourcing Risk Baseline — Proposed

- Status: Proposed
- Scope: regulated-core vendors, processors, providers and outsourced services
- Owners: Procurement / Security / Legal / Compliance / domain owners
- Required approvers: CTO, Security, Legal/Privacy, MLRO and the accountable domain owner
- Production effect: none

## Purpose

This baseline defines how SolidChange must assess, approve, monitor and exit a
third party whose service can affect regulated data, customer access, financial
truth, custody, compliance decisions, recovery or software delivery.

It does not select a vendor, approve an outsourcing arrangement, authorize a
production integration, accept a data location, create provider credentials or
satisfy any open item in D-001 through D-018. Repository adapters, sandbox
access, a completed scorecard and green CI are not production approval.

## Objectives

1. Identify every external dependency and its accountable internal owner.
2. Apply diligence proportional to data, authority, substitutability and outage
   impact.
3. Prevent a provider response from becoming independent financial, custody or
   regulated decision authority.
4. Bind onboarding and material changes to written legal, security, privacy,
   compliance, finance and operational evidence.
5. Detect concentration, subcontractor and location changes before they create
   an unapproved trust path.
6. Preserve reconciliation, incident, recovery and exit evidence independently
   of the provider.
7. Fail closed when required evidence, approval, authentication or service
   integrity is missing.

## Covered third parties

The register must include, when applicable:

- banks, payment rails and settlement partners;
- card issuers, BIN sponsors, processors and tokenization services;
- liquidity venues, brokers and treasury counterparties;
- KYC, KYB, sanctions, PEP, adverse-media and KYT providers;
- custody, signer, HSM/MPC and blockchain infrastructure providers;
- cloud, database, observability, security, identity and communications
  services;
- source-control, CI/CD, artifact, dependency and support services;
- professional services with access to systems, evidence or regulated data;
- subprocessors and material fourth parties used by any of the above.

Open-source software is governed through supply-chain controls, but a hosted or
support relationship using that software is also a third-party relationship.

## Criticality and inherent risk

Every relationship requires a documented classification before technical
onboarding.

| Dimension | Questions |
|---|---|
| Authority | Can the service influence identity, eligibility, financial finality, custody, release or recovery? |
| Data | Which classification, purpose, jurisdiction and retention duties apply? |
| Access | Does the party receive interactive, API, support or infrastructure access? |
| Availability | What customer or control function stops when the service is unavailable? |
| Integrity | Can forged, delayed, replayed or contradictory output create an incorrect regulated effect? |
| Substitutability | Can the service be replaced or operated safely without provider cooperation? |
| Concentration | Which other critical services share the same provider, region, identity plane or fourth party? |
| Recovery | What independent records are required to reconcile, restore and exit? |

### Critical relationships

A relationship is critical when failure, compromise or disorderly exit could
materially affect:

- customer-money availability or financial reconciliation;
- private-key protection, signing policy or custody recovery;
- customer or workforce authentication;
- AML/KYC/KYT controls or regulated reporting evidence;
- Restricted data confidentiality, location or lawful processing;
- production release, backup, recovery or incident response;
- a legal or regulatory obligation that cannot be met by a safe manual mode.

Critical classification cannot be reduced only because the service is
described as a subcontractor, SaaS, cloud-native or industry standard.

## Lifecycle

### 1. Intake and ownership

Before diligence begins, record:

- service, legal entity and contracting entity;
- accountable business and technical owners;
- proposed purpose, trust-zone connection and environments;
- affected decision-register items and threat-model IDs;
- data classes, locations, users, credentials and network paths;
- expected transaction, evidence and support flows;
- preliminary criticality, concentration and exit assumptions.

An ownerless dependency is not eligible for onboarding.

### 2. Due diligence

The owner must populate the applicable
[vendor scorecard](vendor-scorecards.md) with evidence rather than unsupported
answers. Critical relationships require review of:

- legal eligibility, licensing scope and contractual authority;
- security architecture, independent assurance and remediation status;
- identity, privileged access, credential lifecycle and support access;
- data processing purpose, residency, subprocessors, retention and disposal;
- availability history, capacity, recovery objectives and tested continuity;
- API authentication, callback integrity, replay behavior and version policy;
- reconciliation, correction, dispute and evidence-export capabilities;
- incident detection, notification, cooperation and evidence preservation;
- financial condition, insurance or other counterparty-risk evidence when
  applicable;
- termination rights, transition support, data return and verified deletion.

Missing evidence is recorded as an open risk, not scored as implicitly
acceptable.

### 3. Risk decision and approval

The decision record must state:

- inherent and residual risk;
- mandatory-gate result and weighted score;
- exceptions, compensating controls, owner and expiry;
- approved service, data, geography, environment and access scope;
- prohibited uses and deny-by-default behavior;
- review frequency and material-change triggers;
- required approvers and immutable approval references.

Procurement or a domain owner cannot alone approve a critical relationship.
Legal/Privacy, Security, MLRO, Finance, Custody or SRE approval is required when
their boundary is affected. A score does not override a failed mandatory gate.

### 4. Contract and control requirements

The contract and supporting schedules must address, as applicable:

- exact service and approved processing purpose;
- confidentiality, data location, subprocessors and cross-border changes;
- security controls, vulnerability handling and access restrictions;
- incident and breach notification without inventing repository-level
  deadlines;
- availability, recovery, support and escalation obligations;
- records, audit rights, evidence export and regulatory cooperation;
- reconciliation, corrections, disputes, reversals and settlement evidence;
- business-continuity tests and orderly exit assistance;
- data return, retention, legal hold and verified disposal;
- material-change notice and approval;
- liability, indemnity, insurance and termination rights.

Contract signature does not by itself authorize credentials, traffic, data or
money movement.

### 5. Technical onboarding

Technical enablement requires:

- approved architecture and data-flow diagrams;
- provider-specific authentication and credential ownership;
- isolated sandbox evidence before any production path;
- least-privilege workload identity and separately controlled human support
  access;
- callback signature, freshness, replay and idempotency verification;
- timeouts, bounded retry, circuit behavior and safe outage mode;
- immutable request, response, correlation and reconciliation references;
- monitoring, alert ownership and provider-status escalation;
- tested credential rotation and revocation;
- explicit feature flag or equivalent deny-by-default enablement;
- release authorization bound to the approved vendor scope.

Provider callbacks and status pages are evidence inputs. They cannot directly
post a balance, rewrite a ledger, authorize signing, close an AML case or prove
settlement finality.

### 6. Ongoing monitoring

The accountable owner must review:

- assurance reports, penetration findings and remediation commitments;
- incidents, SLA performance, maintenance and support escalation;
- financial, licensing, ownership and geographic changes;
- subprocessor, fourth-party, region and data-flow changes;
- API, authentication, certificate and deprecation changes;
- privilege, credential, support-access and evidence-export records;
- reconciliation breaks, disputed events and unexplained corrections;
- concentration and correlated-failure exposure;
- open exceptions, control expiry and exit readiness.

Critical relationships require a defined review cadence. Material changes
trigger review before adoption; silence or click-through terms are not
approval.

### 7. Incident coordination

A provider incident follows the
[incident-response baseline](incident-response.md). SolidChange must preserve
its own evidence and record:

- provider incident reference and authenticated communications;
- affected service, region, subprocessor, data and time range;
- accepted commands, callbacks, statements and reconciliation state;
- credential, access and configuration changes;
- containment and failover decisions with human approvals;
- unresolved facts and confidence level.

A provider claim cannot replace internal ledger, custody, identity, audit or
recovery evidence. Automated failover cannot weaken approved geography,
identity, data or reconciliation controls.

### 8. Exit and substitution

Every critical relationship requires an exit plan before production use:

- exit triggers and accountable authority;
- safe service-disablement and traffic-removal sequence;
- credential, certificate, account and support-access revocation;
- data and evidence export in an independently usable form;
- reconciliation of in-flight, disputed and final records;
- legal hold, retention and verified disposal obligations;
- migration validation without unsafe dual write;
- customer, regulator and counterparty communication dependencies;
- residual access and subprocessor confirmation;
- post-exit monitoring and evidence retention.

No provider may be the sole holder of evidence needed to prove customer money,
custody state, compliance decisions or lawful disposal.

## Domain invariants

### Financial and payment providers

- Provider balances, statements and callbacks are independently reconciled.
- External status never directly mutates ledger truth.
- Returns, reversals, fees, reserves and disputes have typed evidence.
- Missing or contradictory finality blocks dependent financial completion.

### KYC, KYT and compliance providers

- Provider output is evidence for an approved human or policy decision, not
  unreviewable authority.
- Model, list, rule, coverage and confidence changes are versioned.
- Manual review, outage and evidence-export paths are defined.
- AI cannot make the final regulated decision under D-012.

### Custody and signing providers

- D-002 and D-003 remain open until separately approved.
- Key ownership, quorum, ceremony, attestation, recovery, destruction and
  signer-side policy are independently reviewed.
- General application systems never receive key material.
- Provider selection does not authorize signing or broadcast.

### Cloud, identity and delivery providers

- Regions, workload identities, privileged access and recovery paths match the
  approved architecture.
- CI and support channels have no long-lived unrestricted production
  authority.
- Artifact provenance and release approval remain independently verifiable.
- A provider super-admin role cannot collapse application, database, identity,
  custody and release segregation of duties.

## Evidence record

Each relationship must retain immutable references to:

```text
third_party_id:
legal_entity:
service:
criticality:
internal_owner:
technical_owner:
approved_scope:
prohibited_scope:
data_classes:
locations:
subprocessors:
trust_zones:
decision_dependencies:
threat_ids:
scorecard_version:
contract_reference:
security_review:
privacy_review:
compliance_review:
domain_approvals:
exceptions:
review_due_at_utc:
exit_plan_reference:
status:
```

Evidence stores must not contain secret values, private keys, raw customer
documents or unredacted provider payloads merely to prove that a review
occurred.

## Minimum misuse-case tests

Before a production integration is approved, evidence must show that:

1. missing, invalid, expired or rotated provider credentials fail closed;
2. forged, replayed, stale and out-of-order callbacks create no duplicate
   regulated effect;
3. provider outage and timeout do not silently become success;
4. contradictory provider and internal states enter reconciliation or review;
5. a provider cannot post balances or authorize custody directly;
6. support access is attributable, time-bound, least-privilege and revocable;
7. unapproved region, subprocessor or endpoint configuration is rejected;
8. evidence export remains usable without live provider access;
9. credential revocation and service disablement stop new traffic;
10. exit or failover preserves exact financial, custody and audit continuity.

## AI boundary

AI may summarize approved diligence evidence, identify apparent gaps and draft
scorecards, review notes or monitoring findings.

AI cannot select or approve a vendor; accept an exception; authorize a
contract, credential, data transfer, production connection or failover; waive
reconciliation; make a regulated decision; or approve its own provider or
service identity.

## Approval dependencies

Production use remains blocked until:

- applicable D-001 through D-018 decisions are approved;
- the provider-specific scorecard and mandatory gates pass;
- legal scope, contract and data-processing terms are approved;
- Security and Privacy approve architecture, access, location and processors;
- the accountable domain approves operational, evidence and outage semantics;
- Finance approves settlement and reconciliation where money is affected;
- MLRO approves KYC/KYT and regulated decision boundaries;
- Custody and Security approve any signer or HSM/MPC relationship;
- SRE approves monitoring, recovery, capacity and exit evidence;
- release authorization binds the exact approved service and configuration.

## Production stop conditions

The relationship is `NO-GO` when:

- ownership, legal entity, service scope or criticality is unknown;
- a mandatory gate fails or evidence cannot be independently verified;
- data purpose, location, retention or subprocessors are unapproved;
- credentials, support access or privileged roles are shared or unbounded;
- callbacks, reconciliation, outage or correction semantics fail open;
- a provider can directly create financial finality, custody authority or a
  final regulated decision;
- critical concentration or fourth-party exposure has no accepted treatment;
- material changes can occur without detection and review;
- incident cooperation, evidence export, recovery or exit is not credible;
- an exception is ownerless, expired or lacks compensating controls;
- required human approvals are missing.

Approval of this baseline defines the review process only. It does not approve
any provider, production integration, customer-data transfer, money movement,
custody signing, broadcast or production launch.
