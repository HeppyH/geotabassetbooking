# AddInData Feasibility and Limitations

Evidence labels: [DOC] [CODE] [TEST] [ASSUMPTION] [TENANT]. See `official-geotab-documentation-matrix.md` for sources.

## 1. Verdict

AddInData is **feasible** as the only persistence layer for a low-volume fleet booking workload (tens of vehicles, hundreds–low thousands of bookings) **provided** the design accepts: no transactions, no per-record authorization, no rich queries, and rate limits. It is **not** suitable for guaranteeing double-booking prevention or tamper-proof audit.

## 2. Capabilities and constraints

| Aspect | Documented behaviour [DOC] | Design implication |
|---|---|---|
| Operations | Add (creates new object each call), Get (array, optional search), Set (update), Remove (by Id) | No upsert; client must hold the server Id for updates |
| Isolation | `addInId` isolates data between Add-Ins | AddInId is isolation, not per-user authorization |
| Record size | ≤ 10,000 chars JSON | One entity per record; booking ≈ 522 chars [TEST]; audit and notification records are comparable/smaller [ASSUMPTION] |
| Properties | `details` (current), `Data` (legacy, do not use); `geotabXYZ` names reserved | Use `details` only; validate names |
| Groups | Optional; scopes visibility when supplied | Group strategy needs tenant validation [TENANT] |
| Query | select/where with object paths, `= < > <= >=`, no AND/OR/LIKE, case-sensitive, whereClause requires selectClause | Treat queries as coarse filters; do the rest client-side on bounded data |
| Rate limits | Get 650/min, Set 1700/min, Add 100/min, Remove 2250/min (per user/db, tiered by asset count) | Cache, debounce refresh, back off on `OverLimitException` |
| Permissions | Method-level by clearance (Admin/Supervisor/Default/Drive App: all four; ViewOnly: Get; none: nothing) | Any permitted user can alter any record via the API |
| Concurrency | Not documented | No CAS/locking assumed |
| Ordering / paging / count | `Get` paging and default limit **not retrieved**; `GetCountOf` has its own rate limit | Verify before relying on server-side limits |

## 3. Gaps in the current implementation

| Gap | Ref | Required change |
|---|---|---|
| No record type/schema version | F-04 | Typed envelope (below) |
| Whole-set `Get` for every call | F-05 | Use `selectClause`/`whereClause` on `recordType` where valid, bounded `resultsLimit`, in-memory cache with TTL, single shared fetch per refresh |
| Malformed record handling inconsistent | F-04 | One validating `parseRecord` that quarantines, never discards or mutates unknown/corrupt records |
| Slice bug | F-06 | Replace ad-hoc pagination with tested helper |
| Details string/object ambiguity | matrix | Contract tests for both shapes |
| Error taxonomy missing | — | Map `OverLimitException`, permission, invalid AddInId, network, oversized, malformed into typed errors; never report success on failure |
| `Remove` available to UI paths | `deleteBooking` | Disable in native mode unless explicitly authorized |

## 4. Proposed record envelope (to be finalized in Phase C)

```json
{
  "schemaVersion": 1,
  "recordType": "booking | notification | audit | config | approval",
  "recordId": "stable application id (UUID-like, generated client-side)",
  "createdAtUtc": "2026-11-18T00:00:00.000Z",
  "updatedAtUtc": "...",
  "createdBy": { "userId": "b123", "nameSnapshot": "…" },
  "refs": { "bookingId": "…", "deviceId": "…", "userId": "…" },
  "payload": { }
}
```

Rules: UTC timestamps; unknown fields preserved; migrations versioned; booking, notification, audit and config are **separate records**; audit is append-only from the application workflow; the server `AddInData.id` is stored separately from the application `recordId` (today `id` is overwritten with the server id after Add, and `findBookingRecord` matches either, which makes identity ambiguous — F-04 related). [CODE]

## 5. Capacity estimate (assumptions)

| Item | Estimate | Basis |
|---|---|---|
| Booking record | ~0.5 KB | measured sample 522 chars [TEST] |
| 8 vehicles (README fleet seed) × ~5 bookings/week | ~2,000 bookings/year | [ASSUMPTION] |
| Audit events | ~4 per booking | [ASSUMPTION] |
| Notifications | ~2–3 per booking | [ASSUMPTION] |
| Total records/year | ~20k | derived |

At this scale whole-set client-side filtering stays workable only with caching and bounded queries; a year of audit/notification growth would make unbounded `Get` slow. **Archival/retention** (e.g., filter by date range via where clause on a UTC field, or a retention window) must be designed in Phase C. [ASSUMPTION] Actual `Get` limits and latency are [TENANT].

## 6. Items requiring tenant validation before reliance

1. Round-trip of `details` as object vs string for Add/Get/Set.
2. Effect of `groups: [{ id: "GroupCompanyId" }]` on visibility for different clearance levels.
3. Real `Get` default/max result counts and ordering.
4. `selectClause`/`whereClause` syntax against actual records.
5. Behaviour under concurrent writers (see `booking-concurrency-limitations.md`).
6. Behaviour at rate-limit boundaries.

None of these were validated in this phase.
