# Architecture Overview — Current Assessment and Target

Evidence labels: [CODE] [TEST] [DOC] [ASSUMPTION] [TENANT] (see `phase-a-executive-summary.md`). Nothing below was validated in a real tenant.

## 1. Current architecture (as implemented)

```text
 MyGeotab page (iframe)                          Standalone browser
        |                                                |
        v                                                v
 main.tsx registers geotab.addin.opexVehicleBooking   (same bundle)
 initialize/focus/blur -> lifecycleBridge (api, state)
        |
        v
 App.tsx (2,914 lines: UI + workflow + authorization + orchestration)
        |
        +-- mode = "DEMO"  (default) ------------------+
        |     LocalBookingDataProvider                 |
        |     mockMyGeotab.ts + localStorage           |
        |                                              |
        +-- mode = "ADDIN_DATA" (auto when api exists) |
              AddInDataBookingDataProvider             |
              api.call: Get Device/User/Group          |
              api.call: Add/Get/Set/Remove AddInData   |
              (one addInId: bookings+notifications+audit)

 serviceAddin.ts  -> built to dist/serviceAddin.js (config: geotab/opex-vbm-service-config.json)
                     polls AddInData for pending notifications, calls notifications.show

 Legacy, not called by web:  apps/api (Hono, Cloudflare Worker) -> PostgreSQL (db/migrations)
```
[CODE]

### Runtime components

| Component | Location | Role | Status |
|---|---|---|---|
| Custom-page entry | `apps/web/src/main.tsx` | Registers `geotab.addin.opexVehicleBooking` (no hyphen, matches [DOC] namespace rule); stores api/state in bridge | Implemented, mock-tested [CODE][TEST] |
| Lifecycle bridge | `config/lifecycleBridge.ts` | Holds latest valid `api` (must have `call`) | Implemented, unit tested |
| Identity resolver | `auth/identityResolver.ts` | `getSession` → `Get User` by name → requires exactly one match; fail-closed | Implemented, unit tested; MyGeotab behaviour [TENANT] |
| Mode guards | `safety/modeGuards.ts` | Blocks demo-only ops in live mode | Implemented, unit tested |
| AddInData provider | `data/addinDataProvider.ts` | Booking/notification/audit persistence; master data reads | Implemented, mock-tested; defects F-04/05/06/14 |
| Local demo provider | `data/dataProvider.ts` + `mockMyGeotab.ts` | Simulation with `localStorage` | Implemented; shipped in prod bundle (F-17) |
| Hybrid provider | `data/mygeotabProvider.ts` | Live master data + local bookings | **Dead code** (F-16) |
| Notification engine | `data/notificationService.ts` | Builds notifications, idempotency keys, page-side "native" call | Implemented; delivery path unverified (F-09) |
| Audit | `audit/auditTrail.ts` | Emits audit events post-persist | Implemented; gaps F-15 |
| Service Add-In | `serviceAddin.ts` | Background notification delivery | Implemented, mock-tested; F-07/F-08 |
| Timezone | `config/tenantTimezone.ts` | Fixed `Asia/Jakarta` conversion | Implemented; not configurable (F-19) |
| Add-In configs | `geotab/*.json` | Page and service registration JSON | Not validated in tenant [TENANT] |
| UI | `ui/App.tsx` (+ helpers) | Everything: dashboard, bookings, approvals, availability, reports, admin-ish controls | Monolithic; no role gating |

### Current-state assessment

- **Layering:** There is no application/domain layer. Workflow rules, authorization and orchestration live inside React callbacks in `App.tsx`. Provider interfaces (`BookingDataProvider`, `NotificationDataProvider`) exist and are reusable.
- **Platform dependence:** The page itself is already platform-native in live mode (MyGeotab `api` object + AddInData). The legacy backend is not on the runtime path [CODE][TEST: bundle scan].
- **Separation of modes:** Demo and live code are in one bundle and user-switchable (F-10, F-17); live is auto-selected (F-01).
- **Safety posture:** Fail-closed identity and demo-op guards are good, but there is no capability gating, role authorization or transition validation on live writes.

## 2. Target architecture (Phase B–I)

