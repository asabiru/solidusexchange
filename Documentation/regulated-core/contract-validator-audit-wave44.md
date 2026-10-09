# Contract Validator Audit — Wave 44 — Proposed

- Status: Proposed
- Scope: `packages/api-contracts` (`openapi.yaml`, `scripts/check-contracts.mjs` — schema pins, `verifyMoneyFieldSchemas`, `verifySafeFields`, parameter/response machinery) and `packages/customer-api/tests/contract-validator.mjs` plus the `conformanceErrors` path used by `contract-conformance`/`contract-coverage` tests.
- Production effect: none

## Scope reviewed

- `openapi.yaml` consumers and pins: operation surface, canonical parameters, components (schemas/parameters/headers/responses/securitySchemes), planned namespaces.
- `check-contracts.mjs` guards: `verifyReferences`, `verifyNoExtensions`, `verifyMoneyFieldSchemas`, `verifySafeFields`, `verifyCanonicalHeaderParameters`, `verifyRequestIdResponseHeader`, event envelope/PII/closed-schema machinery.
- `contract-validator.mjs`: dependency-free JSON-Schema subset used by the customer-api conformance harness — keyword set, `typeMatches`, `conformanceErrors`.
- Conformance/coverage harnesses: `checkedRequest` → `assertConforms` → `conformanceErrors`, the `observed` set and `CONTRACT_GAP_STATUSES`.

Hunt list applied: unsupported or silently-tolerated schema keywords; validator paths that skip (response bodies, headers, parameters); conformance sampling; name-suffix heuristics a field can dodge; fail-closed helpers satisfied by a subset.

## Defects found and fixed

### 1. `verifySafeFields` exact-match let prohibited names hide behind suffixes (`check-contracts.mjs`)

The prohibited-field set (`password`, `secret`, `api_key`, `email`, `phone`, `access_token`, ...) was matched with `key.toLowerCase()` equality. `client_secret`, `access_token_id`, `phone_number`, `email_address` all passed untouched — a field could carry a prohibited payload while its name looked compliant.

Fix: substring matching (`name.includes(field)`). Regression fixtures: `client_secret` and `access_token_id` added under `openapi.$defs` — previously green, now rejected as prohibited fields. `customer_email`/`phone_number` event fixtures now surface the dedicated PII rejection first (PII check moved ahead of the broader safe-field scan; message updated from `prohibited field` to `PII-like property`).

### 2. Money-field convention dodgeable by naming (`check-contracts.mjs`)

`allowedMoneyFieldSchemas` only recognized names containing `amount` plus `asset`/`currency`/`network` suffixes. `unit_price`, `grand_total`, `network_fee`, `balance`, `rate` etc. escaped the decimal-amount convention — a `{ type: "number" }` or bare `{ type: "string" }` stayed green.

Fix: boundary-matched money words (`price`, `rate`, `fee`, `cost`, `sum`, `balance`, `tax`, `commission`, `premium`, `discount`, `payout`, `notional`, `principal`, `interest`, `spread`, `margin`, `leverage`, `quantity`, `volume`, `qty`, plus `total` by substring) map to `#/$defs/decimalAmount`. Regression: `unit_price`/`grand_total`/`network_fee` fixtures rejected; the existing tolerance fixtures (`settlement_amount`, `refund_network`, `fee_currency`, `fee_bps`, `price_observed_at`-style names) still pass.

### 3. Per-operation error-status set and reference were unpinned (`check-contracts.mjs`)

Non-2xx responses were validated structurally (Error schema + `X-Request-Id` header) but not *which* statuses an operation declares nor *which* canonical component each status uses. An operation could grow a `503`, drop its `429`, or retarget `401` to the generic `InternalError` component while every check stayed green.

Fix: `pinnedResponseStatuses` pins the exact status set per operationId; every non-2xx response must be a pure `$ref` to the canonical component for that status (`canonicalErrorResponses`). Regressions: added `503`, dropped `429`, retargeted `401` fixtures.

### 4. `components` containers and `Retry-After` were driftable (`check-contracts.mjs`, `openapi.yaml`)

`components.schemas`, `components.responses`, `components.parameters`, `components.headers`, `securitySchemes` and the `components` key set itself were never pinned as sets — extra members (e.g. a `SneakyView` schema or a third bearer scheme) sailed through. Worse, `components.responses.RateLimited` only had its `X-Request-Id` header pinned: deleting the declared `Retry-After` header from the contract passed, and the header's own `required: false` meant conformance never demanded the service actually send it.

Fix: exact `sameSet` pins on every components container plus per-response header sets (`RateLimited` = `Retry-After` + `X-Request-Id`, all others = `X-Request-Id`); `RetryAfter` pinned as `required: true` with the positive-integer schema, and `openapi.yaml` updated to `required: true` (the service already sends `Retry-After: 60` on every 429). Regressions: deleted `Retry-After`, optional `Retry-After`, extra `SneakyView` fixtures. The container pins run last so dedicated member checks keep their dedicated rejections.

