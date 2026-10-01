# Regulated AI Governance Baseline — Proposed

- Status: Proposed
- Scope: AI-assisted development, operations, analysis and future regulated-core support
- Owners: MLRO/Compliance / Security / accountable business and technical owners
- Required approvers: MLRO, Security, Legal/Privacy, CTO and every affected domain owner
- Production effect: none

## Purpose

This baseline defines the evidence required to use an AI capability without
allowing it to become an unapproved decision-maker, privileged operator or
hidden dependency in a regulated business service. It expands accepted decision
D-012 into reviewable controls for capability inventory, data access, human
oversight, evaluation, release, monitoring and withdrawal.

It does not approve a model, provider, agent, dataset, prompt, integration,
production identity or regulated use case. Exact providers, data locations,
retention, models, evaluation thresholds and production permissions require
separate Legal/Privacy, MLRO, Security and domain approval.

## Governing principles

1. AI output is untrusted input until a named authorized human validates it.
2. AI cannot hold final authority over a regulated, financial, custody, identity or production action.
3. Capability is granted per approved purpose; general intelligence is not general authorization.
4. The least data, tools, time and privilege necessary are used.
5. Human review must be meaningful, informed and able to reject the output.
6. A deterministic policy or approved system of record remains authoritative.
7. AI cannot approve its own access, evaluation, exception, deployment or incident closure.
8. Every material input, output, tool call, model version and human decision is attributable.
9. Missing, stale or contradictory context fails closed.
10. Withdrawal and safe manual operation are designed before production reliance.

## Non-goals

This document does not:

- authorize autonomous AML, sanctions, fraud, KYC/KYT or customer-eligibility decisions;
- authorize money movement, ledger posting, reconciliation acceptance or limit changes;
- authorize custody approval, destination changes, signing, broadcast or key operations;
- authorize identity, access, secrets, deployment, failover, restore or incident commands;
- permit customer or Highly confidential data in unapproved training or provider retention;
- permit model output to replace source evidence, policy or professional judgment;
- define legal notice, consent, explainability or appeal requirements for a jurisdiction;
- approve production use of development agents or current repository automation.

## Capability register

Every AI capability must have a versioned register entry before it can access
regulated data, tools or workflows:

```text
capability_id:
name:
purpose:
accountable_business_owner:
technical_owner:
human_review_owner:
risk_tier:
model_and_provider:
model_version_or_release:
hosting_and_data_locations:
input_data_classes:
output_data_classes:
training_or_retention_behavior:
retrieval_sources:
tools_and_permissions:
affected_business_services:
affected_decision_register_items:
prohibited_actions:
required_human_decision:
evaluation_pack_reference:
release_record_reference:
monitoring_reference:
incident_and_withdrawal_plan:
approved_at_utc:
expires_at_utc:
status:
```

Unknown, materially changed, expired or ownerless capability records are
disabled. Friendly names or provider labels cannot substitute for immutable
model, configuration, policy and release references.

## Risk classification

Risk is based on possible effect, not whether the interface calls the capability
a copilot, recommendation, agent or automation.

| Tier | Example scope | Minimum boundary |
|---|---|---|
| A — development assistance | Draft code, tests or documentation with no production data or authority | Human review, repository policy and normal release controls |
| B — internal analysis | Summaries or proposed queries over approved internal evidence | Purpose-limited access, output validation, audit and no operational authority |
| C — regulated decision support | Case summaries, risk indicators or proposed actions seen by an authorized operator | Independent source evidence, qualified human decision, capability evaluation, explanation and appeal controls |
| D — prohibited autonomy | Final regulated decision, financial/custody action, privileged production command or control override | Not permitted under this baseline |

An apparently low-risk capability moves to the highest applicable tier when it
can influence a protected decision, reach a privileged tool, process Restricted
or Highly confidential data, or become necessary for a critical business
service.

## Permitted and prohibited authority

AI may, within an approved capability record:

- summarize preserved evidence with citations;
- classify or extract candidate fields for human verification;
- propose investigations, queries, tests or corrective actions;
- draft code, documentation, status reports and communications;
- compare observed evidence with an already-approved deterministic rule;
- identify inconsistencies and request human review.

AI must not:

- approve, deny, block, restrict, close or reopen a regulated case;
- decide whether a customer, transaction, asset, provider or jurisdiction is allowed;
- change KYC/KYT, sanctions, fraud, risk, limit or Travel Rule outcomes;
- create financial finality, accept reconciliation or rewrite ledger history;
- approve custody, choose a destination, sign, broadcast or handle key material;
- create or elevate identity, role, credential, secret or emergency access;
- deploy, enable a feature, fail over, restore, replay a backlog or resume traffic;
- suppress, alter or dispose of audit evidence;
- submit a regulatory conclusion or customer-impacting communication as final;
- call another AI capability to evade these restrictions.

