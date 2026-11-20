# Risks, Blockers, Decisions and Acceptance Criteria

> **Current status (after Phases B–I):** see the consolidated list below. The Phase A tables further down are preserved as the audit record.

## Current blockers (consolidated)

1. **Git/baseline unverifiable** (ZIP, no `.git`); no commit or push was made.
2. **No tenant validation of anything.** All six capabilities remain false; tenant allowlist empty.
3. **Server-side authorization impossible as designed.** AddInData clearances are per method; role mapping, settings, notifications and audit can be altered by anyone with Set clearance. Sandbox must show what clearances can protect.
4. **Concurrency unproven.** Advisory detection and reconciliation only; business must accept or reject residual risk before `LIVE_BOOKING_WRITE_ENABLED`.
5. **UI not integrated.** `App.tsx` still uses the legacy provider shape; no Notification Center, admin or report screens; limits/settings not enforced in the booking flow; notification/audit not auto-written.
6. **Legacy provider debt.** Unbounded per-call Gets, undocumented `User.role` approver list and fabricated Device-derived fields, legacy record shape, dead `mygeotabProvider.ts`.
7. **Service Add-In** disabled; ESM build with `export` likely wrong; registration name and logged-out behaviour unverified; F-07 cross-user exposure must be fixed before enabling.
8. **Bootstrap administrator** undefined (owner decision).
9. **Master data fields** (licensePlate/VIN/make/model) and default driver source unverified.
10. **Workflows unverified on GitHub**; source maps published; `geotab/*.json` schema/menu path unverified.
11. **Legacy backend disposition** (archive/delete) awaiting owner decision.

---

Evidence labels: [CODE] [DOC] [ASSUMPTION] [TENANT]. Status of the audit: `PHASE A COMPLETE — AWAITING APPROVAL`.

## 1. Blockers

| ID | Blocker | Why it matters | Needed to clear |
|---|---|---|---|
| B-1 | **Baseline/Git state unverifiable.** The ZIP has no `.git`; Phase 3.7.3/3.7.4 reports and capability-gate code referenced in earlier prompts are absent | Branch, HEAD, staged/untracked files and local uncommitted work cannot be verified or protected; local work may differ from this audit | Provide local worktree with `.git` (or confirm ZIP/`main` 751bd6b is the baseline) |
| B-2 | **No tenant validation possible in this phase** | All MyGeotab runtime behaviour is Doc-confirmed at best | Separately authorized Gate T |
| B-3 | **Concurrency strategy undecided** | Live booking writes must stay disabled | Business decision D-4 plus tenant experiment |
| B-4 | **Role mechanism undecided; server-side enforcement impossible** | Approver/Administrator controls are advisory | Decisions D-2, D-3 |
| B-5 | **Service Add-In loading/registration unverified** | Delivery may not work at all | Official docs/samples review + tenant proof |
| B-6 | **Doc pages not retrieved**: `Get` limits, security clearances/groups, sample add-ins, custom-page `api` object | Limits design details | Retrieve and record in Phase B/C |

## 2. Decisions required (before or at the start of Phase B/E/D)

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D-0 | Confirm baseline | Local worktree / ZIP / GitHub `main` | Supply local worktree with `.git` |
| D-1 | Booking status model | Keep 13 statuses; reduce to 6; hybrid (6 core + fulfilment sub-states) | Choose by business need; if reduced, approve mapping table |
| D-2 | Role mapping mechanism | A custom clearances, B security groups, C AddInData config, D `userRole` | A (visibility) + B or C (roles), subject to tenant proof; fail closed |
| D-3 | Acceptance of advisory-only authorization | Accept with detective controls / require stricter MyGeotab clearance setup | Accept with documented controls and admin review |
| D-4 | Concurrency stance | M-1…M-6 combination; accept residual risk | M-1 + M-2 + M-3 + M-5, plus written residual-risk acceptance |
| D-5 | Demo/offline simulation packaging | Dev-only build flag / separate entry excluded from production / keep in bundle behind gate | Dev-only, excluded from production bundle |
| D-6 | Default driver source | `DriverChange`, config mapping, none | Config mapping (option 2) or none until proven |
| D-7 | Legacy backend | RETAIN_ISOLATED now; ARCHIVE later | RETAIN_ISOLATED through Phase G |
| D-8 | Service Add-In | Pursue / defer | Defer until Gate T; Notification Center first |
| D-9 | Self-approval | Prohibit / allow for administrators | Prohibit (master prompt default) |
| D-10 | Time model | Business timezone configurable (default `Asia/Jakarta`) vs fixed | Configurable, stored per booking |

