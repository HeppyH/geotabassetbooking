# Deployment and Registration Guide

**Do not deploy or register anything until the sandbox plan has been executed and approved. This guide describes steps for a human; nothing here was performed, and no tenant was touched.**

## Build
```bash
npm install
npm run typecheck && npm test
npm run build            # output: apps/web/dist (index.html, assets/, serviceAddin.js)
```
The default build contains only the native entry. Do not set `OPEX_INCLUDE_SIMULATION`.

## Hosting
Static HTTPS hosting only (GitHub Pages workflow publishes `apps/web/dist`; nothing else). No API, database, Worker, or secret is required. Consider disabling source maps before production (`vite.config.ts`).

## Registration (manual, after sandbox approval)
1. Use a **sandbox/test** database, never the customer database first.
2. Review `geotab/opex-vbm-config.json` against the current Add-In configuration schema and menu path (UNVERIFIED for the tenant). The Service Add-In config (`opex-vbm-service-config.json`) must NOT be registered: the service is disabled and its build format is unverified.
3. Confirm the AddInId format and the fixed AddInId in `src/config/addinId.ts` is acceptable for the tenant.
4. Agree the security clearances (see sandbox plan) before any capability is enabled.

## Enabling capabilities (separately authorized code change)
Capabilities are literal constants in `src/runtime/capabilities.ts`; tenants are listed in `src/runtime/tenantContext.ts`. Enabling is a reviewed code change plus a new build, never a runtime setting. Order: identity → storage → read → (write, approval, admin only after the concurrency and clearance decisions). Do not enable all at once.

## Rollback
Remove the Add-In configuration in MyGeotab; AddInData records created by testing remain and must be cleaned up through an approved procedure.
