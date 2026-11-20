# OPEX Vehicle Booking — MyGeotab Native Add-In

**Status:** code-level implementation (Phases A–I of `docs/mygeotab-native/`), **not tenant-validated and not production-ready.** Every live capability is disabled by default.

## Architecture (target)

A MyGeotab **Custom Page Add-In**: React + TypeScript, the MyGeotab API, and **AddInData as the only persistent application storage**. There is **no external application database and no external application backend** (no PostgreSQL, Hono, Cloudflare Worker, or external auth). Hosting is static HTTPS files only.

```text
MyGeotab page → Add-In (apps/web) → gated MyGeotab api → AddInData
                     └ offline simulation (dev only, separate entry, never in the production build)
```

Safety defaults (all in code, not settings):

- Six capability gates, all `false`: `MYGEOTAB_IDENTITY_ENABLED`, `MYGEOTAB_STORAGE_ENABLED`, `LIVE_BOOKING_READ_ENABLED`, `LIVE_BOOKING_WRITE_ENABLED`, `APPROVAL_ACTIONS_ENABLED`, `ADMIN_CONFIGURATION_ENABLED`.
- `APPROVED_TENANT_CONTEXTS` is empty, so every tenant is denied.
- No UI, URL, storage, environment or role can enable a capability; there is no automatic live mode.
- OPEX roles (requester / approver / administrator) come only from an administrator-controlled mapping; missing mapping means no access. These checks are **client-side policy, not server-enforced security.**

See `docs/mygeotab-native/` for the audit, per-phase documentation, findings, blockers and the sandbox validation plan.

## Repository layout

```text
apps/web/    React Add-In (production entry: src/main.tsx; dev-only simulation entry: src/simulationMain.tsx)
apps/api/    LEGACY Hono/Worker/PostgreSQL scaffold — isolated, not the target (see apps/api/LEGACY.md)
db/          LEGACY PostgreSQL migrations — preserved, do not run
geotab/      Example Add-In configuration files (verify against the tenant before use)
docs/        docs/mygeotab-native/ = current documentation; other files are historical (some marked LEGACY)
```

## Commands

Requires Node.js 22+ and npm.

```bash
npm install
npm run dev          # web dev server (production-style native entry; the MyGeotab api is absent outside MyGeotab)
npm run typecheck    # TypeScript check of the web app
npm test             # web unit, service add-in and architecture tests
npm run build        # builds the native Add-In (dist: index.html + assets + serviceAddin.js)
```

Offline simulation (development only, local demo data, no MyGeotab access): open `/simulation.html` on the dev server. To include it in a build, set `OPEX_INCLUDE_SIMULATION=1`; the default build never contains it.

Legacy backend (not part of the default workflow): `npm run legacy:typecheck`, `npm run legacy:test`, `npm run legacy:dev:api`, `npm run legacy:db:migrate`. Do not use them for the native Add-In.

## Deployment

Do not deploy or register until sandbox validation passes. Static hosting only; see `docs/mygeotab-native/deployment-and-registration-guide.md` and `docs/mygeotab-native/sandbox-validation-plan.md`. The GitHub Pages workflow builds and publishes only the static Add-In assets and configures no backend.

## Known open items

Role enforcement against direct API calls, AddInData behaviour (details format, limits, concurrency), Service Add-In worker format and delivery, vehicle/driver field availability, and booking double-booking protection are **unproven** and need a MyGeotab sandbox. See `docs/mygeotab-native/remaining-blockers.md`.
