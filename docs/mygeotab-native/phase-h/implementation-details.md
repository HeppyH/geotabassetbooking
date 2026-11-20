# Implementation Details
## Dependency inventory (found before changing anything)
- Web → API: one type-only import in `apps/web/src/data/types.ts` (`../../../api/src/integrations/mygeotab/types`). Web `package.json` depends only on react/react-dom (no Hono, pg, wrangler).
- Root: `workspaces` included `apps/api`; `build` ran the API typecheck; `test` ran only the API tests; `dev:api` and `db:migrate` were top-level.
- CI: one job ran everything including `npm test` (API) and installed all workspaces. Pages: passed `VITE_API_BASE_URL` (unused by any web source) and ran the legacy `npm test`.
- `.env.example`, README and `docs/DEPLOYMENT.md`/`ARCHITECTURE.md`/`GITHUB_PAGES.md` described the Worker + Neon design.
## Changes
1. Types moved to `apps/web/src/data/geotabTypes.ts`; `data/types.ts` imports it.
2. Root scripts: `dev`, `dev:web`, `build`, `test`, `typecheck` (web only); `legacy:dev:api`, `legacy:typecheck`, `legacy:test`, `legacy:db:migrate`. Removed top-level `dev:api` and `db:migrate` (renamed — anyone using the old names must switch).
3. `ci.yml`: job `native-addin` (web workspace only: typecheck, tests incl. service add-in and architecture, build) and job `legacy-backend` (API typecheck + tests).
4. `deploy-pages.yml`: installs web only, runs web tests, builds the native Add-In, no API env var, no secrets.
5. `apps/web/.env.example`: API URL lines removed.
6. `README.md` rewritten for the native architecture with an explicit legacy section.
7. `apps/api/LEGACY.md` marker added; LEGACY banners on `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `docs/GITHUB_PAGES.md` (partly).
8. Deliberate test change: `apps/api/test/deployment-config.test.mjs` previously asserted that the Pages workflow wires `VITE_API_BASE_URL`; it now asserts the opposite (no API URL, no secrets). Reason: Phase H requirement to remove unused backend variables. This reflects a decision change, not a weakened check of existing behaviour.
## Tests added (`runtimeArchitecture.test.mjs`)
No `apps/api` imports in the web app; default scripts don't touch legacy code and legacy scripts are prefixed; native CI job and Pages workflow contain no backend/database/API-URL configuration; no API URL in frontend source/config; legacy backend preserved and README states the architecture.