## Meaningful human control

Human-in-the-loop means all of the following:

1. The reviewer has authority and training for the affected decision.
2. The reviewer can inspect the material source evidence, not only AI output.
3. The interface distinguishes evidence, deterministic policy and AI proposal.
4. Uncertainty, missing inputs, contradictions and model limitations are visible.
5. The reviewer can reject, correct or escalate without penalty or forced default.
6. Approval is an explicit authenticated action bound to the reviewed evidence.
7. The AI cannot perform the protected action before or after the human decision.
8. Review quality, overrides and automation bias are monitored.

Rubber-stamping, batch approval without sufficient evidence, hidden defaults or
a reviewer unable to understand the task do not satisfy D-012.

## Data and privacy controls

Every capability requires approved data-flow evidence covering:

- purpose and lawful basis;
- input, retrieval, output, telemetry and support-data classes;
- provider, hosting, processing and backup locations;
- retention, deletion, training, fine-tuning and abuse-monitoring behavior;
- tenant isolation, encryption, access, support and subprocessor controls;
- prompt-injection and untrusted-content boundaries;
- data minimization, redaction and field-level exclusions;
- data-subject access, correction, restriction, hold and disposal behavior;
- prevention of secrets, credentials, keys and raw production dumps in prompts;
- verified withdrawal and provider-exit behavior.

Customer data, provider payloads and regulated evidence cannot be reused for
training, evaluation or debugging unless that exact secondary purpose and data
flow are separately approved. Output inherits the highest classification of the
input or retrieved evidence until a reviewed rule proves otherwise.

## Retrieval and grounding

Where a capability uses retrieval:

- only approved versioned sources are indexed;
- source identity, version, jurisdiction and freshness are preserved;
- access checks apply before retrieval, not only after generation;
- retrieved content cannot grant tools or override system policy;
- output cites the evidence used and exposes missing or conflicting sources;
- deleted, restricted, held or superseded content follows approved lifecycle rules;
- retrieval logs do not become an unapproved copy of regulated data.

Generated citations, provider confidence scores and fluent explanations are
claims until independently resolved to canonical evidence.

## Tool and agent controls

Tool-enabled capabilities use deny-by-default permissions:

- one purpose-bound service identity per approved capability;
- explicit tool, repository, environment and data-scope allowlists;
- read-only access unless a separately approved non-regulated write is necessary;
- no production shell, database owner, secrets manager, signer or release authority;
- bounded invocation count, runtime, network destinations and resource use;
- schema-validated arguments and outputs;
- idempotency and preview/dry-run behavior where side effects are allowed;
- human confirmation outside the model context for any approved side effect;
- immutable records of tool requests, results, errors and human decisions;
- immediate revocation without depending on the model or provider.

Prompt text, retrieved content, model output and another agent are never trusted
authorization sources. A tool must independently authenticate, authorize and
validate every request.

## Evaluation requirements

The evaluation pack must match the exact capability, model, configuration,
retrieval corpus, tools and release candidate. It covers:

- intended-task accuracy with representative approved fixtures;
- false-positive, false-negative and abstention behavior;
- missing, stale, contradictory and adversarial evidence;
- prompt injection, data exfiltration and indirect instruction attacks;
- role, jurisdiction, language and product boundary cases;
- hallucinated evidence, citations, identities and system state;
- attempts to obtain prohibited authority or tool scope;
- sensitive-data disclosure and memorization probes;
- deterministic replay where the provider permits it;
- human-review usability and automation-bias scenarios;
- fallback and withdrawal without loss of regulated control.

Thresholds and acceptance criteria are set by the accountable domain, MLRO,
Security and Legal/Privacy where applicable. The team reports results by
scenario and severity; one aggregate score cannot hide a critical failure.

Evaluation data must be synthetic or explicitly approved, versioned, access
controlled and lifecycle managed. Production customer data is not copied into
evaluation by convenience.

## Release and change control

An AI release record binds:

```text
capability_id:
model_provider_and_version:
system_instruction_digest:
policy_digest:
retrieval_corpus_version:
tool_schema_and_allowlist_digest:
runtime_and_safety_configuration_digest:
evaluation_pack_and_result:
data_flow_assessment:
threat_model_reference:
known_limitations:
required_human_control:
monitoring_and_rollback:
domain_approvals:
release_expiry:
```

