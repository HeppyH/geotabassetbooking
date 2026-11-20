# Implementation Roadmap — Phases B to I

Evidence labels: [DOC] [CODE] [ASSUMPTION] [TENANT]. **Nothing below is started.** Phase B starts only after written approval. Throughout all phases: all six capability gates stay `false`, the tenant allowlist stays empty, and there is no tenant connection, deployment, Add-In registration, migration run, commit or push unless separately and explicitly authorized.

Standing rules for every phase (from master prompt §22): inspect branch/HEAD; run `git status --short`; record modified/staged/untracked files; preserve all user changes; never `reset --hard`, `clean`, `stash`, destructive checkout, bulk deletion, unapproved commit/push. Tests are never weakened to pass.

## Phase 0 — Baseline reconciliation (precondition for B)
| Item | Detail |
|---|---|
| Goal | Confirm the intended baseline |
| Actions | Obtain local worktree with `.git`, or written confirmation that the ZIP/GitHub `main` (`751bd6b`) is the baseline; locate any Phase 3.7.x reports and gate code; diff against this audit |
| Exit | Branch/HEAD/status recorded; discrepancies reconciled; this roadmap re-confirmed or amended |

## Phase B — Native Add-In Foundation
| Item | Detail |
|---|---|
| Goal | Establish lifecycle, API bridge, AddInId handling, runtime composition and separate offline simulation |
| Work | (1) Complete full UI/feature inventory. (2) Introduce capability gates (six flags, default `false`, no UI/env override) and an empty `APPROVED_TENANT_CONTEXTS`; remove auto-switch to LIVE (F-01). (3) Runtime composition module selecting native vs offline simulation explicitly; native fails closed when gates/config/identity are missing; no fallback to mock/localStorage/external. (4) Remove DEMO/LIVE dropdown and AddInId editor from the production UI (F-10); fixed AddInId from config with format validation; document AddInId ↔ Add-In configuration relationship. (5) Isolate simulation (dev-only entry/flag) and keep it out of the production bundle unless D-5 says otherwise (F-17). (6) Break web→`apps/api` type import (move types into web) (F-18). (7) Verify `getSession`, lifecycle and configs against official docs; produce registration checklist draft |
| Tests | Architecture tests: no Hono/Postgres/Worker references in web source/bundle; gates default false; simulation cannot reach `api`; no legacy fallback |
| Exit | Gates enforced and tested; no auto-live; simulation isolated; typecheck, tests, build pass; docs `addin-lifecycle.md`, `addin-configuration.md`, `architecture-overview.md` updated |
| Not done | No tenant calls |

## Phase C — AddInData Storage
| Item | Detail |
|---|---|
| Goal | Reliable, bounded, typed persistence |
| Work | Versioned record envelope and schema (`addin-data-schema.md`); one record per entity; separate booking/notification/audit/config types; validated serialization incl. object/string `details` and 10,000-char guard; typed error taxonomy (API failure, permission, invalid AddInId, network, oversized, malformed, duplicate, missing); bounded retrieval, caching, backoff on `OverLimitException`, correct select/where usage (no AND/OR/LIKE; case-sensitive); fix F-04, F-05, F-06; quarantine corrupt records; remove `Remove` from normal UI paths; delete dead hybrid provider after approval (F-16) |
| Tests | Contract tests (mock-labeled) for Add/Get/Set/Remove payloads, AddInId validation, details shapes, limits, malformed/missing fields, search restrictions, failures |
| Exit | Provider contract documented in `addin-data-provider.md`; tests pass; reconciles with legacy untyped records via a documented migration |
| Not done | No tenant verification (needs separate authorization) |

## Phase D — Identity and Security
| Item | Detail |
|---|---|
| Goal | Native identity, role mapping, authorization policy, fail-closed behaviour |
| Work | Decide role mechanism (A/B/C/D in `identity-and-authorization.md`, decision D-2); replace `User.role`; authorization policy functions enforced in the application layer before persistence; approver determination; self-approval rule; vehicle/driver access validation; documented residual risk of client-side-only enforcement (D-3); security matrix and tests; fix F-11/F-12 field assumptions (documented Device/User fields only; `isDriver`) |
| Exit | Security matrix implemented and tested; missing mapping → denied with reason; admin never default; `identity-and-authorization.md`, `vehicle-and-driver-integration.md`, `security-and-privacy.md` complete |

