# Implementation Details
## Notifications (`notifications/notificationRepo.ts`)
- Types: `booking_created` (= submitted), `booking_approved`, `booking_rejected`, `booking_cancelled`, `booking_updated`, `booking_reminder`, plus existing `vehicle_assigned`.
- Record: Phase C envelope (`ntf_` ids); payload has event/idempotency ids, recipient user id, booking id, title, message, `isRead`, `readAt`, `deliveryStatus` (`not_applicable|pending|delivered|failed`), `deliveredAt`.
- Recipient scoping: repository bound to the authenticated actor; `queryNotifications` filters by recipient, then read/type filters, sorts newest first, THEN paginates; results are re-checked before return. `markRead`/`setDeliveryStatus` on another user's id → NOT_FOUND.
- `create` is idempotent on `idempotencyKey`. `markRead`/`markAllRead` use the store's stamp-checked `update` (persistent, conflict-aware).
- `setDeliveryStatus(..., "delivered")` throws without `{channel, confirmedAt}`.
- Malformed notification records are ignored, never rendered.
## F-06 fix (`data/addinDataProvider.ts`)
`slice(offset ?? 0, offset ?? 0 + limit)` parsed as `offset ?? (0 + limit)` and returned an empty page whenever an offset was supplied. Now start/end are computed explicitly. The reader also skips malformed/non-notification records instead of throwing or mis-reading booking records.
## Native provider scoping (`runtime/nativeProvider.ts`)
`getNotifications`, `getUnreadCount`, `markAllAsRead` require `userId === authenticated user`; `markAsRead` requires the notification to belong to the actor; `findByIdempotencyKey` returns null for foreign notifications; `getAuditRecords` is limited to the booking owner, approvers and administrators.
## Audit (`audit/auditRepo.ts`)
Separate `aud_` records; repository exposes only `append` and `history` (no update/remove). Actor = authenticated user. Actions: CREATE, EDIT, SUBMIT, APPROVE, REJECT, CANCEL, ASSIGN, COMPLETE, DRIVER_CHANGE, VEHICLE_CHANGE, DATETIME_CHANGE. `diffBooking` records old/new values for driver, vehicle and date/time (plus purpose/destination). Reasons ≤500 chars, ≤20 changes per entry.
## Changed files
New: `src/notifications/notificationRepo.ts`, `src/audit/auditRepo.ts`, `test/notificationsAudit.test.mjs`. Modified: `src/data/addinDataProvider.ts`, `src/runtime/nativeProvider.ts`. (`src/audit/auditTrail.ts` is pre-existing legacy code, untouched.)