A provider/model change, system-instruction change, retrieval-source change,
tool or permission change, data-class change, material threshold change or new
business service requires impact review and re-evaluation. Silent provider
updates and mutable model aliases are unacceptable for a production regulated
capability unless an approved control detects, evaluates and blocks drift.

Green CI, a vendor benchmark or a successful demonstration is not release
authorization. The proposed release-authorization baseline still governs the
exact artifact, configuration, environment and enablement state.

## Runtime monitoring

Monitoring must preserve privacy while detecting:

- capability, model, prompt, policy, corpus and tool version drift;
- unavailable, slow, truncated or malformed provider responses;
- abstention, uncertainty, contradiction and unsupported-citation rates;
- protected-decision suggestions and prohibited tool attempts;
- human acceptance, rejection, correction, escalation and override patterns;
- distribution shift by approved product, language and jurisdiction segments;
- unexpected data classes, secrets or identifiers in inputs and outputs;
- prompt-injection and exfiltration indicators;
- provider incidents, retention changes and subprocessor changes;
- reliance, backlog and safe-manual-operation limits.

Threshold breach produces a bounded alert, suspension or routing to manual
review according to approved policy. It does not allow the AI to change its own
instructions, thresholds, access or monitoring.

## Incident and withdrawal

The incident plan must support:

1. disabling the capability and revoking its identities and tools;
2. preserving model, configuration, prompt, retrieval, output and tool evidence;
3. identifying affected decisions, records, users and time windows;
4. routing work to an approved manual or deterministic path;
5. re-reviewing affected regulated decisions by authorized humans;
6. assessing data exposure, provider obligations and notification requirements;
7. blocking replay of unsafe outputs or queued actions;
8. independent validation before any re-enable decision.

The AI cannot assign incident severity, approve containment, decide notification
obligations, declare affected decisions safe or close the incident.

## Third-party AI providers

Each external model, hosting, annotation, evaluation or monitoring provider must
satisfy the proposed third-party-risk baseline. Review includes:

- entity, service, region, model and subprocessor identity;
- data use, retention, training, deletion and support-access terms;
- isolation, encryption, incident cooperation and evidence export;
- model/update notice and version pinning capability;
- service limits, outage behavior and tested exit;
- intellectual-property, confidentiality and regulatory assistance terms;
- concentration and common-subprocessor risk.

Provider attestations, model cards, benchmark scores and contractual SLOs are
evidence inputs, not internal approval or proof of safe regulated outcomes.

## Audit evidence

For each invocation, evidence must be sufficient to reconstruct:

- capability and release identity;
- authenticated actor, service and purpose;
- input and retrieval references without unnecessary data duplication;
- model/provider response identity and status;
- output reference and classification;
- tool requests and results;
- policy checks, warnings, abstentions and errors;
- human reviewer, decision, corrections and timestamp;
- downstream record or case affected, if any.

Evidence follows the audit-evidence and data-lifecycle baselines. Sensitive raw
prompts and outputs are access controlled and retained only under approved
purpose; hashes alone are insufficient when substantive review is required.

## Approval dependencies

Production AI use remains blocked until:

- the capability record and risk tier are approved;
- D-012 capability tests and operator-approval evidence are complete;
- affected product, legal, AML, financial, custody and jurisdiction scope is approved;
- data purpose, location, provider, retention and subprocessors are approved;
- threat-model and misuse-case controls are verified;
- exact model, configuration, retrieval, tools and release evidence are approved;
- human reviewers, alternates, training and workload capacity are approved;
- monitoring, incident, withdrawal and provider-exit plans are exercised;
- independent Security and domain review has no unresolved critical/high findings.

## Production stop conditions

The capability is `NO-GO` when:

1. its owner, purpose, risk tier, model or affected business service is unknown;
2. it can make or execute a protected decision;
3. human review lacks source evidence, authority, time or a real reject path;
4. data location, retention, training use or subprocessors are unknown;
5. tool access is broader than the approved purpose or independently unenforced;
6. evaluation omits a material product, language, jurisdiction or adversarial case;
7. model, prompt, corpus, policy, tool or provider drift is undetected;
8. monitoring cannot identify affected decisions and withdraw safely;
9. provider exit would lose required evidence, data control or business continuity;
10. the capability depends on production secrets, key material or unrestricted customer data;
11. a critical/high security, privacy, compliance or evaluation finding is unresolved;
12. any required human approval is missing, expired or bound to another release.

Approval of this baseline confirms only the governance design. It does not
approve a provider, model, production data flow, privileged tool, regulated use
case, autonomous action or production launch.
