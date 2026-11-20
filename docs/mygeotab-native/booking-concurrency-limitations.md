# Booking and Concurrency Limitations

Evidence labels: [DOC] [CODE] [TEST] [ASSUMPTION] [TENANT]. No concurrency behaviour was tested in a tenant.

## 1. Statement of limitation

- **Availability checking is advisory.** The check happens in the browser against data read earlier.
- **Get → check → Add is not atomic.** Two users can both pass the check and both create overlapping bookings.
- **No atomic reservation, locking or compare-and-swap is documented for AddInData.** The Add-In Storage page says nothing about transactions, concurrency or locking [DOC]; this absence is not proof of atomicity.
- **Concurrent booking requests may cause double-booking.**
- **Live booking writes must remain disabled** until a concurrency strategy has been reviewed and approved, or the residual risk is accepted through a separate business approval.
- No simulated concurrency mechanism may be presented as a native MyGeotab guarantee, and no external database may be introduced to simulate one.

## 2. Current implementation [CODE]

| Step | Code | Weakness |
|---|---|---|
| Conflict check | `AddInDataBookingDataProvider.createBooking`: `getBookings()` then `overlaps(new, existing)` for statuses `PENDING_APPROVAL, APPROVED, ASSIGNED` | Race window = full network round trips; includes phantom records (F-04); ignores `bufferBeforeMinutes`/`bufferAfterMinutes`; only in AddInData provider (the demo provider does not check) |
| Persist | `Add` with a client-generated `addin-<Date.now()>` id, later replaced by server id | `Date.now()` collisions possible; no uniqueness constraint |
| Update | Read-modify-write: `findBookingRecord` (full `Get`) → mutate → `Set` full `details` | Lost updates (e.g., cancel vs approve); `version` is incremented client-side and never checked |
| Status change | No transition validation (F-03) | Invalid sequences possible |
| Overlap rule | `a.start < b.end && b.start < a.end` | Correct interval logic; also in legacy API |

## 3. Legacy comparison (reference only)
The legacy PostgreSQL design prevents conflicts with row locks (`FOR UPDATE`), `reservation_slots` and a GiST exclusion constraint (`db/migrations/0002`). **None of these mechanisms exist in AddInData** and none may be reintroduced through an external database.

## 4. Mitigation options (to be evaluated in Phase E; none is a guarantee)

| ID | Mitigation | What it reduces | What remains |
|---|---|---|---|
| M-1 | Approval as the serialization point: approver UI re-reads and re-checks overlaps against APPROVED/ASSIGNED bookings immediately before approving; block approval on conflict | Most double-booking, since humans approve one at a time | Two approvers acting simultaneously; stale reads |
| M-2 | Post-write reconciliation: after `Add`, re-`Get` and detect overlaps; deterministic winner (e.g., earliest `createdAtUtc`, tie-break by id); loser flagged `CONFLICT` and notified | Detects almost all races quickly | Brief window where both appear valid; clock skew between clients |
| M-3 | Periodic reconciliation report for administrators (overlap scan) | Finds residual conflicts | Detective only |
| M-4 | Short "soft hold" record written before final submit | Narrows race window | Still no atomic guarantee |
| M-5 | Restrict who can submit/approve (few approvers) | Fewer concurrent writers | Process control, not technical |
| M-6 | Accept residual risk with written business approval | — | Risk owned by business |

Prohibited: simulated locks presented as native guarantees; external DB/backends.

## 5. Required validation before enabling `LIVE_BOOKING_WRITE_ENABLED`
1. Business decision on which mitigations (M-1…M-6) apply and on residual-risk acceptance (decision D-4).
2. Unit tests for overlap, buffer handling, transition rules, reconciliation determinism (mock-labeled).
3. **Controlled tenant experiment** (separately authorized): two concurrent sessions creating overlapping bookings; record observed outcomes; verify reconciliation. Until done, concurrency behaviour is **Not verified in a tenant**.
4. Documentation of conflict UX (user told that availability is advisory).

## 6. Other booking-domain notes
- Status model: code has 13 statuses (`DRAFT, SUBMITTED, PENDING_APPROVAL, APPROVED, ASSIGNED, CHECKED_OUT, OVERDUE, RETURNED, CLOSED, COMPLETED, REJECTED, CANCELLED, EXPIRED`); master prompt suggests 6 (`Draft, Pending, Approved, Rejected, Cancelled, Completed`). Decision D-1.
- Which statuses block availability must be an approved business rule (today: `PENDING_APPROVAL, APPROVED, ASSIGNED`; `SUBMITTED`, `CHECKED_OUT`, `OVERDUE` are not blocking in the AddInData check — likely oversight; confirm).
- Buffers (0 before / 30 minutes after) are hard-coded constants and should move to validated configuration (Phase G).
- Time: instants are stored as UTC ISO strings; timezone context is not stored per booking (F-19).