```text
                  MYGEOTAB PLATFORM
                         |
              MYGEOTAB CUSTOM PAGE ADD-IN (+ optional Service Add-In)
                         |
                         v
                REACT + TYPESCRIPT UI  (presentation only)
                         |
                         v
                  APPLICATION LAYER
     +-------------+-----+-------+--------------+
     |             |             |              |
  CAPABILITY    IDENTITY      DOMAIN        AUTHORIZATION
   GATES        PROVIDER     SERVICES         POLICY
 (default off)      |      (state machine,        |
     |              |       validation,           |
     |              |       overlap, audit)       |
     +--------------+-------------+---------------+
                         |
                  PROVIDER CONTRACTS
        +----------------+------------------+
        |                                   |
 NATIVE PROVIDERS                    OFFLINE SIMULATION
 (MyGeotab api + AddInData)          (dev-only build/route,
        |                             in-memory, no api access)
        v
   MYGEOTAB API -> AddInData  { Booking | Notification | Audit | Config }
```

### Target design rules

1. **MyGeotab is the only platform and persistence layer.** AddInData is the only application storage. No PostgreSQL/Neon/Supabase/D1/Worker/Hono backend, no external auth [master prompt §1].
2. **Domain layer is UI-independent.** State machine, validation, authorization policy, overlap detection and audit/notification event creation become pure functions/services with unit tests; `App.tsx` calls them.
3. **Capability gates default to `false`** and fail closed; no UI or environment override; allowlist empty until written administrator approval. Gate names from the master prompt: `MYGEOTAB_IDENTITY_ENABLED`, `MYGEOTAB_STORAGE_ENABLED`, `LIVE_BOOKING_READ_ENABLED`, `LIVE_BOOKING_WRITE_ENABLED`, `APPROVAL_ACTIONS_ENABLED`, `ADMIN_CONFIGURATION_ENABLED`.
4. **Offline simulation is isolated** (separate entry/route or dev-only build flag), cannot reach `api`/AddInData, cannot switch to native, and is excluded from the production bundle unless explicitly decided otherwise.
5. **No hidden fallback** from native to localStorage, mock data or any external service. Native failures surface as errors.
6. **Typed record envelope** in AddInData (schema version, record type, stable id, UTC timestamps, creator, references) with validated `details`; one record per entity (`addin-data-feasibility.md`).
7. **Authorization is defence in depth, not enforcement.** AddInData cannot enforce OPEX roles per record [DOC]; design accepts and documents this (`identity-and-authorization.md`).
8. **Service Add-In is optional** and used only where technically justified; the Notification Center in the page is the reliable channel (`notification-architecture.md`).
9. **Static HTTPS hosting is allowed** (GitHub Pages today) and must not become a backend [master prompt §1, §17; DOC: hosting must be HTTPS, TLS 1.2+].

## 3. Gap summary (current → target)

| Area | Gap | Detail |
|---|---|---|
| Capability gating | Missing | F-01, F-10 |
| Domain layer | Missing | F-03, F-02; logic trapped in `App.tsx` |
| AddInData schema | Missing discriminator/version/envelope | F-04 |
| Query strategy | Unbounded `Get` | F-05, F-06 |
| Identity | Resolution good; roles/clearances unmapped | F-02, F-13 |
| Master data | Undocumented fields, invented defaults | F-11, F-12 |
| Concurrency | Unprotected | F-14 |
| Notifications | Persistence ok; delivery unverified/incorrect | F-07, F-08, F-09 |
| Audit | Incomplete event coverage/immutability | F-15 |
| Offline simulation | Not isolated | F-16, F-17 |
| Legacy isolation | Coupled via scripts/CI/types | F-18, F-20, F-21 |
| Config/registration | Unverified against tenant | F-25, F-26 |
| Admin configuration | Not implemented | no config record/type exists [CODE] |
| Reporting (Phase G) | Basic reports exist in UI; utilization/approval summaries unverified | `ui/App.tsx` |


---

## Update after Phases B–I (implementation state)

The Phase A description above is the audited baseline. The implemented target is:

```text
MyGeotab page → apps/web main.tsx → NativeHost → createNativeRuntime
   getSession → validateTenantContext (allowlist, empty) → identity (Get User, active check)
   → OPEX role mapping (AddInData cfg_role_mapping; none = denied)
   → capability gates (six, all false) × tenant × role → gated api (call allowlist)
   → AddInData store (envelope, bounded Get, cache/dedupe, advisory conflict checks)
Domain modules (pure): booking/ (state machine, schedule, availability, model, search),
   authz/, masterdata/, notifications/, audit/, admin/, reports/
Offline simulation: separate entry (simulationMain.tsx), excluded from the default build
Legacy Hono/PostgreSQL/Worker: preserved in apps/api and db/, unreachable from default scripts/CI/Pages
```
See `implementation-status.md` for what is and is not wired into the UI.
