# Legacy Backend Dependency Inventory and Disposition

Evidence labels: [CODE] [TEST]. **Nothing was deleted, archived, moved or edited in Phase A.** Classification: `ACTIVE_TARGET`, `ISOLATED_LEGACY`, `DOCUMENTATION_ONLY`, `UNUSED_CANDIDATE`, `REQUIRES_DECISION`. Disposition: `RETAIN_ISOLATED`, `ARCHIVE`, `REMOVE_AFTER_APPROVAL`, `REQUIRES_FURTHER_REVIEW`. Where evidence is insufficient, `RETAIN_ISOLATED` is recommended.

## 1. Runtime dependency verdict

The web app does **not** call the legacy API at runtime [CODE][TEST]: no `fetch`/HTTP client exists under `apps/web/src`; the production bundle contains no Worker host or API URL. The only code coupling is one `import type` (erased at build) in `apps/web/src/data/types.ts` pointing at `apps/api/src/integrations/mygeotab/types`. The legacy stack is nevertheless **wired into the default scripts, CI and the Pages workflow**, so it can easily become the accidental default workflow.

## 2. Inventory

| Component | Location / evidence | Classification | Recommended disposition | Notes |
|---|---|---|---|---|
| Hono API (Cloudflare Worker) | `apps/api/src/index.ts`, `auth.ts`, `env.ts`, `db.ts` | ISOLATED_LEGACY | RETAIN_ISOLATED now; ARCHIVE after Phase H; REMOVE_AFTER_APPROVAL last | Holds domain rules worth porting: status transitions, `canApprove` (no self-approval), role lists, overlap |
| `hono` dependency | `apps/api/package.json` (also in lockfile) | ISOLATED_LEGACY | RETAIN_ISOLATED | Install pulls it for all workspaces |
| `postgres` driver | `apps/api/package.json`, `scripts/migrate.mjs` | ISOLATED_LEGACY | RETAIN_ISOLATED | |
| PostgreSQL schema / migrations | `db/migrations/0001_initial.sql`, `0002_reservation_slots.sql`, `0003_booking_workflow.sql` | ISOLATED_LEGACY | ARCHIVE candidate (keep history) | Contains design decisions (GiST exclusion slots, identity mappings, outbox). **Do not run**. No migrations were run in Phase A |
| Drizzle ORM | — | n/a | n/a | **Not present** anywhere in the repository (searched) |
| Wrangler / Cloudflare config | `apps/api/wrangler.toml`; devDeps `wrangler`, `@cloudflare/workers-types` | ISOLATED_LEGACY | RETAIN_ISOLATED | `[[hyperdrive]]` binding is commented out; `IDENTITY_ADAPTER_CONFIGURED` unset by default (fail-closed) |
| Migration runner | `scripts/migrate.mjs` | ISOLATED_LEGACY | RETAIN_ISOLATED (rename/relocate in Phase H) | Needs `DATABASE_URL`; exposed as root `db:migrate` |
| Legacy MyGeotab adapter | `apps/api/src/integrations/mygeotab/adapter.ts` | ISOLATED_LEGACY | RETAIN_ISOLATED; **do not port** | Design sends browser `sessionId` to an external backend via headers (`X-Geotab-Session-Id`); contradicts the native, no-external-backend goal. Several methods throw `GEOTAB_ADAPTER_NOT_IMPLEMENTED` |
| Legacy API tests | `apps/api/test/*.test.mjs` (65 tests) | ISOLATED_LEGACY | REQUIRES_FURTHER_REVIEW | Port overlap/transition/role cases to web domain tests; keep until ported |
| Root `package.json` scripts | `dev:api`, `db:migrate` | ISOLATED_LEGACY | RETAIN_ISOLATED, relabel in Phase H | |
| Root `test` script | runs **only** `apps/api` tests | REQUIRES_DECISION | Change in Phase H so default test = web | Currently default test path is legacy |
| Root `build` script | web build **plus** `apps/api` typecheck | REQUIRES_DECISION | Change in Phase H | |
| Root `dev:web` | web dev server | ACTIVE_TARGET | Keep | |
| CI `.github/workflows/ci.yml` | installs all workspaces; web tsc/test/build; `npm test` (API) | REQUIRES_DECISION | Split into target job and an explicit legacy job (Phase H) | |
| Pages deploy `deploy-pages.yml` | builds web and publishes `apps/web/dist` | ACTIVE_TARGET (static hosting permitted) | Clean in Phase H | Runs API tests via `npm test`; passes dead `VITE_API_BASE_URL`; uses `Copy-Item` under `pwsh` for the SPA fallback. **Not run in Phase A; no deployment performed** |
| `VITE_API_BASE_URL` | `.env.example`, workflow, README | UNUSED_CANDIDATE | REMOVE_AFTER_APPROVAL (config only) | Unused by web source |
| `VITE_GEOTAB_DATABASE` | `.env.example`, workflow; read in `App.tsx` as a UI label | ACTIVE_TARGET (label only) | Keep; ensure it is never a security gate | |
| `APP_ENV`, `ALLOWED_ORIGIN`, `GEOTAB_DATABASE`, `DATABASE_URL`, `IDENTITY_ADAPTER_CONFIGURED`, Hyperdrive binding `DB` | `apps/api/src/env.ts`, `wrangler.toml`, `.dev.vars.example` | ISOLATED_LEGACY | RETAIN_ISOLATED | |
| Web→API type import | `apps/web/src/data/types.ts` line 3 | REQUIRES_DECISION | Fix in Phase H (move shared types into web) | Without this, removing `apps/api` breaks `tsc` |
| Hybrid provider | `apps/web/src/data/mygeotabProvider.ts` | UNUSED_CANDIDATE | REMOVE_AFTER_APPROVAL (Phase C/H) | Dead code with a hidden-fallback pattern (F-16) |
| Docs referencing legacy stack | 14 files in `docs/` (Cloudflare/Neon/PostgreSQL plans, readiness reports, DEPLOYMENT.md, ARCHITECTURE.md, etc.) | DOCUMENTATION_ONLY | RETAIN_ISOLATED / ARCHIVE under `docs/legacy/` after approval | Contain valuable historical decisions: do not delete |
| `README.md` | Describes PostgreSQL as authoritative; references missing `docs/PERSONAL-TESTING-ENVIRONMENT.md` | REQUIRES_DECISION | Rewrite in Phase H/I | Stale vs. web code (F-22) |

## 3. Overall recommendation

1. **Phase A–G:** `RETAIN_ISOLATED` for everything legacy. Make no deletions.
2. **Phase H:** decouple types; make `dev`, `test`, `build`, CI and Pages default to the web/native target; relabel legacy scripts with a `legacy:` prefix and a CI job that is explicitly opt-in; add architecture tests that fail if the web bundle or source references Hono/PostgreSQL/Worker hosts or `apps/api` runtime code.
3. **After Phase I and written approval:** propose ARCHIVE (e.g., move to a `legacy/` folder or a tagged branch) and only then REMOVE_AFTER_APPROVAL, preserving historical decision docs.
4. **No component is classified "safe to delete" today.** Evidence of removal safety would require the local worktree state (see the baseline caveat).

## 4. Preconditions for any future removal
- Written approval; local Git state verified (not possible from the ZIP).
- Domain rules ported and covered by web tests.
- CI/CD and Pages workflows updated and passing without legacy workspaces.
- Historical docs preserved.
- No tenant, database or Cloudflare resources touched by the removal.
