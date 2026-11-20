# Implementation Details
## Settings (`admin/config.ts`)
`AppSettings`: `timeZone` (valid IANA, default Asia/Jakarta), `minDurationMinutes` 1–1440 (default 15), `maxDurationMinutes` ≥ min and ≤ 129600 (default 14 days), `maxAdvanceDays` 0–730 (default 180), `destinationRequired` (default false), `approvalRequired` (must be `true`), `notificationPreferences` (known notification types only, booleans, missing → true). Unknown keys are rejected, including any capability name. Stored as `cfg_app_settings` (Phase C envelope).
`loadSettings` returns stored settings or conservative defaults plus a reason (missing, invalid, unreadable) — it never throws on bad data. `saveSettings` validates, requires administrator, and updates in place with the store's stamp check.
## Role administration
`saveRoleMapping` (administrator only) validates through `parseRoleMapping`, requires at least one administrator, sets `updatedBy` to the authenticated actor, and upserts `cfg_role_mapping`. `loadRoles` is administrator-only.
## Reports (`reports/reports.ts`)
`bookingsFromRecords` keeps only `booking` records whose payload passes `parseBookingRecord` and counts the rest as skipped (notification/audit/config records can never become bookings). `bookingSummary` (counts per status), `approvalSummary` (pending/approved/rejected, average decision minutes from `createdAt`→`approvedAt`), `vehicleUtilization` (booked hours and % per vehicle, clipped to the period, overlapping bookings merged, only used statuses count), `bookingHistory` (newest first).
## Changed files
New: `src/admin/config.ts`, `src/reports/reports.ts`, `test/adminReports.test.mjs`; `test/runtimeArchitecture.test.mjs` extended (purity of admin/reports/notifications).
