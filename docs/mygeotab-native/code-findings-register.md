# Code Findings Register (Phase A)

Evidence: **[CODE]** read in source, **[TEST]** reproduced/executed, **[DOC]** official documentation, **[TENANT]** needs a real tenant. Paths are relative to the repository root. "Fix phase" refers to `implementation-roadmap-phase-b-to-i.md`.

## Critical / High

| ID | Sev | Finding | Evidence | Fix phase |
|---|---|---|---|---|
| F-01 | Critical | **No capability gates; LIVE auto-activates.** In `App.tsx`, when the lifecycle bridge delivers an `api` object and `addInId` is set while in DEMO, `setMode("ADDIN_DATA")` runs. `addInId` always has a value (`DEFAULT_ADDIN_ID` fallback), so inside MyGeotab live AddInData reads and writes are on by default once identity resolves. No allowlist, no per-capability switch. | [CODE] `App.tsx` ~1895–1902, `config/addinId.ts` `resolveAddInId` | B |
| F-02 | Critical | **No role-based authorization on live writes.** `onApprove`, `onConfirmReject`, `onAssign`, `onComplete` and the cancel handler check only `canPerformLiveWrite` (= identity resolved). `roles` is referenced only to filter eligible drivers. Roles come from `User.role`, which is not a documented User property (`userRole`/`customUserRole` exist) [DOC]; absent value defaults to `EMPLOYEE`, so `getApprovers()` returns an empty list in live mode. | [CODE] `identityResolver.ts` `normalizePrincipal`; `addinDataProvider.ts` `getApprovers`; [DOC] User object | D |
| F-03 | High | **No transition validation or self-approval rule in the web app.** `updateBookingStatus` writes any status. `VALID_TRANSITIONS`, `canApprove` (blocks self-approval) exist only in `apps/api/src/services/booking.ts`; no web file imports them. | [CODE] grep for `isValidTransition` in `apps/web/src` → none | E |
| F-04 | High | **No record-type discriminator.** Bookings, notifications and audit events are stored under one `addInId`. `getBookings()` maps every record to a booking, creating phantom bookings; `getUnreadCount` deserializes all records without try/catch. | [CODE]; [TEST] probe (3 records → 3 bookings) | C |
| F-05 | High | **Unbounded retrieval.** Every operation calls `Get AddInData` with only `addInId`, then filters client-side; each `getBookings()` additionally fetches Device and User lists (`resultsLimit: 1000`, silent truncation). `create` runs `getBookings()` twice plus App refreshes; auto-refresh runs 10–60 s. | [CODE] `addinDataProvider.ts`, `App.tsx` `REFRESH_INTERVALS`; [DOC] AddInData rate limits (Get 650/min, Add 100/min) | C |
| F-07 | High | **Service Add-In delivers other users' notifications.** `deliverPendingNotifications` selects all `pending` records and shows them without checking `recipient_user_id` against the running user; then marks them `delivered`. Concurrent workers in several browsers can show duplicates (no atomic claim). | [CODE] `serviceAddin.ts` 154–244 | F |
| F-08 | High | **Service bundle format unverified.** Built `dist/serviceAddin.js` ends with an ES `export { … }`. Official page says `serviceSrc` runs as WebWorker JavaScript but does not describe the script format or the registration name; the code registers `self.geotab.addin.service`. May fail to load. `whereClause` is sent without `selectClause` and `resultsLimit` is placed inside `search`. | [CODE]; [TEST] build output; [DOC] Service Add-In and AddInData pages; [TENANT] | F |
| F-10 | High | **Dev controls exposed to end users.** The DEMO/LIVE `<select>` and an editable AddInId field are visible in the production UI. Saving writes any trimmed string (even invalid) to `localStorage` and can redirect storage to another AddInId. The Service Add-In reads a different store (`service.localStorage`), so the two can diverge. | [CODE] `App.tsx` ~2676–2690, 2130–2150 | B |
| F-13 | High | **Authorization is client-side only.** AddInData permissions are per method and clearance, not per record or OPEX role [DOC]. Any user with Add/Set/Remove can change any record via the browser console. | [DOC] AddInData page; design limit | D |
| F-14 | High | **Concurrency unprotected.** Conflict check = `Get` all → client filter → `Add`; `Set` replaces whole `details`; `version` is client-side only. No transaction/CAS is documented. | [CODE]; [DOC] silent | E |

## Medium

