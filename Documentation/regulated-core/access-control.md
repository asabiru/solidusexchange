# Access Control and Identity Governance Baseline — Proposed

## Status and boundary

This document defines the proposed identity, authentication, authorization and privileged-access control model for the regulated SolidChange platform.

It does not provision a production identity provider, grant production access, approve a VPN/ZTNA product, enable operator commands, create service credentials or satisfy D-016. All current backoffice identity, session and step-up behavior remains synthetic or local development evidence.

## Objectives

The access-control system must:

1. bind every human and workload action to one accountable identity;
2. deny access unless an approved purpose, role and environment permit it;
3. prevent customer, operator, provider, financial, custody and infrastructure identities from collapsing into one trust boundary;
4. require stronger assurance for privileged, export, approval and money- or custody-adjacent actions;
5. preserve maker-checker separation and human approval authority;
6. expire access when employment, contract, role, device or purpose changes;
7. make grants, use, review, escalation and revocation independently auditable;
8. fail closed when identity, policy, evidence or dependency state cannot be verified.

## Identity classes

| Identity class | Examples | Required owner | Default boundary |
|---|---|---|---|
| Customer | Individual or business user | Product + Security | Customer APIs only; never operator or infrastructure access |
| Workforce | Support, Compliance, Finance, Security, SRE | Department owner + Security | Backoffice capabilities explicitly mapped from approved groups |
| Privileged workforce | Production administrator, database operator, incident commander | System owner + Security | Time-bound elevation through an approved privileged-access path |
| Workload | API, ledger worker, reconciliation job, backoffice BFF | Service owner | One workload, environment and purpose per identity |
| CI/release | Build, provenance, deployment or verification job | SRE + Security | Build and release scopes separated from production runtime scopes |
| Provider | Bank, KYC/KYT, liquidity, notification or custody adapter | Vendor owner + Security | Adapter-specific authentication; no implicit internal role |
| Emergency | Break-glass identity | Security + CTO | Disabled or unusable by default; monitored, time-bound and reviewed |
| AI agent | Development or approved analysis agent | Human owner + Security | Proposal and evidence scopes only; no regulated approval authority |

Shared human accounts are prohibited. A workload credential cannot be used as an interactive human credential, and a human identity cannot be embedded in a workload.

## Trust and environment separation

- Customer identity and operator identity use separate clients, sessions, origins and authorization policies.
- Development, test, staging and production use separate tenants, credentials, signing keys and role assignments.
- Access to one environment grants no access to another.
- Production data access is not inherited from deployment, database migration, backup or observability access.
- Custody signer, key-administration and transaction-orchestration identities remain separate.
- Financial posting, reconciliation, approval and database-administration identities remain separate.
- Provider credentials authorize only the reviewed adapter and provider account.
- CI jobs cannot assume production runtime identities or read production data by default.
- Legacy application or administrator credentials do not map automatically into regulated-core roles.

Production access must use an approved managed device and network-access posture defined by D-016. Network location alone is not authentication or authorization.

## Identity lifecycle

Every workforce identity requires an authoritative source record containing:

```text
subject_id:
employment_or_contract_reference:
manager:
department:
jurisdiction:
start_at_utc:
end_at_utc:
approved_groups:
access_purpose:
device_requirement:
review_due_at_utc:
```

### Joiner

- Verify the person through the approved workforce identity process.
- Create one named identity; do not clone another person's access.
- Grant only approved baseline groups after manager and system-owner approval.
- Enrol approved phishing-resistant authentication factors before protected access.
- Record training or confidentiality prerequisites required by the role.

### Mover

- Recalculate access from the new role and purpose.
- Remove old access before or together with the new grant.
- Reapprove incompatible or privileged permissions.
- Invalidate active elevation and high-risk sessions when responsibility changes.

### Leaver

- Disable interactive access at the effective end time or immediately for urgent termination.
- Revoke sessions, factors, tokens, certificates, SSH access and privileged elevation.
- Transfer owned records without transferring credentials.
- Rotate any exceptional shared technical secret the person could access.
- Preserve evidence under approved retention and legal-hold rules.

Authoritative lifecycle updates must propagate within approved service-level objectives. If propagation or revocation evidence is unavailable, protected access is denied.

## Authentication assurance

Production workforce access requires:

- federation through the approved workforce identity provider;
- phishing-resistant MFA for operator and privileged roles;
- verified issuer, client, redirect, audience, authorized-party and signing-key policy;
- device and network posture where approved by D-016;
- risk-based reauthentication without silent weakening of the minimum assurance;
- recovery procedures that cannot bypass identity proofing or factor policy.

SMS, email links, knowledge questions and synthetic development codes are not sufficient production factors for privileged or regulated operator access.

Factor enrolment, replacement and recovery require separately auditable evidence. Helpdesk personnel cannot both initiate and approve a protected factor reset.

## Sessions and step-up

