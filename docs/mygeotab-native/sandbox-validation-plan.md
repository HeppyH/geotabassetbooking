# Sandbox Validation Plan (to be run by authorized people; NOT executed)

Preconditions: a non-production MyGeotab database, a written test scope, test users for each OPEX role, owner approval. Record every result; mocks do not substitute for these checks.

| # | Question | Procedure | Pass criteria | Capability unlocked |
|---|---|---|---|---|
| 1 | Session and identity | Open the page; confirm `getSession` shape; `Get User` by `name` returns exactly the signed-in user; `id` stable | Single match, stable id, inactive user excluded | IDENTITY |
| 2 | Tenant allowlist | Add the sandbox database to the allowlist in a branch build | Other databases remain denied | IDENTITY |
| 3 | AddInData `details` | Add/Get/Set/Remove with object and with JSON string; record exact returned types | Round trip equals input; limit behaviour at 10,000 chars | STORAGE |
| 4 | Query grammar and limits | Try `selectClause`/`whereClause`; measure result ceiling | Documented behaviour recorded | STORAGE/READ |
| 5 | Clearances | For each test role, which of Add/Get/Set/Remove succeed on AddInData; can a non-admin write `cfg_role_mapping`, other users' notifications, audit records? | Matrix recorded; decision whether protection is adequate | WRITE/APPROVAL/ADMIN (decision) |
| 6 | Device fields | Inspect real `Device` payloads for the documented fields and for licensePlate/VIN | Field availability recorded | master data |
| 7 | Driver assignment | `DriverChange` Get parameters; derive current driver for a device | Source verified or default stays empty | default driver |
| 8 | Concurrency | Two clients create overlapping bookings simultaneously; observe ordering/visibility and reconciliation | Detection works; business accepts residual risk in writing | WRITE |
| 9 | Notifications | Cross-user visibility through raw API; read-state persistence | Findings recorded | — |
| 10 | Service Add-In | Worker format (classic vs module), registration function name, logged-out behaviour, delivery | Verified or service stays disabled | service |
| 11 | Rate limits | Sustained Get/Add load | Within documented rate limits | — |
| 12 | Registration schema | Add-In JSON and menu path accepted | Page loads from the menu | — |

Stop conditions: any unexpected write to non-sandbox data, any real user notification, any change to security clearances outside the agreed scope.
