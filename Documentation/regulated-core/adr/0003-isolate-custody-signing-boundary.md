# ADR-0003: Isolate Custody Signing Boundary

- Status: Proposed
- Date: 2026-10-01
- Owners: CTO / Security / Custody
- Required approvers: Legal, Security, CTO

## Context

Wallet assignment and withdrawals require a custody orchestrator, but API, backoffice, ledger and provider processes must never receive signing material. D-002 custody responsibility and D-003 HSM/MPC vendor/location remain open.

## Proposed decision

Separate custody into three trust zones:

1. Custody orchestrator validates reference-only withdrawal intent, policy version, asset/network allowlist, validity window and exact human approval evidence.
2. Signer gateway accepts only an immutable intent digest and signer-safe transaction contract after independent authentication and replay checks.
3. HSM/MPC boundary owns keys and cryptographic signing; it never exposes key material to orchestrator, API, backoffice, ledger or CI.

The current implementation covers only the first dev-only zone. It produces no chain-specific raw transaction and has no execution authority.

## Invariants

- No process outside the signer boundary receives private key material.
- Raw destination addresses do not enter general application or approval payloads; opaque references are resolved only inside the custody trust zone.
- Maker and checker are different authenticated humans with distinct approval roles and step-up evidence.
- Approvals bind to the exact unsigned intent and policy digest and expire before execution.
- Mainnet assets, production signing, transaction broadcast and permissive missing policy are rejected.
- Custody events remain workflow evidence and never directly mutate customer balances.
- Broadcast cannot establish financial finality without ledger and reconciliation evidence.

## Approval effect

Approval of this ADR permits contract and synthetic testnet implementation only. It does not authorize production signing, HSM/MPC provisioning, custody of customer assets, live withdrawals, broadcast or a change to D-002/D-003 status.
