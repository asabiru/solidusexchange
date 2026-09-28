# SolidChange backoffice

Wave 2 starts as an independently built operator frontend inside the repository. It is not imported by the customer Laravel application and is intended for a separate origin, deployment and session boundary.

## Current boundary

- `dev-dry-run` is the only accepted runtime mode.
- All data is synthetic and loaded through read-only repository interfaces.
- No financial, custody, KYC, AML, provider or customer command client exists.
- Navigation and actions are deny-by-default through explicit role capabilities.
- Approve, export and privileged controls are disabled until authenticated command APIs, step-up MFA and maker-checker enforcement exist.
- The customer application, legacy admin routes and operator frontend do not share browser storage or frontend bundles.

## Commands

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

The dev server listens on port `4173`.

## Next slices

1. OIDC/SSO callback and short-lived operator session BFF.
2. Signed read-only dashboard, customer and approval query APIs.
3. Immutable audit envelope and protected command preview.
4. Step-up MFA and independent approver policy.
