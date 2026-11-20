# Phase B — Implementation Summary

**Status: PHASE B COMPLETE — LIVE DISABLED** (see `remaining-blockers.md` for carried-over items)

## Source-control caveat
The baseline is the uploaded ZIP, which has no `.git`. The Git branch, HEAD, staged files and untracked files **cannot be verified**, and `git diff --check` could not be run. Changes were made on a copy of the ZIP baseline and compared with `diff -rq`. Nothing was committed or pushed. No existing user work could be checked for preservation beyond the ZIP content.

## Not validated live
No MyGeotab tenant was contacted. No AddInData was read or written. Nothing was deployed. All tests use isolated mocks. **Mocked tests are not tenant validation.**

## Objectives
| # | Objective | Result |
|---|-----------|--------|
| 1 | Centralized capability gates | `src/runtime/capabilities.ts` |
| 2 | Six live capability defaults false | frozen `DEFAULT_CAPABILITIES` / `PRODUCTION_CAPABILITY_CONFIG` |
| 3 | Explicit tenant context validation | `src/runtime/tenantContext.ts`, used by `nativeRuntime.ts` |
| 4 | Approved tenant allowlist empty | `APPROVED_TENANT_CONTEXTS = []` (frozen) |
| 5 | No automatic DEMO→LIVE switch | removed from `App.tsx` |
| 6 | No editable AddInId / mode controls in production UI | removed; replaced by a read-only status badge |
| 7 | Native runtime separated from offline simulation | `main.tsx`→`NativeHost`; `simulationMain.tsx`→simulation |
| 8 | Native failures never fall back to localStorage/mock | denied provider + no demo fallback in `App.tsx` |
| 9 | Simulation cannot reach live MyGeotab API | separate module graph; tests assert it |
| 10 | Existing booking functionality preserved | all 143 pre-existing web tests + 65 API tests pass unchanged |

## Files
New (`apps/web`): `src/runtime/{capabilities,tenantContext,appRuntime,gatedApi,nativeProvider,nativeRuntime,accessPolicy}.ts`, `src/runtime/NativeHost.tsx`, `src/auth/actorId.ts`, `src/simulation/simulationRuntime.ts`, `src/simulationMain.tsx`, `simulation.html`, and tests `capabilityGates`, `tenantContext`, `nativeRuntime`, `simulationIsolation`, `runtimeArchitecture` plus `test/helpers/mockGeotab.mjs`.

Modified: `src/main.tsx`, `src/ui/App.tsx`, `vite.config.ts`, `src/data/notificationService.ts` (page-side delivery inert), `src/serviceAddin.ts` (gated, no-op unless all flags true and tenant approved), `src/config/lifecycleDiagnostics.ts` (raw reads now gated; no localStorage), `src/auth/identityResolver.ts` (re-exports `getActorIdForMode` from `actorId.ts`).

Untouched: `apps/api`, `db/`, root scripts, CI, `data/addinDataProvider.ts`, `data/dataProvider.ts`, `data/mygeotabProvider.ts` (dead code kept), legacy backend. The legacy backend was **not** deleted.
