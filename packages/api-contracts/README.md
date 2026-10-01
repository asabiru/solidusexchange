# SolidChange API Contracts

This package is the canonical, runtime-independent contract boundary for future SolidChange customer and operator APIs.

## Current status

- Contract version: `v1` draft.
- Runtime boundary: `contract-only`.
- Production providers: disabled.
- Financial commands: disabled.
- Customer PII and provider payloads: excluded from examples.
- Approval effect: schema review only; no live endpoint or money movement is authorized.

The legacy Laravel routes and the dev-only backoffice BFF are not implementations of this API. They remain separate compatibility and operator boundaries until regulated-core services are built.

## Contents

| Artifact | Purpose |
|---|---|
| `openapi.yaml` | OpenAPI 3.1 foundation for `/api/v1`, common headers, errors and read-only namespace discovery |
| `schemas/error.schema.json` | Stable client-safe error envelope |
| `schemas/events/domain-event.schema.json` | Versioned event envelope and payload schemas |
| `event-catalog.json` | Ownership, classification and authority for every event type |
| `examples/domain-events.json` | Synthetic, non-PII examples for contract checks |
| `COMPATIBILITY.md` | API and event evolution, deprecation and review rules |
| `scripts/check-contracts.mjs` | Dependency-free structural and safety checks |
| `tests/contract-boundary.test.mjs` | Fail-closed mutation tests for contract safety boundaries |

`openapi.yaml` uses JSON syntax, which is valid YAML 1.2, so CI can parse it without installing a YAML dependency.

## Namespace policy

- `/api/v1/customer/*` is for authenticated customer-facing capabilities.
- `/api/v1/operator/*` is for staff/service capabilities and is never exposed through customer credentials.
- `/api/v1/meta` exposes only non-sensitive contract metadata.
- Financial command paths are intentionally absent from this slice.

Future command operations must additionally define:

- `Idempotency-Key`;
- command-specific authorization scopes;
- explicit state transitions;
- policy and limit decisions;
- immutable audit evidence;
- ledger effects;
- reconciliation and recovery semantics.

## Required request context

Protected requests use:

- `Authorization`;
- `X-Request-Id`;
- `X-Client-Version`;
- `X-Platform`.

`Idempotency-Key` is defined as a required reusable component for future commands but is not attached to the current read-only paths.

## Error policy

Clients receive:

```json
{
  "code": "CAPABILITY_DENIED",
  "message": "The authenticated actor cannot access this capability.",
  "request_id": "018f3f8a-6a36-7bd8-86e0-b59cd575d55a",
  "details": {}
}
```

Stack traces, internal exception messages, secrets and raw provider responses are prohibited.

## Event policy

- Event names and versions are stable integration identifiers.
- Event IDs are globally unique and consumers must be idempotent.
- `correlation_id` links a business flow; `causation_id` links the direct predecessor.
- Monetary values are decimal strings, never floating-point JSON numbers.
- References replace raw wallet addresses, KYC documents and provider payloads.
- Events state facts that occurred; they do not grant approval or execution authority.
- `CustodyIntentPrepared` records only a reference-based, testnet unsigned intent with exact policy and approval digests; it cannot authorize signing or broadcast.
- Breaking payload changes require a new `event_version` and a compatibility window.

## Compatibility

Compatible changes:

- add an optional field;
- add a new event type;
- widen documented enum handling when consumers already fail safely;
- add a new read-only operation.

Breaking changes:

- remove or rename a field;
- change meaning, type, units or classification;
- make an optional field required;
- reuse an event name for a different fact;
- change authorization or idempotency semantics.

Breaking API changes require a new major path. Breaking event changes require a new event version and parallel consumer support.

## Validation

```bash
npm ci
npm test
```

The checker verifies local references, namespace/version rules, canonical bearer scheme definitions, exact customer/operator security requirements, required headers and request ID schema, canonical error responses, error shape, event catalog/schema/example alignment, decimal amount encoding and prohibited secret/PII field names. Negative tests mutate financial-command, HTTP method, authentication-scheme, anonymous-security-alternative, request-header-schema, remote-reference, operation-error-envelope, error-envelope, execution-authority and prohibited-field boundaries and require every drift to fail closed.
