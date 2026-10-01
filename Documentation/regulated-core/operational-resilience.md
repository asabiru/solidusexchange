# Regulated Operational Resilience Baseline — Proposed

- Status: Proposed
- Scope: future regulated-core business services and supporting technology
- Owners: SRE / Security / accountable business-service owners
- Required approvers: CTO, Security, Finance, MLRO/Compliance, Legal/Privacy, affected domain owners
- Production effect: none

## Purpose

This baseline defines how SolidChange must identify important business services,
set human-approved resilience objectives, control degraded operation and prove
that regulated processing can be recovered without losing financial, custody,
audit or compliance integrity.

It is not a production continuity plan, disaster-recovery runbook, service-level
commitment or approval to provision infrastructure. Exact topology, regions,
capacity, monitoring, backup retention, RPO/RTO, providers, contact paths and
recovery commands remain blocked by D-008, D-015, D-017, D-018 and the affected
domain approvals.

## Principles

1. Resilience protects the complete business service, not only server uptime.
2. Safety, financial truth and evidence integrity take priority over availability.
3. Missing, stale or contradictory state fails closed; it does not become finality.
4. Degraded mode must be designed and approved before an outage, not improvised.
5. A successful backup, failover or health check is not proof of business recovery.
6. Recovery is complete only after independent state, authorization and reconciliation checks.
7. Dependencies, subprocessors and manual operations are part of the service boundary.
8. Capacity and recovery assumptions require measured evidence and expiry dates.
9. A named human owns every resilience objective, exception and resume decision.
10. AI may assist analysis but cannot authorize failover, restoration or regulated processing.

## Non-goals

This document does not:

- define customer or regulator service commitments;
- approve active-active, multi-region, cloud, database or custody topology;
- set generic RPO, RTO, SLO or impact-tolerance values;
- authorize production data storage, traffic, providers, signing or money movement;
- allow availability pressure to bypass policy, ledger, audit, KYC/KYT or custody controls;
- permit restoration over an occupied or unverified target;
- replace incident-response, release-authorization, data-lifecycle or provider-specific plans;
- treat synthetic PostgreSQL recovery tests as D-017 approval.

## Service and dependency register

Before production approval, each regulated business service must have a versioned
register entry:

```text
business_service_id:
service_name:
customer_or_regulatory_outcome:
accountable_owner:
technical_owner:
criticality:
products_and_jurisdictions:
data_classes:
financial_effects:
custody_effects:
compliance_effects:
entry_points:
internal_dependencies:
third_parties_and_subprocessors:
manual_dependencies:
trust_zones:
single_points_of_failure:
approved_degraded_modes:
prohibited_degraded_modes:
impact_tolerance:
slo_reference:
rpo_reference:
rto_reference:
monitoring_reference:
continuity_plan_reference:
last_exercised_at_utc:
next_review_at_utc:
status:
```

An application, queue or database is a component, not automatically a business
service. The register must trace the customer or regulated outcome through every
identity, policy, provider, financial, custody, audit, data and operator dependency.

## Criticality and impact analysis

The accountable owner must classify each service using evidence for:

- customer-money, settlement or reconciliation impact;
- custody, signing or asset-safety impact;
- AML/KYT, sanctions, case-management or regulatory-reporting impact;
- confidentiality, integrity and availability of regulated data;
- dependency on operator access or manual processing;
- volume, value, duration and jurisdiction of affected activity;
- downstream backlog, duplicate-processing and stale-state risk;
- credible provider, region, identity, database and supply-chain failures;
- maximum tolerable disruption before harm becomes unacceptable.

Criticality is not inherited solely from a vendor tier or infrastructure label.
Conflicting domain assessments remain unresolved and block production approval.

## Resilience objectives

Each objective must be approved for a named business service and version:

| Objective | Required meaning |
|---|---|
| Impact tolerance | Maximum disruption the business can tolerate before unacceptable customer, regulatory, financial or custody harm |
| SLO | Measured service behavior during an approved observation window |
| RPO | Maximum approved loss of committed recoverable state for a defined failure scenario |
| RTO | Maximum approved time to restore a verified business outcome for a defined failure scenario |
| Backlog tolerance | Maximum queued work and age that can be reconciled without unsafe replay or customer harm |
| Manual-operating limit | Approved duration, volume and segregation of duties for any manual fallback |

Objectives must name their scope, measurement source, exclusions, owner, approval,
effective date, expiry and linked test. An objective for one component, region,
provider or data class cannot be silently applied to another.

If an objective is unknown or unapproved, the safe default is that production
processing depending on it remains disabled.

## Degraded-operation rules

Degraded behavior must be explicit, bounded, observable and reversible.

