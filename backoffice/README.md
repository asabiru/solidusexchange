# SolidChange backoffice

Wave 2 starts as an independently built operator frontend inside the repository. It is not imported by the customer Laravel application and is intended for a separate origin, deployment and session boundary.

## Current boundary

- `dev-dry-run` is the only accepted runtime mode.
- All data is synthetic and exposed only through the read-only BFF.
- OIDC uses Authorization Code with PKCE; OIDC tokens remain in the BFF.
- Operator roles and capabilities are mapped and enforced server-side.
- The BFF issues a short-lived `HttpOnly`, `SameSite=Strict` session cookie.
- Read-only API envelopes are signed with an ephemeral Ed25519 key and bound to their resource.
- Audit events form a verified SHA-256 chain behind an async store contract.
- PostgreSQL mode verifies schema version and the complete chain before the BFF listens.
- PostgreSQL events reject update, delete and truncate; appends are serialized and stale heads fail closed.
- Audit reads, approval anchors and signed evidence exports use a newly verified store snapshot.
- Memory mode remains an explicit non-durable local default and is labelled as such in health/UI.
- Approval command previews are digest-bound, same-origin, capability-gated and side-effect-free.
- Preview policy exposes evidence readiness, maker-checker separation, required approvers and step-up MFA status.
- Customers 360, KYC/KYB and AML/KYT screens expose synthetic risk, screening, evidence and linked-approval records.
- Customer-risk endpoints are separately capability-gated; Support L1 is denied KYC and AML case access.
- KYC, sanctions, PEP and KYT records contain no raw identity documents or provider payloads.
- Every preview remains non-executable because no protected command client exists.
- No financial, custody, KYC, AML, provider or customer command client exists.
- Navigation and actions are deny-by-default through explicit role capabilities.
- Approve and privileged execution controls remain disabled.
- Evidence export is read-only, signed, capability-gated and contains the verified chain head.
- The customer application, legacy admin routes and operator frontend do not share browser storage or frontend bundles.

## Commands

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=moderate
npm run dev
```

`npm run dev` starts Vite on port `4173` and the loopback BFF on port `4174`. It enables the synthetic dev-session endpoint only for configured loopback origins.

## Durable audit storage

Memory mode is the explicit local default:

```text
BACKOFFICE_AUDIT_STORAGE=memory
BACKOFFICE_AUDIT_RETENTION_DAYS=2555
```

PostgreSQL mode has no fallback. Apply the migration with a migration identity, then configure the BFF:

```bash
psql "$BACKOFFICE_AUDIT_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f migrations/0001_append_only_audit.sql
```

```text
BACKOFFICE_AUDIT_STORAGE=postgresql
BACKOFFICE_AUDIT_DATABASE_URL=postgresql://...
BACKOFFICE_AUDIT_RETENTION_DAYS=2555
```

Grant the runtime identity only:

```sql
GRANT USAGE ON SCHEMA backoffice_control TO backoffice_runtime;
GRANT SELECT ON backoffice_control.audit_schema TO backoffice_runtime;
GRANT SELECT, INSERT ON backoffice_control.audit_events TO backoffice_runtime;
```

Replace `backoffice_runtime` with the deployment role. It must not receive `UPDATE`, `DELETE` or `TRUNCATE`. Verified TLS is mandatory; URL-level SSL overrides are ignored. Missing schema, incompatible schema version, unavailable storage, duplicate event IDs, stale heads and invalid chains prevent verified audit responses.

`BACKOFFICE_AUDIT_RETENTION_DAYS` records a minimum retention boundary on every append. Slice 5A does not provide deletion or cleanup. The default is a development baseline, not a legal retention determination for a live deployment.

## OIDC configuration

Configure all required values together; partial OIDC configuration fails startup:

```text
BACKOFFICE_OIDC_ISSUER
BACKOFFICE_OIDC_AUTHORIZATION_ENDPOINT
BACKOFFICE_OIDC_TOKEN_ENDPOINT
BACKOFFICE_OIDC_JWKS_URI
BACKOFFICE_OIDC_CLIENT_ID
BACKOFFICE_OIDC_REDIRECT_URI
BACKOFFICE_OIDC_ROLE_MAP_JSON
```

Optional values:

```text
BACKOFFICE_OIDC_CLIENT_SECRET
BACKOFFICE_OIDC_ROLE_CLAIM
BACKOFFICE_ALLOWED_ORIGINS
BACKOFFICE_BFF_HOST
BACKOFFICE_BFF_PORT
BACKOFFICE_SESSION_TTL_SECONDS
BACKOFFICE_AUDIT_STORAGE
BACKOFFICE_AUDIT_DATABASE_URL
BACKOFFICE_AUDIT_RETENTION_DAYS
```

`BACKOFFICE_OIDC_ROLE_MAP_JSON` maps external groups to the explicit operator-role allowlist. Example:

```json
{"solidchange-compliance":"compliance-lead","solidchange-support":"support-l1"}
```

The startup-generated signing key and synthetic seed data remain intentionally dev-only. PostgreSQL persistence alone does not make the evidence production-ready; independent trust, key custody, rotation, backup/restore validation and approved retention policy remain required.

## Next slices

1. Slice 5B: step-up MFA challenge lifecycle, replay protection and signing-key lifecycle.
2. Investigations/Fraud workflows.
3. Provider adapter contracts and operator commands, only after separate security and regulatory approval.
