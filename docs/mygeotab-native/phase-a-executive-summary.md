# Phase A — Repository and Architecture Audit: Executive Summary

**Project:** OPEX Vehicle Booking — MyGeotab Native Add-In
**Phase:** A (read-only audit). No source, configuration, dependency, script or migration was modified.
**Audit date:** 2026-11-18
**Final status:** `PHASE A COMPLETE — AWAITING APPROVAL`

## Evidence labels used in every document

| Label | Meaning |
|---|---|
| **[CODE]** | Observed by reading the uploaded source |
| **[TEST]** | Observed by running the existing tests/builds on a separate copy |
| **[DOC]** | Stated by official Geotab documentation retrieved on 2026-11-18 |
| **[ASSUMPTION]** | Reasonable inference, not proven |
| **[TENANT]** | Cannot be known without validation in a real MyGeotab tenant |

**No live MyGeotab integration was performed or validated in this phase.** Every claim about runtime MyGeotab behaviour is either [DOC], [ASSUMPTION] or [TENANT].

## Git state cannot be verified

The baseline is the uploaded ZIP `opexassetbooking-main.zip`. It contains **no `.git` directory**. Therefore the Git branch, HEAD commit, staged changes, modified tracked files and untracked files **cannot be verified**, and preservation of local uncommitted work cannot be demonstrated. A public GitHub clone of `HeppyH/opexassetbooking` (`main`, HEAD `751bd6b`) was byte-identical to the ZIP, but it is not the local worktree. The Phase 3.7.3 / 3.7.4 reports and the six capability gates referenced in earlier prompts **do not exist in this baseline** (see `baseline-and-test-evidence.md`). If they exist in the local worktree, this audit does not cover them.

## What the application is today

A React + TypeScript Vite app that ships **two** data paths in one bundle: a DEMO mode (mock data + browser `localStorage`) and a LIVE mode that stores bookings, notifications and audit events as `AddInData` records and reads Device/User/Group from the MyGeotab API. A separate legacy Hono/Cloudflare Worker + PostgreSQL backend (`apps/api`, `db/`) is **not called by the web app** but remains wired into root scripts, CI and the Pages deploy workflow.

## Headline findings (full register: `code-findings-register.md`)

| # | Finding | Severity |
|---|---|---|
| F-01 | No capability gates or tenant allowlist exist; inside MyGeotab the app auto-switches to LIVE and live reads/writes are enabled by default once identity resolves | Critical |
| F-02 | No role-based authorization in the live write path: any user whose identity resolves can approve/reject/assign/cancel. Roles are read from `User.role`, which is **not a documented MyGeotab User property** | Critical |
| F-03 | No booking status-transition validation and no self-approval rule in the web app (the rules exist only in the unused legacy API) | High |
| F-04 | Bookings, notifications and audit records share one `addInId` with no record-type discriminator; `getBookings()` turns notification/audit records into phantom bookings (reproduced) | High |
| F-05 | Every operation fetches **all** AddInData for the AddInId with no `resultsLimit`/filter/pagination; repeated on auto-refresh | High |
| F-06 | `getNotifications` slice bug returns an empty list whenever `offset` is supplied (reproduced) | Medium |
| F-07 | Service Add-In shows and marks as delivered **every** user's pending notifications to whichever user's browser runs it (no recipient filter, no atomic claim) | High |
| F-08 | Service Add-In bundle is emitted with ES `export` syntax and an unverified registration contract; may not load as a WebWorker script | High, [TENANT] |
| F-09 | Notification persistence and live delivery are conflated; page-side "native" delivery uses an undocumented surface | Medium |
| F-10 | DEMO/LIVE switch and an editable AddInId are exposed to end users in the production UI | High |

Double-booking cannot be prevented with the documented AddInData API (no transaction/compare-and-swap is documented). Per the master prompt, live booking writes must stay disabled until a strategy is approved (`booking-concurrency-limitations.md`).

A fundamental feasibility limit also applies: AddInData authorization is per **method** (by clearance), not per record or per OPEX role [DOC]. Any user able to Add/Set/Remove can alter any record from the browser console, so OPEX roles in a 100% native design are **advisory, client-enforced controls**. This must be accepted by the business or mitigated (`identity-and-authorization.md`).

## Recommendation

1. **Do not proceed to Phase B yet** until the baseline question is resolved: confirm whether this ZIP/GitHub `main` is the intended baseline, or supply the local worktree (with `.git`) containing Phase 3.7.x work.
2. If the ZIP **is** the baseline, approve Phase B with these decisions recorded (details in `remaining-blockers.md`): booking status model, role-mapping mechanism, concurrency stance, demo-mode packaging, legacy backend disposition (recommended: `RETAIN_ISOLATED`).
3. Keep all live capabilities disabled; Phase B introduces explicit gates defaulting to `false` and removes the auto-LIVE behaviour.
4. Plan a separately authorized controlled-sandbox tenant validation after Phase I. Nothing here substitutes for it.

## Document index

| Document | Purpose |
|---|---|
| `baseline-and-test-evidence.md` | Baseline identity, Git limitation, commands run and results |
| `architecture-overview.md` | Current architecture assessment and target native architecture |
| `code-findings-register.md` | All findings with evidence and fix phase |
| `official-geotab-documentation-matrix.md` | What official docs confirm, and what remains unverified |
| `addin-data-feasibility.md` | AddInData capabilities, limits and design implications |
| `identity-and-authorization.md` | Identity/role gaps and draft security matrix |
| `vehicle-and-driver-integration.md` | Device/driver data gaps |
| `booking-concurrency-limitations.md` | Double-booking risk and mitigation options |
| `notification-architecture.md` | Persistence vs delivery; Service Add-In feasibility |
| `legacy-backend-disposition.md` | Dependency inventory and classification |
| `feature-preservation-and-migration-strategy.md` | Preserve / modify / replace map |
| `implementation-roadmap-phase-b-to-i.md` | Detailed roadmap and gates |
| `remaining-blockers.md` | Risks, blockers, decisions, acceptance criteria |