| Boundary | Permitted resilience principle | Prohibited fallback |
|---|---|---|
| Customer/API | Preserve idempotency and communicate an approved unavailable/pending state | Accepting a command whose policy, evidence or downstream execution is unknown |
| Identity/backoffice | Deny protected actions when identity, role, session or step-up evidence is unavailable | Shared accounts, local bypass identities or reduced MFA |
| KYC/KYT/compliance | Queue or stop work under an approved policy with customer state clearly bounded | Treating provider silence, stale results or AI output as approval |
| Provider/callback | Quarantine, authenticate, deduplicate and reconcile evidence after recovery | Converting retries, screenshots or unauthenticated callbacks into finality |
| Financial core | Stop posting when command, policy, posting rule, ledger or reconciliation integrity is uncertain | Direct balance edits, mutable journals or cross-system best guesses |
| Custody | Stop orchestration/signing when intent, approval, signer or chain evidence is uncertain | Emergency key use, improvised broadcast or unapproved destination changes |
| Audit | Preserve local evidence references and stop actions that require unavailable accountability | Unlogged regulated actions or mutable substitute logs |
| Data | Preserve classification, legal hold and approved location | Copying production data to developer or unapproved recovery environments |
| Deployment | Keep affected capability disabled until exact artifact/configuration evidence is restored | Mutable rebuilds, direct host edits or unreviewed SQL |

Customer communications must distinguish unavailable, pending, accepted and final
states. A timeout is not evidence that a financial or custody effect did not occur.

## Architecture and failure containment

The approved design must:

- map fault domains across identity, compute, network, data, provider and operator paths;
- prevent one provider callback or worker failure from mutating ledger truth directly;
- isolate customer, operator, financial, custody and delivery trust zones;
- define bounded queues, retry budgets, backpressure and poison-message handling;
- make duplicate, delayed, reordered and contradictory evidence safe;
- protect immutable history and exact migration/catalog/runtime-role policy;
- separate failover authority from financial, custody and compliance approval;
- keep production credentials and signing authority outside general recovery tooling;
- prove that observability loss does not silently permit regulated commands;
- document every intentional single point of failure and compensating control.

Architecture redundancy does not remove the need for provider exit, manual
dependency, staff-availability and correlated-failure analysis.

## Capacity and change resilience

Capacity evidence must cover normal load, approved peaks, recovery backlog and
provider throttling. It must include:

- workload model and data growth assumptions;
- measured saturation, latency and queue-age indicators;
- safe limits and automated backpressure;
- capacity owner, review period and scaling lead time;
- dependency quotas, rate limits and contractual constraints;
- reconciliation and audit throughput after an outage;
- operator workload for exceptions and manual fallback;
- failure behavior when limits are reached.

Load tests use synthetic or explicitly approved minimized data and cannot access
production credentials, providers, signing authority or customer funds.

Material architecture, dependency, data, product or limit changes require a new
impact analysis and exercise before the previous evidence can authorize production.

## Backup, restore and disaster recovery

D-017 remains `Open`. Production backup retention, encryption, location, key
custody, RPO/RTO and restore authorization require written SRE, Security,
Compliance and affected data-owner approval.

An approved recovery procedure must:

1. identify the exact recovery point and source evidence;
2. authenticate and integrity-check every archive and manifest;
3. restore into an isolated, empty and access-controlled target;
4. verify exact migration history, schema/catalog, runtime privileges and configuration;
5. verify canonical financial, custody, audit and provider state;
6. detect structurally valid but stale, incomplete or wrong-scope recovery;
7. prove sequence, identifier, idempotency and outbox continuity;
8. reconcile against independent bank, provider and chain evidence where applicable;
9. confirm legal hold, retention and data-location obligations;
10. record executor, independent verifier, timings, digests and deviations;
11. keep traffic and regulated commands disabled until named resume approvals exist;
12. preserve the failed environment and original evidence when incident scope requires it.

Backups must not become an uncontrolled export path. Restore credentials and
decryption material require separate ownership, least privilege, rotation and
tested loss/compromise procedures.

## Continuity lifecycle

### 1. Prepare

- approve the service/dependency register and objectives;
- define failure scenarios, degraded modes and stop conditions;
- assign primary and alternate human roles;
- establish protected contact and escalation paths;
- bind continuity evidence to current architecture and provider versions.

### 2. Detect and assess

- open an incident or continuity record;
- timestamp the failure, affected outcomes and confidence;
- identify unavailable and potentially untrusted dependencies;
- preserve evidence before destructive action;
- classify customer, financial, custody, compliance and data impact.

### 3. Contain

- stop unsafe entry points and preserve accepted-command evidence;
- prevent duplicate processing, uncontrolled retries and stale finality;
- isolate compromised identities, artifacts, providers or recovery material;
- record every action, executor, approver and expected effect.

### 4. Continue or recover

- use only a pre-approved degraded mode or recovery plan;
- verify target capacity and dependency readiness;
- replay queued work by idempotent, ordered and reconciled procedures;
- reject ambiguous, conflicting or unverifiable effects;
- use compensating/reversal journals rather than rewriting history.

### 5. Verify and resume

- verify business outcomes, not only component health;
- attest identity, policy, artifact, configuration, data and evidence integrity;
- complete financial, provider, custody and compliance reconciliation;
- obtain Incident Commander, SRE, Security and affected domain approvals;
- resume in bounded stages with rollback and monitoring criteria.

### 6. Review

- record actual disruption, loss, backlog, recovery and customer impact;
- compare results with every approved objective;
- track corrective actions to evidence-backed closure;
- expire invalidated plans, assumptions, exceptions and approvals.

