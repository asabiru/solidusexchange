# Phase 0 Evidence Index

## Exit gate

Phase 0 is complete only when Legal, MLRO and CTO approve the executable V1 scope, and every unresolved dependency has an owner, deadline and deny-by-default behavior.

| Evidence | Owner | Required content | Current state |
|---|---|---|---|
| Decision register | CTO / Legal / MLRO | D-001…D-018 decisions or safe assumptions | Drafted; approvals pending |
| Architecture ADR | CTO / Security | Context map, trust zones, prohibited paths | Proposed |
| Legacy inventory | Architecture / Finance / Security | Routes, data, providers, jobs, secrets surfaces | Static repository inventory complete |
| Migration boundary | Financial Core / Finance / Compliance | Mapping, opening journals, reconciliation, rollback | Proposed |
| Product/risk matrix | Product / Compliance / Risk | Countries, assets, limits, customer types, exclusions | Drafted; blocked on D-001/D-010/D-014 |
| Data processing register | Legal / Privacy / Security | PII classes, locations, processors, retention | Drafted; approvals open |
| Vendor scorecards | Procurement / domain owner | Bank, issuer, KYC/KYT, HSM, cloud, liquidity | Template drafted; evaluations open |
| Threat model | Security / Architecture | Abuse cases, trust boundaries, mitigations | Proposed; Security/Architecture approval pending |
| Incident response baseline | Security / SRE / Legal / MLRO | Severity, roles, evidence, containment, recovery and notification gates | Proposed; domain approvals pending |
| Release authorization baseline | SRE / Security / CTO | Artifact provenance, approval binding, enablement, rollback and NO-GO gates | Proposed; D-015/D-018 and domain approvals pending |
| Audit evidence baseline | Security / Compliance / SRE | Event semantics, actor/policy binding, append-only integrity, access/export and retention | Proposed; identity, retention and key-custody approvals pending |
| Data lifecycle baseline | Legal / Privacy / MLRO / Finance / Security | Retention triggers, holds, correction, disposal, processors, copies and recovery behavior | Proposed; schedule, location, processor and legal-basis approvals pending |
| Access-control baseline | Security / CTO / domain owners | Identity lifecycle, authentication, authorization, segregation of duties, privileged access and review | Proposed; D-016, production IdP/MFA, JML and privileged-access approvals pending |
| Third-party risk baseline | Procurement / Security / Legal / domain owners | Criticality, diligence, contracts, onboarding, monitoring, incidents, concentration and exit | Proposed; provider selections, contracts and applicable D-001…D-018 approvals pending |
| Operational-resilience baseline | SRE / Security / business-service owners | Impact tolerances, degraded modes, capacity, dependency continuity, RPO/RTO, recovery and exercises | Proposed; D-008/D-015/D-017/D-018, service objectives and exercise approvals pending |
| AI-governance baseline | MLRO / Security / Legal / domain owners | Capability inventory, human control, data/tool scope, evaluation, release, monitoring and withdrawal | Proposed; D-012 capability tests, provider/data and domain approvals pending |
| Customer-protection baseline | Product / Legal / Compliance / Customer Operations | Disclosures, quotes, statuses, restrictions, support, complaints, remediation and customer-harm monitoring | Proposed; product scope, customer terms, complaint/remediation policy and domain approvals pending |
| Safeguarding baseline | Finance / Legal / Compliance / Treasury / Custody | Customer asset segregation, entitlement, provider/custody evidence, reconciliation, shortfall and wind-down controls | Proposed; legal model, provider/custody scope, treasury policy, reconciliation and domain approvals pending |
| Compliance-operations baseline | MLRO / Compliance / Legal / Risk Operations | CDD, sanctions/PEP, KYT, transaction monitoring, cases, reporting assessment, restrictions and compliance stop conditions | Proposed; D-001/D-011/D-012/D-014, policy, provider, case-management and reporting approvals pending |
| Finance model | CFO / Financial Core | Chart of accounts and reconciliation sign-off | Required before ledger build |

## Review checklist

- [ ] Each decision has an accountable owner and approval date.
- [ ] Legal scope is written and linked.
- [ ] V1 country/asset/limit matrix is approved.
- [ ] Custody and HSM direction is approved before vendor provisioning.
- [ ] Financial schema and chart of accounts have Finance review.
- [ ] Data locations, processors and retention are approved.
- [ ] Workforce SSO/MFA, JML, privileged access and access-review controls are approved.
- [ ] Critical vendors, subprocessors, concentration risks and exit plans are approved.
- [ ] Critical business services, impact tolerances, degraded modes, capacity and continuity exercises are approved.
- [ ] Every AI capability has approved human authority, data/tool boundaries, evaluation and withdrawal evidence.
- [ ] Every customer journey has approved terms, price/fee semantics, status evidence, support, complaint and remediation paths.
- [ ] Every customer asset scope has approved segregation, entitlement, reconciliation, treasury, custody and shortfall evidence.
- [ ] Every compliance operation has approved CDD, screening, monitoring, case, reporting, restriction and provider evidence.
- [ ] Legacy schema is reproducible without relying on an unsanitized dump.
- [ ] Any credential-like seeded fixture is removed or proven non-production and rotated.
- [ ] Production provider work remains blocked until its vendor gate is complete.
- [ ] Live feature flags default to off and require an explicit release approval.

## Evidence storage rules

- Store approvals as immutable references, not copied chat summaries.
- Record document version, approver identity and timestamp.
- Link architecture, security, test, finance and legal evidence to the release.
- Never attach secret values, customer PII or private keys.
- Superseded decisions remain retained and traceable.

## Go/no-go rule

Missing evidence is a `NO-GO`, not an implicit exception. A temporary exception requires an owner, expiry, compensating control and explicit approval from the accountable domain.
