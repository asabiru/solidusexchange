# Backoffice Authorization Audit — Wave 42 — Proposed

- Status: Proposed
- Scope: `backoffice/src/auth/access.ts` (`roleProfiles`, the `Capability` union, `can`/`findRole` semantics), every capability-gate call site in `backoffice/src/server/**`, and the role-assignment paths (dev-session, OIDC `mapRole`, `BACKOFFICE_OIDC_ROLE_MAP_JSON` parsing)
- Production effect: none

## Scope reviewed

- `backoffice/src/auth/access.ts` — the 17-member `Capability` union, five `RoleProfile` rows (one per `OperatorRole`), `findRole` exact-match lookup and the `can` membership check.
- `backoffice/src/server/server.ts` — every guarded route requires `authorized(request, response, capability)`: all 18 call sites, the dev-session endpoint and its `validRoles` set, `currentSession` device binding, `createSession` session replacement.
- `backoffice/src/server/session.ts`, `oidc.ts` (`mapRole`), `config.ts` (`parseRoleMap` and the `roles` set), `subjects.ts` (`subjectTimelineKindCapability`, `readableSubjectKinds`), `step-up.ts` (binding fields; no grant replays), `observability.ts` (loopback metrics gate), `request-body.ts`, `security-headers.ts`.
- `backoffice/src/app/navigation.ts` and `App.tsx` — client-side gating lists (advisory only; the server enforces every read).

Hunt list applied: route capabilities that no profile holds (dead routes) or typo'd literals, set-membership looseness (wildcard, prefix, substring or case matching), `can` evaluated on the wrong object (session vs request, a client-supplied role), capability strings crossing domains, demo-login bindings that bypass `roleProfiles`, a capability check invoked after response bytes were written, and identity or role taken from request headers or a second cookie.

## Defects found and fixed

None. No exploitable authorization defect was found in scope; this wave adds pin tests and records observations.

## Verified clean

- Route capability matrix: all 18 gate call sites use a literal from the `Capability` union, and each of the 16 distinct literals is held by at least one role — no dead route and no typo'd literal exists. The single uncapped call is `/bff/api/session`, which requires authentication only. Every guarded route requires the gate before its first response write, and POST handlers additionally require `exactOrigin` first.

```
route -> capability (each held by at least one role)
dashboard           = dashboard:read
customers           = customers:read
checks + detail     = checks:read
support + detail    = support:read
withdrawals+detail  = custody:read
subject feed        = subjects:read
kyc                 = kyc:read
aml                 = aml:read
investigations      = investigations:read
fraud-alerts        = fraud:read
maker-checker queue = approvals:read
audit feed          = audit:read
audit export        = audit:export
reports + export    = reports:read
step-up begin/verify = approvals:step-up
maker-checker dryrun = approvals:preview
```

- Set semantics: `can` performs `capabilities.includes(capability)` — an exact string match over the role's own list — so no wildcard, prefix, substring or case-insensitive membership can widen a role. `findRole` compares `profile.id === role` and an unknown role yields `undefined`, which `can` converts to a denial (deny by default).
- Session-vs-route confusion: the gate always resolves the session through `currentSession(request)` — the opaque `solidchange_bo_session` cookie id into the server-side `ExpiringStore` — and evaluates `can(session.role, capability)`; the client's requested role, path params, query and body never reach `can`. `/bff/api/session` returns `profile.capabilities` from `findRole(session.role)`, so the client-visible capability list cannot diverge from the server's.
- Role assignment: the dev-session endpoint requires `allowDevLogin`, a loopback BFF host, a loopback peer and an exact loopback `Origin`, then checks `validRoles` plus `findRole` before `createSession` — a role outside `roleProfiles` cannot mint a session, and `subject`/`email`/`name` come from the profile row rather than the request body. OIDC `mapRole` collects mapped roles via `Object.hasOwn(roleMap, group)` (inherited names never match), validates each with `findRole`, and yields a session only for exactly one mapped role; `parseRoleMap` rejects non-string or out-of-table values at startup. Both paths end at `createSession`, which deletes the previous session id and any session sharing the device, so a stale role cannot persist next to the new one.
- Capability domains: every `subjectTimelineKindCapability` entry maps a timeline kind to the exact capability guarding that domain's own route (withdrawal requires `custody:read`, audit requires `audit:read`, and so on), and `readableSubjectKinds` intersects through `can`, so a subject feed cannot exceed the caller's per-domain reads; audit entries join only through resolved entity refs and customer ids.
- Identity spoofing: no request header (`x-operator*`, `x-role`, `operator`, and friends) or alternate cookie name is ever read for identity — the role comes only from the server-side session object. Device binding compares `session.deviceId` to the `solidchange_bo_device` cookie against the configured digest list, so a stolen session cookie without its device cookie stays unauthorized in enforce mode.
- Step-up: `SyntheticStepUpService` binds `sessionId`, `subject`, the required `approvalId`, `commandDigest` and `auditHeadHash` with exact equality, prunes binding indexes, and no grant verifies more than once — no grant can verify for another operator or another session.

## Observations (recorded, not defects in this slice)

- No route requires `approvals:review`, though compliance-lead holds it — a reserved capability for a future review-verdict surface. The maker-checker read surface instead requires `approvals:preview`, and the challenge/verify routes require `approvals:step-up`.
- The role set is declared three times: the `OperatorRole` union plus `roleProfiles` in `access.ts`, `validRoles` in `server.ts`, and `roles` in `config.ts`. The copies agree today and each path fails closed on disagreement (dev-session 400, role-map startup error), but a role added to `roleProfiles` alone would stay unreachable on both assignment paths — the new tests pin all three copies against `roleProfiles`.
- `roleProfiles` and the two role sets are mutable module state (`readonly` types only); no request path mutates them, so this is hygiene rather than a defect.
- The subject-timeline route resolves refs across all domains before filtering; the existence oracle this creates was already documented in wave 39, and every `subjects:read` holder also holds `customers:read`, so the oracle stays inside an already-listed data set.
- `auditHeadHash` in the step-up binding makes an outstanding challenge stale whenever the audit head moves — fail closed by design.

## Test additions

- `backoffice/src/server/authz.test.ts` (+8 cases): source-scan of every gate call site — each literal is held by at least one role, the enforced set equals the pinned 16-capability route matrix, and exactly one uncapped call exists; `can` exact-match negatives (prefix, case, whitespace, wildcard, comma lists, `__proto__`/`constructor` roles); `roleProfiles` id and per-role capability uniqueness; a literal pin of `subjectTimelineKindCapability` (catches domain-confused remapping that role-level tests cannot see when both capabilities are co-held); every `roleProfiles` role mints a dev session and reports its own profile name and capability list; dev-session rejects out-of-table roles (case variants, whitespace, `__proto__`, `constructor`, `toString`, empty); every declared role loads as an OIDC role-map target while out-of-table values throw at startup; identity headers and alternate cookie names never mint or escalate a session.
