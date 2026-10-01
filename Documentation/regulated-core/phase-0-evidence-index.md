# Phase 0 Evidence Index

## Exit gate

Phase 0 is complete only when Legal, MLRO and CTO approve the executable V1 scope, and every unresolved dependency has an owner, deadline and deny-by-default behavior.

| Evidence | Owner | Required content | Current state |
|---|---|---|---|
| Decision register | CTO / Legal / MLRO | D-001…D-014 decisions or safe assumptions | Drafted; approvals pending |
| Architecture ADR | CTO / Security | Context map, trust zones, prohibited paths | Proposed |
| Legacy inventory | Architecture / Finance / Security | Routes, data, providers, jobs, secrets surfaces | Static repository inventory complete |
| Migration boundary | Financial Core / Finance / Compliance | Mapping, opening journals, reconciliation, rollback | Proposed |
| Product/risk matrix | Product / Compliance / Risk | Countries, assets, limits, customer types, exclusions | Drafted; blocked on D-001/D-010/D-014 |
| Data processing register | Legal / Privacy / Security | PII classes, locations, processors, retention | Drafted; approvals open |
| Vendor scorecards | Procurement / domain owner | Bank, issuer, KYC/KYT, HSM, cloud, liquidity | Template drafted; evaluations open |
| Threat model | Security / Architecture | Abuse cases, trust boundaries, mitigations | Proposed; Security/Architecture approval pending |
| Incident response baseline | Security / SRE / Legal / MLRO | Severity, roles, evidence, containment, recovery and notification gates | Proposed; domain approvals pending |
| Release authorization baseline | SRE / Security / CTO | Artifact provenance, approval binding, enablement, rollback and NO-GO gates | Proposed; D-015/D-018 and domain approvals pending |
| Finance model | CFO / Financial Core | Chart of accounts and reconciliation sign-off | Required before ledger build |

## Review checklist

- [ ] Each decision has an accountable owner and approval date.
- [ ] Legal scope is written and linked.
- [ ] V1 country/asset/limit matrix is approved.
- [ ] Custody and HSM direction is approved before vendor provisioning.
- [ ] Financial schema and chart of accounts have Finance review.
- [ ] Data locations, processors and retention are approved.
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