- Sessions are short-lived, server-side revocable and bound to the intended client and environment.
- Browser tokens remain outside script-accessible storage where the application design permits.
- Session creation, renewal, revocation and assurance level are audited.
- Role or employment changes invalidate affected sessions.
- High-risk actions require recent step-up evidence bound to the actor, action, resource, scope and command or export digest.
- Step-up grants are single-purpose, short-lived and non-transferable.
- A lower-assurance session cannot inherit a previous high-assurance decision.
- Failure to validate identity, session, device, policy or step-up state denies the action.

Production session lifetimes, inactivity limits and reauthentication intervals require Security approval and threat-model evidence.

## Authorization model

Authorization is evaluated server-side using explicit capabilities. UI visibility is not an authorization control.

Each decision binds:

```text
actor_id:
actor_type:
session_id:
assurance_level:
role_ids:
capability:
resource_type:
resource_id:
purpose:
environment:
policy_version:
decision:
reason_code:
step_up_reference:
approval_references:
occurred_at_utc:
```

Rules:

- Unknown roles, capabilities, resources, purposes and policy versions deny by default.
- Role membership alone is insufficient when resource, case, jurisdiction, amount, environment or approval scope is required.
- Authorization is checked when the action executes, not only when a page loads or a request is created.
- Cached decisions cannot outlive their identity, policy, session or resource version.
- Denials and policy errors produce audit evidence without exposing sensitive policy details to the caller.
- Direct database grants cannot substitute for application authorization.
- Customer support access is field- and purpose-limited; raw KYC, bank, custody and secret data is excluded unless specifically approved.

## Segregation of duties

The following responsibilities cannot be combined for the same action:

| Action | Incompatible responsibilities |
|---|---|
| Regulated release | Change author, required reviewer, release approver and production enabler as required by policy |
| Financial journal or adjustment | Requester, policy approver, poster and independent reconciler |
| Customer restriction or AML case | Investigator and final regulated decision-maker where maker-checker applies |
| Evidence export | Requester and approver for restricted or bulk scope |
| Access grant | Beneficiary and final approver |
| Privileged elevation | Requester and approver |
| Audit administration | Audit-event producer, storage administrator and independent verifier |
| Custody operation | Intent requester, policy approver, signer administrator and reconciliation owner |
| Backup disposal or recovery | Executor and independent verifier |

An emergency does not silently waive segregation of duties. Any approved exception requires scope, reason, compensating control, expiry and post-event review.

## Privileged access

Standing production administrator access must be minimized. Privileged access requires:

- a named primary identity plus a distinct elevated role;
- a ticket, incident or approved change reference;
- explicit target, purpose, capability and duration;
- step-up authentication;
- independent approval where feasible;
- just-in-time activation and automatic expiry;
- session, command or database-access evidence appropriate to the system;
- review of sensitive changes and exports;
- immediate revocation when the approved task ends.

Cloud owner, identity-provider administrator, database superuser, audit-store administrator, backup administrator and HSM/KMS administrator are separate privileged roles. Access to one does not imply access to another.

Permanent personal production SSH keys, unmanaged local administrator accounts and credentials copied into chat, tickets, shell history or repositories are prohibited.

## Break-glass access

Break-glass exists only for a documented condition where normal privileged access is unavailable and delay would materially increase harm.

Each use requires:

```text
break_glass_id:
actor_id:
incident_or_change_reference:
target:
justification:
approved_scope:
activated_at_utc:
expires_at_utc:
evidence_references:
review_owner:
review_completed_at_utc:
```

Controls:

- access is disabled or sealed when not in use;
- activation alerts Security and the accountable system owner;
- scope and duration are technically bounded;
- all use is audited independently from the target administrator;
- credentials or factors are rotated or resealed after use;
- a post-event review confirms actions, impact and restoration of normal controls.

Missing review or unexplained use is a security incident.

## Workload and service identities

- One service identity is assigned to one workload, environment and approved purpose.
- Runtime, migration, backup, monitoring, CI and release identities are separate.
- Workload authentication uses short-lived, automatically rotated credentials or certificates where supported.
- Long-lived secrets require an approved vault, owner, rotation period and revocation procedure.
- Workload identities have no interactive login unless explicitly required and approved.
- Database ownership and migration authority are not granted to runtime writers.
- Provider adapter identities cannot invoke ledger, custody or operator functions outside their contract.
- Credentials are never logged, returned in evidence exports or embedded in artifacts.
- Unused or ownerless service identities are disabled.

The owner must be able to identify every deployed instance using a credential and prove rotation without uncontrolled outage.

## Access requests and approvals

An access request records:

```text
request_id:
beneficiary:
requested_role_or_capability:
system:
environment:
purpose:
scope:
requested_start_at_utc:
requested_end_at_utc:
manager_approval:
system_owner_approval:
security_approval:
conflict_check_reference:
decision:
provisioning_evidence:
revocation_due_at_utc:
```

