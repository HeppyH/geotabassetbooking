# Implementation Details
## State machine (`booking/stateMachine.ts`)
Statuses (unchanged): DRAFT, SUBMITTED, PENDING_APPROVAL, APPROVED, ASSIGNED, CHECKED_OUT, OVERDUE, RETURNED, CLOSED, COMPLETED, REJECTED, CANCELLED, EXPIRED. New bookings start at PENDING_APPROVAL (existing behaviour).
Edges: DRAFT→SUBMITTED|PENDING_APPROVAL|CANCELLED; SUBMITTED→PENDING_APPROVAL|CANCELLED; PENDING_APPROVAL→APPROVED|REJECTED|CANCELLED|EXPIRED; APPROVED→ASSIGNED|CANCELLED|EXPIRED; ASSIGNED→COMPLETED|CANCELLED|CHECKED_OUT; CHECKED_OUT→RETURNED|OVERDUE; OVERDUE→RETURNED; RETURNED→CLOSED|COMPLETED. Terminal: CLOSED, COMPLETED, REJECTED, CANCELLED, EXPIRED.
Permissions: approve/reject — approver or administrator, never the requester (including administrators); reject needs a reason (≤500 chars); cancel — owner or administrator; submit/complete — owner (complete also approver/administrator); assign and the legacy vehicle-flow statuses — approver/administrator; EXPIRED — administrator. Repeating the current status is a no-op after the permission check. Editing is allowed only for the owner in DRAFT/PENDING_APPROVAL (an approved booking must be cancelled and recreated).
## Schedule (`booking/schedule.ts`)
Local `YYYY-MM-DD` + `HH:mm` in an IANA zone (default Asia/Jakarta) → UTC ISO via `Intl`; start and end carry their own date and time; end must be after start; DST gap/overlap times rejected; optional duration/advance limits (`checkLimits`, to be configured in Phase G).
## Availability (`booking/availability.ts`)
Half-open overlap `existing.start < requested.end AND existing.end > requested.start`; only blocking statuses (SUBMITTED, PENDING_APPROVAL, APPROVED, ASSIGNED, CHECKED_OUT, OVERDUE) on the same vehicle; optional buffers; duplicate (double-submit) detection; `reconcile` and `checkAfterWrite` for post-write conflict resolution; `ADVISORY_NOTE` for the UI. A booking that is not yet visible after Add is reported as `missing` (re-read), never assumed successful and never re-Added blindly.
## Record model (`booking/model.ts`)
Fields per E.1: vehicle id + name snapshot, requester id + name snapshot, optional driver id + name (set together), local start/end date/time, UTC start/end, time zone, purpose, optional destination (required via rule), status, approver, approval time, rejection reason, created/updated. Status-dependent checks (rejected needs reason; approved/assigned need approver and time; approver ≠ requester).
## Search (`booking/search.ts`)
Status, vehicle, requester, date-range overlap and case-insensitive text filters; visibility: requesters see own bookings, approvers/administrators see all.
## Provider enforcement (`runtime/nativeProvider.ts`)
`updateBookingStatus` (native path only): approver id must equal the authenticated user; current booking is read fresh; `evaluateTransition` decides; no-op → no write.
## Changed files
New: `src/booking/{stateMachine,schedule,availability,model,search}.ts`, `test/bookingWorkflow.test.mjs`. Modified: `src/runtime/{nativeProvider,nativeRuntime}.ts`, `test/nativeRuntime.test.mjs`, `test/runtimeArchitecture.test.mjs`.