## 3. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | Auto-LIVE and missing gates cause unintended tenant writes if this build is registered | High (as-is) | High | Phase B first; do not register current build in a real tenant |
| R-2 | Any authenticated user can approve/reject/cancel | High (as-is) | High | Phase D; D-2/D-3 |
| R-3 | Double-booking | Medium | High | Section D-4 |
| R-4 | Phantom bookings/misreads from untyped shared records | High (reproduced) | Medium | Phase C envelope |
| R-5 | Rate-limit breaches from whole-set `Get` + auto-refresh | Medium | Medium | Phase C caching/backoff |
| R-6 | Service Add-In shows other users' notifications or fails to load | High (as-is) | Medium | Phase F; D-8 |
| R-7 | AddInData tampering (audit/booking) by permitted users | Medium | High | Document; reconcile; restrict clearances; do not claim tamper-proof |
| R-8 | Undocumented Device/User fields silently produce wrong data | High (as-is) | Medium | Phase D field cleanup |
| R-9 | Accidental legacy workflow (`db:migrate`, `dev:api`, `wrangler deploy`, default `npm test`) | Medium | Medium | Phase H script relabelling |
| R-10 | Docs/README drift misleads operators | High | Low | Phase H/I docs rewrite |
| R-11 | Loss of local-only work (ZIP baseline) | Unknown | High | B-1 |
| R-12 | Rewrite scope: `App.tsx` monolith slows safe change | Medium | Medium | Extract domain layer incrementally; keep UI behaviour |

## 4. Acceptance criteria (master prompt §24) — status at end of Phase A

| # | Criterion | Status now |
|---|---|---|
| 1 | React + TypeScript frontend | Met |
| 2 | Valid MyGeotab Custom Page Add-In | Partially: lifecycle matches docs; config/menu **Not verified in tenant** |
| 3 | MyGeotab API is the native integration | Partially (live mode) |
| 4 | AddInData is the only persistence | Partially: live yes; demo uses `localStorage`; legacy DB exists unused |
| 5–8 | No external DB / Hono / PostgreSQL / Worker required at runtime | Met at runtime [CODE][TEST]; present in repo and scripts |
| 9 | Native user identity | Partially: resolver good; unverified in tenant |
| 10 | Vehicle info from MyGeotab | Partially; undocumented fields (F-11) |
| 11 | Driver info from MyGeotab | Partially (F-12) |
| 12 | Driver optional | Met in UI/data model [CODE] |
| 13 | Separate start/end date and time | Partially (confirm in Phase E) |
| 14 | Approval per defined authorization | **Not met** (F-02, F-03) |
| 15 | Notifications persisted; limits documented | Persisted; delivery **Not verified**; limits now documented |
| 16 | Audit persisted | Partially (F-15) |
| 17 | Security boundaries documented and tested | **Not met**; documented in this audit |
| 18 | Offline simulation cannot access live tenant data | **Not met** (F-10, F-17) |
| 19 | No hidden fallback to external systems | Met for external systems; dead hybrid provider (F-16) |
| 20 | Existing features and user data preserved | Not demonstrable (B-1) |
| 21 | Build/regression tests pass | Met on baseline: 143 + 65 + 28 tests, typechecks, build [TEST] |

## 5. Recommendation

**Status: `PHASE A COMPLETE — AWAITING APPROVAL`.**

1. Resolve D-0/B-1 (baseline and Git state) first; if the local worktree differs, re-run the affected parts of this audit.
2. Approve (or amend) decisions D-1…D-10, at minimum D-1, D-2, D-4, D-5 before Phases B/D/E.
3. Approve Phase B scope as described in `implementation-roadmap-phase-b-to-i.md`.
4. Do not register or load the current build in any real tenant: it has no capability gates and auto-enables live reads/writes.
5. Plan Gate T (controlled sandbox validation) as a separate authorization after Phase I.

Phase B will not begin until you approve.
