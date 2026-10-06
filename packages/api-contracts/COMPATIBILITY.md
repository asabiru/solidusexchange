# Contract compatibility policy

This policy applies to the canonical SOLID API and domain events.

## Version identifiers

- API major version is encoded in the path, for example `/api/v1`.
- The OpenAPI document carries a semantic contract version.
- Every domain event has an immutable `event_type` and integer `event_version`.
- Error `code` values are stable machine identifiers; `message` is client-safe explanatory text.

## Compatible changes

The following changes may remain in the same API major or event version:

- add an optional response or event field;
- add a read-only operation;
- add a new event type;
- add a new error code;
- clarify descriptions without changing semantics;
- relax a validation constraint when downstream security and accounting invariants remain intact.

Consumers must ignore unknown optional fields and fail safely on unknown state, event and error values.

## Breaking changes

The following changes require a new API major or event version:

- remove or rename a field, path, event or error code;
- change a field type, unit, precision, meaning or data classification;
- make an optional field required;
- narrow a previously accepted value;
- change authentication, authorization, idempotency or replay semantics;
- change a monetary amount from one asset, scale or representation to another;
- change the fact represented by an existing event type;
- move a capability between customer and operator trust boundaries.

## Deprecation

1. Publish the replacement contract before deprecating the old contract.
2. Record owners, affected consumers and an evidence-based retirement date.
3. Support both contracts through the approved compatibility window.
4. Instrument consumer adoption without logging PII, credentials or raw provider payloads.
5. Remove the old contract only after consumers, reconciliation and rollback procedures are verified.

There is no automatic production deprecation window in the draft phase. Legal, MLRO, Product, Security and service-owner gates remain required where the change affects regulated scope.

## Event evolution

- Producers must write through an outbox in the same transaction as authoritative state.
- Consumers must deduplicate by `event_id` and tolerate redelivery.
- Reprocessing must preserve the original event identity and payload.
- New required information is introduced in a new `event_version`.
- Old and new versions run in parallel until every registered consumer is verified.
- Events record completed facts; they never substitute for policy approval or command authorization.

## Review gates

Every contract pull request must:

- pass the dependency-free contract checker;
- identify whether the change is compatible or breaking;
- document security, ledger, custody, compliance and migration impact when applicable;
- include synthetic examples without raw PII or credentials;
- preserve `contract-only` boundaries until the corresponding runtime phase is approved.