Approval is bound to the exact scope and duration. Forwarded messages, copied screenshots and generic manager consent are not approval evidence.

Privileged, restricted-data, production, custody, financial and identity-administration access requires the accountable system owner and any domain approvals defined by policy.

## Reviews and reconciliation

- Privileged and emergency access is reviewed at an approved high frequency.
- All production and restricted-data access is recertified on an approved schedule.
- Reviews use authoritative identity, HR/contract, group, application, cloud, database and provider inventories.
- The reviewer confirms purpose, owner, last use, conflicts, expiry and current employment or contract state.
- Orphaned, dormant, duplicated, excessive or conflicting access is revoked, not merely documented.
- Revocation is reconciled across downstream systems and active sessions.
- Review completion, exceptions and remediation are retained as audit evidence.

The exact cadence is a Security and Legal/Privacy decision; code or vendor defaults do not select it.

## Monitoring and evidence

Audit evidence must cover:

- authentication success, failure, factor recovery and risk response;
- session issuance, assurance changes and revocation;
- group, role, capability and policy changes;
- access request, approval, provisioning, expiry and revocation;
- privileged elevation and break-glass activation;
- restricted-data search, view, export and failed access;
- service-identity creation, credential issue, rotation and revocation;
- access-review inputs, decisions, exceptions and remediation;
- authorization denials and policy-evaluation failures.

Evidence follows the proposed [audit evidence baseline](audit-evidence.md) and [data lifecycle baseline](data-lifecycle.md). Authentication secrets, tokens, MFA seeds, private keys and full restricted payloads are never recorded.

## Third-party and support access

- Vendor personnel receive named, time-bound identities or approved federated access.
- Contracts define purpose, support boundary, evidence, incident notification and revocation.
- Remote support is disabled by default and activated only for an approved case.
- Vendor access cannot bypass environment, data-classification or segregation-of-duties controls.
- Actions performed by a vendor remain attributable to the individual and sponsoring internal owner.
- Provider portals and external consoles are included in access reviews and leaver processes.

## AI boundary

AI may:

- summarize access inventories and evidence;
- detect apparent orphaned, dormant or conflicting access;
- draft access requests, review findings and remediation plans;
- propose least-privilege mappings for human review.

AI cannot:

- approve, provision or extend production access;
- reset authentication factors;
- activate privileged or break-glass access;
- waive segregation of duties;
- approve its own service identity or scope;
- make final regulated, financial, custody, privacy or security decisions.

Any AI access is purpose-limited, time-bound, audited and approved like other workload access.

## Minimum misuse-case tests

Before production authorization, evidence must prove:

1. unknown and unmapped roles deny access;
2. a customer token cannot access operator or infrastructure functions;
3. an operator session cannot impersonate a customer;
4. expired, revoked, wrong-client and insufficient-assurance sessions are rejected;
5. role changes invalidate affected active sessions;
6. UI manipulation cannot bypass server-side capability checks;
7. maker and checker cannot collapse through group mapping or session reuse;
8. step-up for one action cannot authorize a changed action or scope;
9. privileged elevation expires and cannot be replayed;
10. break-glass use alerts, expires and produces independent evidence;
11. a leaver loses access across IdP, application, cloud, database and provider systems;
12. runtime workloads cannot assume migration, owner or release identities;
13. restricted-data search and export require approved purpose and capability;
14. policy-store or identity-provider unavailability denies protected actions;
15. audit or access-review evidence cannot be silently altered or omitted.

## Approval dependencies

Production access remains blocked until:

- D-016 workforce SSO and VPN/ZTNA direction is approved;
- production IdP, phishing-resistant MFA, device and recovery policies are approved;
- the authoritative joiner-mover-leaver source and propagation objectives are approved;
- role, capability and segregation-of-duties matrices are approved by domain owners;
- privileged-access, break-glass and emergency procedures are independently tested;
- service-identity issuance, storage, rotation and revocation are approved;
- access evidence, retention, legal hold and review cadence are approved;
- vendor access and support paths are contractually and technically controlled;
- Finance, MLRO, Legal/Privacy, Security, SRE and CTO approvals applicable to the scope are recorded.

## Production stop conditions

Production access is `NO-GO` when:

- a required identity or access decision remains open or ownerless;
- shared human accounts or unmanaged credentials are required;
- production roles can be granted without attributable approval;
- MFA, session revocation, JML propagation or step-up cannot fail closed;
- maker-checker or privileged-role conflicts cannot be detected;
- break-glass cannot be bounded, alerted and reviewed;
- a workload requires owner, migration or cross-environment authority;
- restricted access or export cannot produce independent audit evidence;
- revocation cannot be reconciled across downstream systems;
- provider, cloud, database, custody or identity administration collapses into an unreviewed super-role.

Approval of this baseline confirms only the proposed access-control design. It does not satisfy D-016, provision identities, grant production access, approve a provider, enable operator commands, migrate customer data, move money, sign transactions or launch the platform.
