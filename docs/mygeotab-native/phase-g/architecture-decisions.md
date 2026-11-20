# Architecture Decisions
1. Settings and role mapping are AddInData config records; no external config service.
2. Strict schema, unknown keys rejected, so settings cannot smuggle capability or tenant changes.
3. Fail to defaults (reported) on bad stored settings; defaults are conservative.
4. Last-administrator protection to avoid lockout via the UI path.
5. Reports are pure functions over validated bookings; utilization merges overlaps to avoid double counting.
6. Approval stays mandatory (`approvalRequired: true` only).