## Phase E — Booking Workflow
| Item | Detail |
|---|---|
| Goal | Centralized, validated workflow |
| Work | State machine per D-1 (port transitions from legacy API); create/edit/cancel/submit/approve/reject; mandatory rejection reason; repeated-action safety; separate start/end date/time + timezone context; overlap detection with buffers and approved blocking statuses; booking history; approver-time re-check and post-write reconciliation per approved concurrency strategy (D-4); advisory-availability messaging; no misleading success when persistence fails |
| Exit | Workflow rules unit-tested; concurrency limitation documented (`booking-concurrency-limitations.md`, `booking-workflow.md`); `LIVE_BOOKING_WRITE_ENABLED` still `false` |

## Phase F — Notification and Audit
| Item | Detail |
|---|---|
| Goal | Persisted notifications and audit; honest delivery claims |
| Work | Notification Center (read/unread, filters, booking links, refresh persistence); recipient-aware optional Service Add-In (F-07), bundle/registration verified against official docs (F-08), remove page-side native call (F-09); full audit event set with actor snapshot, previous/new values, reasons; append-only conventions; documented tamper limits; delivery limitations documented |
| Exit | `notification-architecture.md`, `audit-trail.md` final; tests pass; no claim of delivery to offline users |

## Phase G — Admin and Reporting
| Item | Detail |
|---|---|
| Goal | Configuration and summaries |
| Work | `config` record type; validated settings (approval rules, booking restrictions, allowed duration, advance window, business timezone, notification preferences, buffers); admin-only edits behind `ADMIN_CONFIGURATION_ENABLED`; safe defaults; config cannot override gates or MyGeotab permissions; booking/approval summaries, vehicle utilization, history reports |
| Exit | `admin-configuration.md` final; tests pass |

## Phase H — Legacy Backend Isolation
| Item | Detail |
|---|---|
| Goal | Native workflow is the default; legacy clearly isolated |
| Work | Root scripts default to web; `legacy:` prefix for API/db scripts; CI split (target job vs opt-in legacy job); Pages workflow cleaned (no API tests, no dead `VITE_API_BASE_URL`); architecture tests prove no web runtime dependency; archive/removal **proposal** only (see `legacy-backend-disposition.md`) |
| Exit | Legacy disposition approved in writing before any deletion; `legacy-backend-disposition.md` final |

## Phase I — Final QA
| Item | Detail |
|---|---|
| Goal | Regression, security, performance, compliance, readiness assessment |
| Work | Full regression; security review; performance review (call counts vs rate limits); WCAG 2.2 AA check; architecture compliance; production build; complete documentation set (`docs/mygeotab-native/` 18 documents); registration and deployment guide for administrator review; final readiness assessment |
| Final status choices | `NATIVE ADD-IN ARCHITECTURE COMPLETE — OFFLINE ONLY` · `CONDITIONALLY READY FOR CONTROLLED SANDBOX VALIDATION` · `BLOCKED`. Never production-ready while tenant validation, authorization or concurrency remain unresolved |

## Gate T — Controlled sandbox tenant validation (outside A–I; separately authorized)
Written administrator authorization; named non-production tenant; read-only first; then limited writes. Verifies every **Tenant-required** item in the matrix: `getSession`, `User` search, `details` shape, Groups, `Get` limits, select/where syntax, Device fields (plate/VIN), driver options, Service Add-In loading and delivery, clearance behaviour, concurrent-write behaviour, rate-limit behaviour. Until this gate passes, claims remain "offline/mock tested" only.

## Estimated effort (rough, [ASSUMPTION])
B ≈ 3–5 days, C ≈ 4–6, D ≈ 3–5, E ≈ 4–6, F ≈ 3–5, G ≈ 3–4, H ≈ 2–3, I ≈ 3–4 working days for one engineer, excluding approval wait times and Gate T.
