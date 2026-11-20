# Baseline Identity and Test Evidence

## 1. Baseline identity

| Item | Value |
|---|---|
| Source | Uploaded `opexassetbooking-main.zip` (353,653 bytes) |
| `.git` directory | **Absent** |
| Git branch | **Cannot be verified** |
| HEAD commit | **Cannot be verified** |
| Staged / modified / untracked files | **Cannot be verified** |
| Preservation of local uncommitted work | **Cannot be demonstrated** |
| Cross-check | A public GitHub clone (`HeppyH/opexassetbooking`, `main`, `751bd6b`, "Merge pull request #8 … fix/booking-data-integrity-reporting") was compared with the ZIP using `diff -rq` (excluding `.git`, `node_modules`): **no differences** |

The GitHub clone is only a cross-check. It is **not** the local worktree and says nothing about uncommitted or unpushed local work.

### Discrepancies against earlier prompts (Phase 3.7.5 prompt)

| Expected by earlier prompt | Found in baseline |
|---|---|
| `docs/development/phase-3.7.3/` and `phase-3.7.4/` reports | Not present; no `phase-3.7*` folder anywhere |
| Capability flags `MYGEOTAB_IDENTITY_ENABLED`, `MYGEOTAB_STORAGE_ENABLED`, `LIVE_BOOKING_READ_ENABLED`, `LIVE_BOOKING_WRITE_ENABLED`, `APPROVAL_ACTIONS_ENABLED`, `ADMIN_CONFIGURATION_ENABLED` | Not present (searched repository-wide) |
| `APPROVED_TENANT_CONTEXTS` allowlist | Not present |
| Provider contracts (Identity/Tenant/Authorization/Approval/Diagnostics providers) | Not present as such; see `architecture-overview.md` |

The existing reports (`docs/PHASE_*`) describe earlier phases (Phase 1–16.4.6.x). They were not used as proof of current behaviour; the source was.

## 2. How tests were run

To keep the baseline untouched, the ZIP extraction was copied to a separate directory and `npm ci` was run there (Node v22.23.5). `node_modules` and `dist/` exist only in that copy. A throwaway probe script lived outside both directories.

| Command (in the separate copy) | Result |
|---|---|
| `npm --workspace apps/web run test` | 143 tests, 143 pass, 0 fail |
| `npm test` (root → API tests only) | 65 tests, 65 pass, 0 fail |
| `node --experimental-strip-types apps/web/test/service-addin.test.mjs` | 28 tests, 28 pass, 0 fail |
| `npx tsc -p apps/web/tsconfig.json --noEmit` | No diagnostics emitted |
| `npm --workspace apps/api run typecheck` | No diagnostics emitted |
| `npm --workspace apps/web run build` (`tsc -b && vite build && build:service`) | Success; `dist/index.html`, one JS bundle (265.88 kB), CSS, `serviceAddin.js` |

## 3. What these results do and do not prove

- All web tests use mocks or in-memory stand-ins [CODE]. They are **unit/mock tests**, not tenant integration tests. They prove nothing about real MyGeotab behaviour.
- The API tests exercise legacy overlap and role logic and the Wrangler config. They are irrelevant to the target runtime except as a reference for domain rules.
- Passing tests do **not** mean the findings in `code-findings-register.md` are covered. Two defects (F-04, F-06) pass the existing suite and were reproduced separately.

## 4. Reproduced defects (probe outside the repository)

The probe constructed `AddInDataBookingDataProvider` with a fake `api.call` returning three records (one booking, one notification, one audit event) under one `addInId`:

- `getBookings()` returned **3 bookings**; the notification and audit records appeared as bookings with `dataQuality: MULTIPLE_VALIDATION_ERRORS` (F-04).
- `getNotifications("u2", { offset: 0, limit: 5 })` returned **0** items; without `offset` it returned 1 (F-06).

These are mock-API reproductions of code logic, not tenant observations.

## 5. Build-output scan

The production bundle was searched for legacy backend hosts (`workers.dev`, `127.0.0.1:8787`): **none found**. `VITE_API_BASE_URL` is referenced by `.env.example`, `README.md` and `deploy-pages.yml` but **not by any file under `apps/web/src`** (dead configuration). The only web→API coupling is one `import type` in `apps/web/src/data/types.ts` pointing at `apps/api/src/integrations/mygeotab/types` (erased at build, but required by `tsc`).

## 6. Not performed (by design)

No tenant connection, no AddInData read/write, no Service Add-In execution, no deployment, no migrations, no commits, no pushes, no dependency or lockfile changes in the baseline.
