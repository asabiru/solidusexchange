# ADR-0001: Isolate the Regulated Core from Legacy Laravel

- Status: Proposed
- Date: 2026-09-25
- Owners: CTO / Architecture
- Required approvers: Security, Financial Core, Legal/Compliance for data boundary

## Context

The existing Laravel application contains customer, KYC, exchange, payment, provider and admin workflows. It also relies on numeric status fields, provider-specific services, a historical SQL dump and transaction-like rows that do not establish a double-entry ledger.

The separate backoffice demonstrates operator identity, RBAC, signed read APIs, audit/evidence, approval previews and synthetic risk workflows. It intentionally does not execute financial commands.

Extending legacy controllers into a regulated command plane would couple custody, ledger, provider execution and operator privilege to code that was not designed around those invariants.

## Decision

Build the regulated core as isolated modules and deployable trust zones beside the legacy Laravel application.

1. Legacy remains a customer-facing compatibility and migration source during transition.
2. A new financial core owns ledger accounts, journals, entries, holds, fees, settlement and reconciliation.
3. A canonical API/contracts package owns OpenAPI, schemas, errors and domain events.
4. Provider-specific code implements narrow adapter contracts; domain services do not call arbitrary provider classes.
5. Custody, signer and broadcaster boundaries are isolated from API and operator processes.
6. Backoffice commands target regulated-core use cases through BFF policy gates; it never updates legacy financial tables directly.
7. PostgreSQL is the proposed datastore for the new financial core. This remains subject to D-009 approval.
8. Domain events use an outbox/inbox pattern with idempotent consumers.
9. Legacy data enters the new platform only through the approved migration pipeline.

## Target trust zones

```text
Customer clients
      |
Customer API / identity
      |
Regulated use cases ---- Risk / KYC / limits
      |
Financial core ---- Ledger / holds / settlement / reconciliation
      |
Provider adapters ---- Bank / liquidity / KYC / KYT
      |
Custody orchestrator ---- Signer gateway ---- HSM/MPC

Operator browser ---- Backoffice BFF ---- policy / approval / audit

Legacy Laravel ---- read-only migration and compatibility adapters
```

## Invariants

- No financial command bypasses policy and ledger.
- No process outside custody boundary receives private key material.
- No provider callback directly changes a customer balance.
- No operator screen receives a direct database mutation capability.
- Every command has actor, authorization, idempotency key, correlation ID, state transition, audit evidence and recovery semantics.
- Live provider execution is disabled until its domain gate is approved.

## Consequences

### Positive

- Ledger and reconciliation become independently testable.
- Provider and custody failures are contained.
- Legacy can be retired incrementally through a strangler migration.
- Backoffice controls can evolve without exposing direct database actions.

### Cost

- Temporary coexistence and mapping between two systems.
- Additional operational components and observability.
- Explicit migration/reconciliation work instead of a schema copy.
- Vendor and infrastructure decisions remain on the critical path.

## Rejected alternatives

### Continue adding regulated workflows directly to legacy Laravel

Rejected because the current data and state model does not guarantee ledger, approval, custody or reconciliation invariants.

### Big-bang rewrite and immediate cutover

Rejected because it combines identity, financial, provider, custody and operational risk without a measurable rollback boundary.

### Treat the React backoffice/BFF as the new backend

Rejected because the BFF is an operator security boundary, not a financial domain or ledger runtime.

## Approval effect

Approval authorizes contract and sandbox implementation only. It does not authorize production data migration, HSM provisioning, provider credentials, live money movement or customer launch.
