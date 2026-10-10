# API Contracts Machinery Audit — Wave 49 — Proposed

- Status: Proposed
- Scope: `packages/api-contracts` internals — `scripts/check-contracts.mjs` (document loading, `$ref` resolution, canonicalization, closed-schema verification, example validator) plus the parsed artifacts it trusts (`openapi.yaml`, `schemas/error.schema.json`, `schemas/events/domain-event.schema.json`, `event-catalog.json`, `examples/domain-events.json`). Consumers checked for divergence: `packages/customer-api/src/contract.mjs`, `packages/customer-api/tests/contract-validator.mjs`, `contract-conformance.test.mjs`, `contract-coverage.test.mjs`, `.github/workflows/contracts-ci.yml`, `customer-api-ci.yml`.
- Production effect: none

## Package map

- `scripts/check-contracts.mjs` is the package's only executable: `npm run check` runs it directly; `npm test` = `check` + `node --test tests/*.test.mjs`.
- Document loading: `readContained` (realpath containment vs `rootReal`, symlink escape rejected), `loadAbsolute` (same check + `parsedFiles` cache keyed by normalized path), `readJson` (JSON over `readContained`). `openapi.yaml` is strict JSON syntax — `JSON.parse` succeeds — so YAML anchors, `<<:` merge keys and `on`/`yes`/`1.5` scalars are unreachable.
- Resolution: `resolveRef` splits on `#`, `resolvePointer` walks `#/`-fragments with `~1`→`/` then `~0`→`~` unescape (spec order). `verifyReferences` forbids scheme-prefixed, `//`, `%`-encoded and `\` refs, restricts siblings to `summary`/`description`, and key-caches `sourcePath:$ref` so cycles terminate.
- Canonicalization: `canonicalJson` (sorted-key serializer) backs every pin compare — response schemas, operation paths, response statuses, header parameters, error components, event contracts.
- `checkOpenApi()`: top-level field/info/server/tag pins, planned namespaces, security schemes, per-operation method/security/header/device-id/requestBody/response pins, `verifyReferences`, `verifyNoExtensions`, `verifyMoneyFieldSchemas` (+ snake_case property-name assert), `verifySafeFields`, container key-set pins.
- `checkErrorSchema()`: pins error.schema.json (code enum, message, request_id, details).
- `checkEvents()`: `payloadSchemas` extraction, envelope pins, `verifyPinnedEvents` (17 pinned contracts incl. canonical `allOf` conditions), catalog/example cross-validation, `verifyNoPiiPropertyNames`, `verifyNoNestedSchemaIdentifiers` (event schema only), `verifyClosedEventSchemas`, and `validateValue` on every example (envelope + resolved payload def).
- `checkCompatibilityPolicy()`: section pins on `COMPATIBILITY.md`.
- `tests/contract-boundary.test.mjs` (284 cases): scratch-copy + spawn harness; ~150 rejection fixtures + valid-input fixtures.
- No codegen exists in the package: `packages/customer-api/src/contract.mjs` is a hand-maintained frozen OPERATIONS table pinned to `openapi.paths` by `contract-conformance.test.mjs`; nothing injects schema text into generated artifacts.

## Defects found and fixed

All fixes live in `scripts/check-contracts.mjs`; every regression fixture was confirmed to PASS on main (`origin/main` checker) and is now REJECTED on this branch.

### 1. Duplicate JSON keys silently overwrite (loadAbsolute/readJson)

`JSON.parse` keeps the last duplicate key with no warning. A second `"description"` key inside `info` parsed silently green on main — any pinned surface could be shadowed by an unpinned twin, or vice versa, invisible to review.

Fix: `assertNoDuplicateKeys` scanner (checks `check-contracts.mjs:28`) tracks object context and rejects repeated keys on the decoded name, run by `parseJsonStrict` (`check-contracts.mjs:80`) inside `readJson` (`check-contracts.mjs:85`) and `loadAbsolute` (`check-contracts.mjs:126`) — covering every parsed artifact: `openapi.yaml`, `schemas/error.schema.json`, `schemas/events/domain-event.schema.json`, `event-catalog.json`, `examples/domain-events.json`, and every file reached through `$ref` resolution. Regressions: duplicate keys rejected in all five artifacts.

### 2. Planned-namespace key set unpinned (checkOpenApi)

`x-solidchange-planned-namespaces.customer` and `.operator` values were pinned exactly, but the key SET was not: a third namespace (`internal: ["/api/v1/internal/admin"]`) registered silently — precisely the "planned-namespace drift" class.

Fix: `sameSet(Object.keys(...), ["customer","operator"])` at `check-contracts.mjs:1026`. Regression: `internal` namespace rejected as `Planned namespaces`.

### 3. Duplicate operation parameters admitted (checkOpenApi)

`verifyCanonicalHeaderParameters` pins each parameter's canonical form but never checked uniqueness of the resolved `(in, name)` pair — OpenAPI requires it. `RequestId` pushed a second time onto an operation (or duplicated between path item and operation) passed green.

Fix: `verifyUniqueParameters` (`check-contracts.mjs:928`) dedupes the merged path-item + operation list after `$ref` resolution, lowercasing header names per HTTP semantics; called per operation at `check-contracts.mjs:1235`. Regressions: same-`$ref` duplication and path/operation cross-level duplication both rejected.

### 4. Multi-`#` `$ref` fragments silently truncated (resolveRef)