## Exercises and independent assurance

Before production approval and on an approved schedule, exercises must include:

1. loss of the primary region or hosting boundary;
2. identity-provider or operator-access outage;
3. database corruption and stale-but-valid recovery;
4. delayed, duplicated and contradictory provider callbacks;
5. bank/liquidity/KYC/KYT provider outage and controlled exit;
6. reconciliation backlog crossing its approved tolerance;
7. custody orchestrator, signer or chain-observation outage without improvised signing;
8. audit/checkpoint or monitoring unavailability;
9. compromised deployment artifact or recovery credential;
10. simultaneous provider and internal dependency failure;
11. loss of a critical human role or communications channel;
12. return to normal processing with safe backlog replay.

At least one exercise must restore into a disposable isolated environment and
measure business verification through the complete dependency path. Tabletop
discussion alone cannot prove technical recovery; a technical test alone cannot
prove human authority, communications or regulatory decision-making.

## Exercise evidence

```text
exercise_id:
business_service_id:
scenario:
scope_and_exclusions:
architecture_version:
provider_versions:
approved_objectives:
started_at_utc:
ended_at_utc:
participants_and_roles:
evidence_manifest_reference:
actual_disruption:
actual_data_loss:
actual_backlog:
actual_recovery_time:
reconciliation_result:
security_result:
domain_approvals:
deviations:
corrective_actions:
independent_reviewer:
next_test_due_at_utc:
```

Evidence stores references and digests, not secrets, private keys, raw customer
data or unredacted provider payloads.

## Monitoring and review

Monitoring must cover customer outcomes and control integrity, including:

- availability, latency, errors, saturation and backlog age;
- accepted commands without expected downstream evidence;
- idempotency, retry, replay and duplicate rates;
- ledger, settlement and provider reconciliation gaps;
- custody intent, approval, signer, outbox and chain-observation continuity;
- audit delivery, chain/checkpoint continuity and clock health;
- identity, policy, feature-flag and privilege availability;
- backup age, verification, restore-test and retention status;
- provider SLO, quota, incident and subprocessor changes;
- capacity forecast and manual-workload thresholds.

Alerts require an owner, severity path, response objective, tested routing and
expiry. A dashboard without accountable response and preserved evidence is not
a control.

## Third-party continuity

Third-party resilience evidence must align with the proposed
[third-party risk baseline](third-party-risk.md). For every critical dependency:

- map service, subprocessor, region and control dependencies;
- verify authenticated outage, retry, replay and reconciliation behavior;
- approve concentration, substitution and data-return constraints;
- retain tested contact, escalation and incident-cooperation paths;
- prove that exit data, schemas, keys and evidence are independently usable;
- test the internal service without assuming provider claims are true.

Provider redundancy is not effective when providers share the same subprocessor,
identity boundary, region, network, settlement bank or operational team.

## AI boundary

AI may:

- summarize approved telemetry and exercise evidence;
- propose failure scenarios, queries and corrective actions;
- compare measured results with approved objectives;
- draft status and review materials for human validation.

AI must not:

- set criticality, impact tolerance, SLO, RPO or RTO;
- declare a degraded mode safe;
- authorize failover, restore, traffic resume or backlog replay;
- approve a provider, exception, customer communication or regulatory conclusion;
- execute financial, custody, identity, deployment or recovery commands;
- close an incident, exercise finding or resilience gap.

## Approval dependencies

Production resilience approval requires:

- D-008 cloud/data location and disaster-recovery boundary;
- D-015 deployment topology and HA tier;
- D-016 staff identity and emergency-access boundary;
- D-017 backup retention, RPO/RTO and restore drill;
- D-018 protected runner and artifact-recovery strategy;
- approved product, country, asset and limit scope;
- approved service/dependency register and impact analysis;
- approved data classification, lifecycle and legal-hold behavior;
- approved provider contracts, continuity evidence and exit plans;
- approved financial, custody, compliance and audit degraded modes;
- current technical and human exercise evidence;
- named accountable owners, alternates and independent reviewers.

## Production stop conditions

Production remains blocked if:

1. a critical business service or dependency has no named owner;
2. impact tolerance, SLO, RPO, RTO or backlog limits are missing or unapproved;
3. a degraded mode bypasses identity, policy, ledger, audit, compliance or custody controls;
4. recovery cannot detect stale, partial, wrong-scope or unauthorized state;
5. reconciliation after outage or replay is undefined or untested;
6. a critical provider lacks authenticated outage behavior and usable exit evidence;
7. backup retention, encryption, location, key custody or restore authority is unresolved;
8. monitoring, escalation, capacity or manual staffing evidence is missing or stale;
9. an exercise exceeded an objective without an approved remediation or explicit NO-GO;
10. resume authority depends on one person, one credential or an AI decision;
11. production secrets, customer data or signing material enter development or general CI;
12. the release, incident, access-control, data-lifecycle or third-party gate is incomplete.

Green CI, redundant components, vendor certifications, a successful synthetic
restore or this document do not authorize production processing.
