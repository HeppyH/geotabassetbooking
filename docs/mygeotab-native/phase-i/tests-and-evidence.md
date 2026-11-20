# Tests and Evidence

| Command | Result |
|---|---|
| `npm run typecheck` (web) | clean |
| `npm test` (web: 25 test files) | 304 pass / 0 fail |
| `npm run build` | succeeded; `dist` = `index.html`, `assets/`, `serviceAddin.js` (no `simulation.html`) |
| `npm run legacy:typecheck` | clean |
| `npm run legacy:test` | 65 pass / 0 fail (1 test deliberately updated in Phase H) |
| Bundle scan (`opex-vbm-demo`, `workers.dev`, `:8787`, `VITE_API_BASE_URL`, `LIVE (MyGeotab AddInData)`) | no matches |
| `npm audit --omit=dev --workspace apps/web` | 0 vulnerabilities (needs registry access) |
| `git diff --check` | **not possible** (no `.git`); a trailing-whitespace scan of new/changed web source and tests found none |
| Service Add-In tests | included in the web suite (`service-addin.test.mjs`) |
| GitHub workflows | **not executed** |

Growth of the web suite: 143 (baseline) → 201 (B) → 223 (C) → 240 (D) → 268 (E) → 281 (F) → 292 (G) → 296 (H) → 304 (I).

## Master prompt I.2 security list → tests
| Requirement | Test file(s) |
|---|---|
| No default live activation | capabilityGates, nativeRuntime, finalAcceptance |
| Missing identity denied | identityResolver (baseline), authzAndMasterData, finalAcceptance |
| Unknown tenant denied | tenantContext, nativeRuntime, finalAcceptance |
| Unauthorized approver denied | authzAndMasterData, bookingWorkflow |
| Unauthorized administrator denied | adminReports |
| Requester self-approval denied | authzAndMasterData, bookingWorkflow, finalAcceptance |
| Cross-user notification access denied | notificationsAudit |
| Malformed records rejected | storageEngine, finalAcceptance |
| Oversized records rejected | storageEngine, finalAcceptance |
| Offline mode cannot invoke live providers | simulationIsolation, runtimeArchitecture, finalAcceptance |
| Native failure cannot fall back to localStorage | nativeRuntime, finalAcceptance |
| No hidden external API dependency | runtimeArchitecture, finalAcceptance |

## I.3 architecture list → tests
No PostgreSQL/Hono/Cloudflare/external DB/auth/backend/persistence, no legacy fallback, no production demo mode: `runtimeArchitecture`, `finalAcceptance` (graph analysis, package dependency check, scripts/CI/Pages checks, bundle scan).

**All tests use isolated mocks. None is tenant validation.**
