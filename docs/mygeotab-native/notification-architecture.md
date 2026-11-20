# Notification Architecture and Service Add-In Feasibility

Evidence labels: [DOC] [CODE] [TEST] [ASSUMPTION] [TENANT]. The Service Add-In was never executed in a tenant.

## 1. Two separate capabilities

| Capability | What it is | Reliability |
|---|---|---|
| **Persistence** | A notification record stored in AddInData (recipient, booking, type, text, read state, delivery state) | Reliable as storage; visible whenever the recipient opens the Add-In page and the page reads it |
| **Delivery** | A transient on-screen MyGeotab notification shown by the Service Add-In `service.notifications.show` | Best-effort only; depends on a MyGeotab session running the service |

They must not be treated as the same thing. A stored record is **not** a delivered notification, and a successful `show` call is **not** proof the intended recipient saw it.

## 2. What the docs confirm [DOC D3]
- A Service Add-In is WebWorker JavaScript with no UI, loaded from `serviceSrc`; its main function receives a `service` object with `api` (call, multiCall, getSession), `localStorage`, `notifications` and `page` services.
- `notifications.show(title, text, type, duration, buttons)`; max 2 visible at once; max 6 calls per minute.
- The service function runs when **a user opens a MyGeotab web page**.
- **Doc-silent:** whether a user must be logged in, behaviour when nobody has MyGeotab open, teardown, script module format, registration name, recipient targeting. **Do not claim** delivery to offline or non-MyGeotab users.

## 3. Current implementation [CODE]

| Piece | Behaviour | Issue |
|---|---|---|
| `NotificationEngine` (`notificationService.ts`) | Builds event notifications with idempotency key `notif:<kind>:<bookingId>:<recipient>`, persists via provider | Good; idempotency check = full `Get` scan (F-05) |
| Page-side "native" call | Calls `window.geotab.service.notifications.show` from the page | Not a documented page surface → effectively always `failed`; result discarded (`void delivery`) (F-09) |
| Service Add-In poll | Every 30 s `Get AddInData` where `details.delivery_status = "pending"`, up to 10 | No recipient filter (F-07); `whereClause` without `selectClause` (F-08); `resultsLimit` inside `search` (placement unverified) |
| Delivery marking | After `show`, `Set` record to `delivered`/`failed` | Marks other users' notifications delivered to the wrong viewer; no atomic claim; the second worker may duplicate |
| Rate limiting | `NotificationRateLimiter` 6 calls/min, 2 visible | Matches [DOC]; visibility decrement is a timer, not tied to `hide` |
| Service AddInId | Reads `service.localStorage` key else hard-coded default | Can diverge from page AddInId (F-10) |
| Bundle | `dist/serviceAddin.js` with ES `export` | Load compatibility unverified (F-08) |
| Read state | `markAsRead`, `markAllAsRead`, unread count | Whole-set scans; `getNotifications` offset bug (F-06) |
| Notification types | `booking_created, booking_approved, booking_rejected, vehicle_assigned, booking_cancelled` | Master prompt also lists *updated* and *reminder* |

## 4. Target design

1. **Notification Center in the page is the primary and reliable channel**: persisted records, read/unread, filters by type, link to booking, persistence across refresh. Fetch on open and via bounded refresh; no tight polling.
2. **Service Add-In is optional best-effort delivery**, enabled only if Phase F tenant validation proves it loads and works. If it cannot be proven, ship without it and use the Notification Center only.
3. **Recipient-aware delivery**: the service must resolve the running user (`service.api.getSession` + user lookup), fetch only records whose recipient equals that user, and update only those; never show another user's text.
4. **Separate records**: `deliveryStatus` transitions must be limited (`pending → shown`), tolerate duplicates, and never block the workflow.
5. **Respect limits**: ≤6 shows/min, ≤2 visible, AddInData Get 650/min; use `selectClause` + `whereClause` correctly only after doc/tenant verification; otherwise bounded `Get` and client filtering.
6. **Reminders** (booking reminder event) cannot rely on a durable scheduler; the Service Add-In is not a substitute for a background scheduler. Generate reminders opportunistically when users open the app, or omit; document the limit [master prompt §14].
7. **No external email/push channel** (would be an external dependency); out of scope.

## 5. Gaps to close (Phase F)
- Fix F-04/F-06 foundations in Phase C first.
- Remove page-side `showNativeNotification` or replace with in-page toast (UI only).
- Recipient filtering, atomic-ish claim strategy (documented as best-effort), duplicate tolerance.
- Add notification types for updated/reminder if approved.
- Validate service bundle format and registration against official docs/sample add-ins and a tenant.
- Build/hosting: serve `serviceAddin.js` as a classic worker-compatible script if required [TENANT].

## 6. Verification status
| Item | Status |
|---|---|
| Notification record persistence | Mock-tested; **Not verified in a tenant** |
| Read/unread logic | Unit/mock-tested; offset defect present |
| Service Add-In delivery | Mock-tested (28 tests) only; **Not verified in a tenant**; format/registration **Unverified** |
| Delivery to offline users | **Not supported / not verified**; do not claim |
