# Test Results

> Counts below are as of the end of Phase B. Later phases added tests; see `../phase-i/tests-and-evidence.md` for the final totals.

All tests are unit/static tests with injected mocks. **They do not validate any MyGeotab tenant.**

| Command | Result |
|---------|--------|
| `npx tsc -p tsconfig.json --noEmit` (apps/web) | clean |
| `npm --workspace apps/api run typecheck` | clean |
| `npm test` (apps/web) | 201 pass / 0 fail (143 pre-existing + 58 new) |
| `npm test` (root / API) | 65 pass / 0 fail |
| `npm --workspace apps/web run build` (`tsc -b`, vite, service build) | succeeded; dist = `index.html`, assets, `serviceAddin.js` |
| `OPEX_INCLUDE_SIMULATION=1 vite build` | simulation page built; demo keys only in simulation chunk |
| `git diff --check` | not possible (no `.git`) |
| `diff -rq` vs ZIP baseline | only intended files differ; `apps/api`, `db/`, CI, root scripts unchanged |

## Required coverage → tests
- Missing capability config denied → `capabilityGates`, `nativeRuntime`
- Invalid tenant context denied → `tenantContext`, `nativeRuntime`
- Unknown tenant denied → `tenantContext`, `nativeRuntime`
- Each gate enabled and disabled → `capabilityGates` (disabled, enabled, prerequisite, tenant), `nativeRuntime` matrix
- Disabled capabilities prevent API calls → `nativeRuntime` (call counters on a mock api)
- Offline simulation cannot invoke native providers → `simulationIsolation`, `runtimeArchitecture`
- Native failures don't touch localStorage → `nativeRuntime` (storage spy)
- Production UI exposes no live-mode override → `runtimeArchitecture`

Architecture tests found three real leaks during development (diagnostics storage/ungated reads, `api.call` in the simulation graph via `identityResolver`); all were fixed in source, not exempted. One documented exemption remains (`serviceAddin.ts`, `service.localStorage`).
