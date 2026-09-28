# SolidChange backoffice

Wave 2 starts as an independently built operator frontend inside the repository. It is not imported by the customer Laravel application and is intended for a separate origin, deployment and session boundary.

## Current boundary

- `dev-dry-run` is the only accepted runtime mode.
- All data is synthetic and exposed only through the read-only BFF.
- OIDC uses Authorization Code with PKCE; OIDC tokens remain in the BFF.
- Operator roles and capabilities are mapped and enforced server-side.
- The BFF issues a short-lived `HttpOnly`, `SameSite=Strict` session cookie.
- Read-only API envelopes are signed with an ephemeral Ed25519 key and bound to their resource.
- Audit events form an immutable in-memory SHA-256 chain returned through a signed read-only envelope.
- Approval command previews are digest-bound, same-origin, capability-gated and side-effect-free.
- Preview policy exposes evidence readiness, maker-checker separation, required approvers and step-up MFA status.
- Every preview remains non-executable because no protected command client exists.
- No financial, custody, KYC, AML, provider or customer command client exists.
- Navigation and actions are deny-by-default through explicit role capabilities.
- Approve, export and privileged execution controls remain disabled.
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
```

`BACKOFFICE_OIDC_ROLE_MAP_JSON` maps external groups to the explicit operator-role allowlist. Example:

```json
{"solidchange-compliance":"compliance-lead","solidchange-support":"support-l1"}
```

The startup-generated signing key and synthetic in-memory audit chain are intentionally dev-only. A later production slice must define durable append-only storage, independent trust, key custody and rotation before these records can serve as production evidence.

## Next slices

1. Customers, KYC and AML case workflows.
2. Durable audit storage and a real step-up MFA provider.