### 5. `/api/v1/meta` authentication was unasserted (`check-contracts.mjs`)

Non-meta operations pin their bearer scheme; the metadata operation's `security` field was ignored — adding `CustomerBearer` or deleting the explicit `security: []` passed silently.

Fix: `canonicalJson(operation.security) === "[]"` pinned for `/api/v1/meta`. Regressions: authenticated metadata, missing `security` fixtures.

### 6. Non-canonical parameters tolerated a non-boolean `required` (`check-contracts.mjs`)

`required: "yes"` (or `1`) on an extra parameter survived — `!== true` treated it as optional, while contract consumers could read it as required.

Fix: non-pinned parameters must be `required: true` (still rejected by the canonical-parameter pin) or explicitly optional — `required` absent or `false`. Regressions: `required: "yes"` rejected; `required: false` on an optional query parameter stays green (new acceptance fixture).

### 7. Test validator could not evaluate the contract's own nullable type (`contract-validator.mjs`)

`typeMatches` only handled string types; the contract's sole union — `CheckView.resolved_at: ["string", "null"]` — threw `Unsupported schema type` if any check view were ever conformance-checked.

Fix: `declaredTypes` allows `[X]` and `[X, "null"]` unions (fail-closed on anything else: empty, dupes, >2 members, two non-null types, non-string members all throw `Malformed schema keyword`). Regression: canonical `CheckView` validates with `resolved_at` `null`, a valid timestamp, and rejects `5`/`"soon"`.

### 8. Malformed keyword values silently unenforced (`contract-validator.mjs`)

`minLength: "abc"`, `maximum: {}`, `pattern: 5`, `additionalProperties: "no"`, `uniqueItems: "yes"`, `properties: 5`, `required: "field"`, `enum: "x"`, `items: "x"` — each either coerced into a nonsense constraint that matched everything or was silently skipped, so a schema *looked* strict but was enforced as `any`. Non-finite numbers (NaN/Infinity from programmatic callers) also passed bounds-only schemas.

Fix: `assertKeywordShapes` throws `Malformed schema keyword` for non-integer bounds, non-finite/non-numeric `minimum`/`maximum`, non-string `pattern`/`format`/`$ref`, non-array `enum`/`required`, non-object `properties`/`items`, non-boolean `additionalProperties`/`uniqueItems` (object `additionalProperties` schemas still work), and non-finite numbers now report `non-finite number`. Regression test asserts throws for every malformed shape.

### 9. Templated contract paths never resolved; path parameters never enforced (`contract-validator.mjs`)

`conformanceErrors` looked up `contract.openapi.paths[path]` by literal key only. Any response on `/api/v1/customer/checks/{checkId}` — the one templated namespace — hit the `undeclared` branch, so only gap statuses (400/404) were tolerated; a real `200` check view was reported as *undeclared*, and conversely `/api/v1/customer/checks/ABC` (invalid `CheckId`) was indistinguishable from a real check id.

Fix: `operationFor` resolves templated paths per segment; every captured path parameter is validated against its declared schema (`CheckId`'s `syn_check_` pattern). A parameter that fails its schema means the path is not the operation — it stays undeclared. Regressions: `200` + valid `CheckView` on the instantiated path now conforms, a `status` enum violation inside it is reported, and `checks/ABC` + `200` still reports `undeclared status 200`.

### 10. Declared json response without a schema passed unchecked (`contract-validator.mjs`)

`if (schema)` skipped body validation entirely — a response declaring `application/json` but no `schema` let any body through.

Fix: a declared `application/json` media type without a schema now reports `declared application/json response must declare a schema`.

### 11. Non-object error body crashed the checker (`contract-validator.mjs`)

`parsed.value.request_id` on a `null`/`array` body threw a `TypeError` instead of reporting contract violations — a malformed error body produced a crash, not an error list.

Fix: `>= 400` envelope checks run only when `parsed.value` is an object; the schema check already reports `expected object`. Regression: `500` with `null`/`[1]` bodies report `expected object`, no throw.

## Deliberately unchanged

- `CONTRACT_GAP_STATUSES` (400/404): gap responses must still carry the error envelope; unchanged.
- Acceptance fixtures (deliberate tolerances): optional non-pinned parameters, optional canonical money fields, closed optional event payload objects, description edits — all still green (tolerance locks verified).
- Conformance coverage of served operations, gating and header presence: unchanged; templated-path resolution only makes the previously dead `checks/{checkId}` checks live.
- `Retry-After` remains a hint contract (`429` always includes it now by contract; service already did).

## Validation

- `packages/api-contracts`: `npm test` — 253/253 pass (incl. 17 new boundary fixtures).
- `packages/customer-api`: `npm run check`, `node --test tests/*.test.mjs` — 196/196 pass (incl. 8 new validator regressions).
- Old checker (main) run against a contract carrying every new drift fixture — all passed on main, all rejected on branch.
- `check-verification-integrity.mjs` baseline recomputed for the three touched test files.