| ID | Sev | Finding | Evidence | Fix phase |
|---|---|---|---|---|
| F-06 | Med | `getNotifications` slice end is `opts?.offset ?? 0 + (limit ?? Infinity)`; operator precedence makes `end = offset` when offset is given → empty result. | [CODE]; [TEST] probe | C |
| F-09 | Med | Notification persistence conflated with delivery. `showNativeNotification` calls `window.geotab.service.notifications.show` from the page; `notifications.show` is documented on the Service Add-In `service` object in a WebWorker, not the page. The result is discarded (`void delivery`) so status stays `pending`. | [CODE] `notificationService.ts`; [DOC] Service Add-In page | F |
| F-11 | Med | **Device mapping uses undocumented fields and invented defaults.** `make`, `model`, `vehicleClass`, `status` are not on the documented Device object [DOC]; missing `vehicleClass` defaults to `OPERATIONAL_4X4`, `status` to `AVAILABLE`; `asset_code` is synthetic (`VEH-` + last 3 id chars); every booking is created with `requestedClass: "PASSENGER"`. | [CODE] `addinDataProvider.ts` `mapLiveAsset`, `App.tsx` create | D |
| F-12 | Med | **Driver handling.** Eligible drivers filtered by app roles (all users are `EMPLOYEE` live) rather than `User.isDriver`; no default from a MyGeotab assigned driver; only driver id stored (no snapshot) and `driverName` input is ignored by the AddInData provider. | [CODE]; [DOC] User object | D |
| F-15 | Med | **Audit gaps.** Audit actions lack submitted/driver-changed/vehicle-changed/date-changed; no actor display-name snapshot; dedup set is in-process only; audit records are mutable by any user with Set/Remove [DOC]. Audit failure after a successful booking leaves an unaudited booking (reported to the user, not recoverable). | [CODE] `auditTrail.ts`, `App.tsx` | F |
| F-16 | Med | **Hidden-fallback pattern in dead code.** `data/mygeotabProvider.ts` reports `isLive() = true` while storing bookings in `localStorage` through an embedded `LocalBookingDataProvider`. Not imported anywhere, but it is exactly the pattern the target forbids. | [CODE] grep shows no importer | C/H |
| F-17 | Med | **Demo simulation shipped in production bundle.** `mockMyGeotab.ts` (1,059 lines) and the `localStorage` provider are bundled and user-selectable in the live Add-In; simulation is not a separate development-only environment. | [CODE] | B |
| F-18 | Med | **Frontend coupled to legacy types.** `data/types.ts` imports types from `apps/api/src/integrations/mygeotab/types`; removing `apps/api` breaks `tsc`. | [CODE] | H |
| F-19 | Med | **Time model.** Instants stored as ISO UTC strings, which is good; tenant timezone is hard-coded `Asia/Jakarta` and not stored per booking; offset computed once per call. Required separate start/end date and time fields exist only as UI inputs (confirm in Phase E). | [CODE] `tenantTimezone.ts` | E |

## Low / informational

| ID | Finding | Evidence |
|---|---|---|
| F-20 | CI and Pages workflows run `npm test`, which executes **only the legacy API tests**; the root `build` script also typechecks `apps/api`. Web tests run only in `ci.yml` via a separate step. | [CODE] `package.json`, `.github/workflows/*` |
| F-21 | `VITE_API_BASE_URL` is dead configuration (set in workflow, `.env.example`, README; unused by web source). | [CODE]/[TEST] |
| F-22 | README describes PostgreSQL as authoritative for bookings and references `docs/PERSONAL-TESTING-ENVIRONMENT.md`, which does not exist. Stale relative to the web code. | [CODE] |
| F-23 | `vite.config.ts` sets `build.sourcemap: true`; source maps are published to GitHub Pages. | [CODE] |
| F-24 | `main.tsx` imports `serviceAddin`, so the page bundle also registers `self.geotab.addin.service` inside the page window. Harmless today but unintended coupling between page and worker code. | [CODE] |
| F-25 | AddInId in code (`aDJjMmVmZWMtYzU1OC00MTJ`, 23 chars, prefix `a`) matches the derivation in `config/addinId.ts` [TEST]. It is derived from a prefix of the source UUID string; the exact generation algorithm in the official page is described only in an example script that was not retrievable, so exact conformance is **not fully verified**. Length and `a` prefix are consistent with [DOC]. | [CODE]/[DOC] |
| F-26 | Add-In config JSON (`geotab/opex-vbm-config.json`) has `name`, `supportEmail`, `version`, `items[url,path,menuName,category]`. Official page also lists `files`, `svgIcon`, `enableViewSecurityId`, `securityIds`; whether `files` is required and menu behaviour are **unverified**. Hosting URL contains no `-`, `@`, `#` in the path/host portion checked against [DOC] rule (host `heppyh.github.io`). | [CODE]/[DOC]/[TENANT] |

## Positive findings worth preserving

- Identity resolution fails closed and requires a single unambiguous `User` match; never falls back to demo identity in live mode (`identityResolver.ts`) [CODE][TEST].
- `modeGuards.ts` blocks demo-only operations in live mode [CODE][TEST].
- Details size guard (10,000 chars) and tolerant handling of malformed records exist in several paths [CODE].
- Booking data-quality classification (`bookingValidation.ts`) is useful for reconciliation [CODE].
- Notification idempotency keys, rate limiter constants (6 calls/min, 2 visible) align with documented limits [CODE][DOC].
- Legacy API holds a coherent status machine and role rules that can be ported [CODE].