`reference.split("#", 2)` on `#/components/schemas/SessionView#junk` produced `["", "/components/schemas/SessionView"]` — the second fragment was dropped and the ref resolved to `SessionView` anyway, blessing a malformed reference consumers would reject.

Fix: `resolveRef` asserts at most one `#` (`check-contracts.mjs:132`). Regression: `#junk` suffix rejected as `Ambiguous $ref`.

### 5. Tilde-escaped `$ref` resolvable here but not downstream (verifyReferences)

`resolvePointer` unescapes `~1`/`~0`, so a def named `a/b` was reachable via `#/$defs/a~1b` inside this package — while `contract-validator.mjs`'s `resolve()` performs no unescaping and would fail to resolve the same ref. The package could bless a contract its own consumers cannot follow.

Fix: `~` joins `%` and `\` in the encoded-ref prohibition (`check-contracts.mjs:151`). Regression: `a~1b` ref targeting a `a/b` def rejected as `Encoded $ref is prohibited`.

### 6. Closed event schemas admitted internally inconsistent keywords (verifyClosedEventSchema)

The closed-schema keyword whitelist gated names but never cross-checked shapes or the declared `type`:

- `{type:"string", enum:["ok",5]}` — literal violating the declared type passed.
- `enum:"active"` — non-array enum skipped every literal check.
- `{type:"integer", minLength:1}`, `{type:"string", items:{...}}`, `{type:"integer", required:["x"]}`, `{type:"string", minimum:0}` — keywords applied to the wrong type family.
- `{type:"object", required:["missing"], properties:{}}` — unsatisfiable object (required ⊄ properties) passed.
- `required:["a","a"]` — duplicate required entries passed.
- `minimum:"1"`, `minLength:"x"` — coercible/malformed keyword values passed (validateValue would have compared `value >= "1"` by string coercion).
- `pattern:"[unclosed"` — a regex that never compiles stayed in the schema until an example happened to exercise it.

Fix (`check-contracts.mjs:1957-2055`): keyword shape asserts (`enum` non-empty unique-literal array, `required` unique string array, `minLength`/`maxLength`/`minItems`/`maxItems` non-negative integers, `minimum`/`maximum` finite numbers, `pattern`/`format`/`$ref` strings, `uniqueItems` boolean); pattern compile-check under the `u` flag; literal-vs-type cross-check when `type` is declared; keyword family checks (object/array/string/numeric keywords require the matching declared type); `required ⊆ properties` inside the object branch (`check-contracts.mjs:2051`). Regressions: one rejection fixture per bullet; `{type:"integer",enum:[1,2,3]}` and `{type:["string","null"],enum:["a",null]}` remain valid input.

### 7. Example validator diverged from the consumer engine (validateValue)

`validateValue` is what contract examples are actually judged by; it silently disagreed with `contract-validator.mjs` and JSON Schema semantics:

- `maxItems` never enforced (minItems was) — a 9-item array under `maxItems:8` passed.
- `minLength`/`maxLength` counted UTF-16 code units (`value.length`) vs the consumer's code points (`[...value].length`): 8 emoji counted 16 ≥ `minLength:16` passed; a 65-emoji (65 code points, 130 units) `idempotency_key` under `maxLength:128` was wrongly rejected.
- `new RegExp(pattern)` without `u` — `"a😀"` matched `^.{3}$` (3 units) but the consumer's `u`-flag engine sees 2 code points; conversely `^.{2}$` wrongly rejected.
- `format:"date-time"` via `Date.parse` admitted `"Jan 1 2024"` and `"2024-01-01"` — non-RFC3339 strings the strict consumer regex rejects.
- `uniqueItems` keyed `JSON.stringify` — key-order-equal objects `[{a:1,b:2},{b:2,a:1}]` counted unique here but duplicates under the consumer's canonical compare.

Fix (`check-contracts.mjs:1612-1640`): code-point length, `new RegExp(schema.pattern, "u")` (uuid/date-time regexes carry the flag too), strict RFC3339 date-time regex + finite `Date.parse` guard (mirrors the consumer), `maxItems` bound, `canonicalJson` for the uniqueItems set. Regressions: rejection fixtures for each divergence, plus acceptance fixtures for the two correct-but-formerly-rejected directions (astral strings within code-point bounds; `^.{2}$` on `"a😀"`).

### 8. Nested schema identifiers unguarded in the OpenAPI document (checkOpenApi)

`verifyNoNestedSchemaIdentifiers` ran only on the event schema. Extra `$defs` in `openapi.yaml` are deliberately allowed — and could carry `$id`/`$anchor`/`$dynamicRef` that a real JSON Schema engine would honor as retargeting bases while this flat resolver ignores them.

Fix: `verifyNoNestedSchemaIdentifiers(openapi, "OpenAPI")` before `verifyReferences` (`check-contracts.mjs:1475`). Regression: `$defs.extra.$id` rejected.

## Verified clean (negative-path coverage)

- **`$ref` cycles/aliasing**: `seen` keyed `sourcePath:$ref` terminates circular chains; resolved objects are never mutated, so no shared-schema mutation path exists. `assertAccepted` fixture: `cycle_a ↔ cycle_b` definitions complete without hanging.
- **Missing local pointers** still rejected (`missing JSON pointer`); remote/scheme-prefixed/percent-encoded/`\\` refs were already prohibited.
- **Canonicalization**: `canonicalJson` is deterministic — key-order-insensitive by design; semantically different schemas cannot collide canonically. All pin compares use it.
- **Planned vs served**: `paths:` key set and both planned-namespace value lists are pinned exactly; a planned path secretly served would break the paths pin, and a double-registration breaks the new key-set pin.
- **`__proto__`/`x-`/homoglyph property names**: rejected by the snake_case assert inside `verifyMoneyFieldSchemas` (existing fixtures).
- **Numeric bounds**: `minimum`/`maximum` guarded by `typeof value === "number"` in the validator — no string-vs-number coercion; `exclusiveMinimum`/`multipleOf` are in no allowed keyword set and unreachable.
- **Examples**: `additionalProperties:false` on payload defs still rejects undeclared fields (`unknown field` regression fixture kept).
- **Error schema**: its own keys are `sameSet`-pinned, so nested identifiers there are already unreachable.
- **Consumer validator** (`contract-validator.mjs`): already audited in wave 44; `resolve()`'s lack of `~`-unescaping is now harmless because `~` refs are prohibited package-wide.

## Verification

- `npm run check` + `npm test` in `packages/api-contracts`: green (284 boundary cases + 33 new machinery cases).
- New `tests/check-machinery.test.mjs`: 33 tests — 29 fail on `origin/main`'s checker, all 33 pass on this branch; the 4 remaining pass on both (negative-path and valid-input pins).
- `.github/scripts/check-verification-integrity.mjs` baseline: new test file registered (`minLines: 372, minCases: 2`).
