# Feature Preservation and Migration Strategy

Evidence labels: [CODE] [TEST] [DOC] [ASSUMPTION]. This is a Phase A inventory based on code reading, not a full UI walkthrough. The complete UI inventory (every screen, control and state) must be finished at the start of Phase B because `App.tsx` is a 2,914-line component; items below are those confirmed from code paths and tests.

Disposition key: **Preserve** (keep as is) · **Modify** (keep behaviour, change implementation) · **Replace** (new implementation) · **Remove** (after approval).

## 1. Feature map

| Feature | Evidence | Disposition | Phase | Notes |
|---|---|---|---|---|
| Add-In lifecycle registration (`initialize/focus/blur`) | `main.tsx` | Preserve | B | Matches documented lifecycle and namespace rules [DOC] |
| Lifecycle bridge | `config/lifecycleBridge.ts` + tests | Preserve | B | |
| Lifecycle diagnostics (disabled by default) | `config/lifecycleDiagnostics.ts` | Preserve; keep off in production | B | Vite `define` sets it false |
| Authenticated identity resolution (fail-closed, single match) | `auth/identityResolver.ts` + tests | Preserve, then verify | B/D | Role source must change (F-02) |
| Mode guards for demo-only operations | `safety/modeGuards.ts` + tests | Preserve, extend with capability gates | B | |
| DEMO/LIVE dropdown | `App.tsx` | **Replace** (remove from production UI) | B | F-10, F-17 |
| AddInId editor + localStorage override | `App.tsx`, `config/addinId.ts` | **Replace**: fixed AddInId from config; no end-user override | B | Keep validation helpers (`isValidAddInId`) |
| Stable AddInId constant | `config/addinId.ts` | Preserve value; verify against official script | B | Do not regenerate or silently replace |
| AddInData provider (bookings/notifications/audit) | `data/addinDataProvider.ts` | **Modify** heavily (envelope, queries, errors, no phantom records) | C | Reuse serialize/size-guard ideas |
| Provider interfaces | `data/types.ts` | Modify (separate identity/authorization/booking/notification/audit contracts) | B/C | Remove import from `apps/api` |
| Local demo provider + mock data | `data/dataProvider.ts`, `data/mockMyGeotab.ts` | Preserve as **isolated dev-only simulation** | B | Not in production bundle unless approved (D-5) |
| Hybrid provider | `data/mygeotabProvider.ts` | Remove after approval | C/H | Dead code (F-16) |
| Booking validation / data-quality classification | `data/bookingValidation.ts` + tests | Preserve; extend to full domain validation | C/E | |
| Create booking + driver + date/time inputs | `App.tsx`; `bookingDriverDatetime.test.mjs` | Modify | E | Separate start/end date/time, timezone context, driver rules |
| Overlap check | AddInData provider + legacy `overlap.ts` | Modify (domain function, buffers, blocking statuses by rule) | E | Advisory only |
| Status workflow (13 statuses) | `types.ts`; UI | **Modify** into centralized state machine | E | Decision D-1 (13 vs 6 statuses); port transitions from `apps/api/src/services/booking.ts` |
| Approve / Reject / Assign / Cancel handlers | `App.tsx` | Modify: move to domain services with authorization | D/E | F-02, F-03 |
| Rejection reason capture | `App.tsx` (`rejectReason`) | Preserve; make mandatory per master prompt | E | |
| Approval inbox, My bookings, Dashboard, Asset availability, Reports | `App.tsx` (auto-refresh keys) | Preserve UX; modify data access to cached bounded reads | B–G | Refresh intervals 10–60 s must respect rate limits |
| Filters, sorting, status helpers | `ui/sortingHelpers.ts`, `statusHelpers.ts` + tests | Preserve | — | |
| Notification Center (bell dropdown, unread count, mark read) | `App.tsx`, notification engine | Modify | F | Fix offset bug; recipient-aware |
| Notification engine (idempotency keys, templates) | `data/notificationService.ts` | Modify | F | Remove page-side native call |
| Service Add-In | `serviceAddin.ts` + 28 tests | **Modify / possibly Replace** | F | F-07, F-08; only if tenant validation succeeds |
| Audit trail emission | `audit/auditTrail.ts` + tests | Modify: complete event set, actor snapshot, append-only conventions | F | |
| Auto-refresh hook | `ui/autoRefresh.ts` | Preserve; add backoff on rate-limit errors | C | |
| Error boundary | `ui/errorBoundary.tsx` | Preserve | — | |
| Tenant timezone helper | `config/tenantTimezone.ts` | Modify: configurable business timezone from config | G | Default stays `Asia/Jakarta` as a safe default only after approval |
| Admin configuration | not present | **New** | G | Approval rules, durations, advance window, timezone, notification preferences |
| Booking summary / approval summary / utilization reports | partial reports exist | Modify/New | G | Scope TBD |
| Add-In config JSON files | `geotab/*.json` | Preserve; revalidate; prepare registration checklist | B/I | No registration in a real tenant |
| Legacy domain rules (transitions, `canApprove`, overlap) | `apps/api/src/services/booking.ts`, `domain/overlap.ts` | Port logic (not code dependency) | D/E | |

## 2. Data migration

- **Existing data:** `localStorage` demo data is simulation only and is **not migrated**. Any AddInData records already written by earlier phases into a tenant are **unknown** (no tenant access; Phase 3.x tenant history is not in this baseline). Phase C must include a read-only inspection routine (separately authorized) and a versioned migration plan from the current untyped records (`OpexBooking`, `OpexNotification`, `OpexBookingAudit` JSON in `details`) to the typed envelope. Unknown or corrupt records are quarantined, never discarded.
- **Identifier continuity:** current booking `id` may be the server `AddInData.id` (after Add) or `addin-<ts>`. The migration must map both to a stable `recordId` without breaking audit/notification references.
- **Status mapping:** if D-1 reduces 13 statuses to 6, define an explicit mapping table (e.g., `PENDING_APPROVAL → Pending`, `SUBMITTED → Pending`, `ASSIGNED/CHECKED_OUT/OVERDUE → Approved`, `RETURNED/CLOSED → Completed`, `EXPIRED → Cancelled`) for approval before use. [ASSUMPTION — mapping proposal only]

## 3. Preservation safeguards
1. No change to demo behaviour except relocating it behind the dev-only boundary.
2. Existing tests are preserved; where behaviour intentionally changes (e.g., removal of the DEMO dropdown) tests are **updated with justification**, never weakened to pass.
3. Every removal is proposed, approved and logged; none in Phases A–G.
4. Git baseline must be re-established (branch, HEAD, status) before Phase B because the ZIP has no `.git`.
