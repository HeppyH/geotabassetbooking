# Tests and Evidence
`npm test` (apps/web): 292 pass / 0 fail (281 + 11 in `adminReports.test.mjs`). Typecheck clean.
Covered: settings validation (ranges, types, unknown keys, capability names rejected); admin-only saves/loads for requester, approver, no role, empty actor — with zero writes on denial; save/reload/update in place; corrupt or unreadable settings → defaults; capability config unchanged; role-mapping validation and last-administrator rule; reports exclude notification/audit/config/invalid records; summaries, utilization (clipping, merged overlaps, used statuses, invalid periods), history ordering.
**Mocks only. Not tenant validation.**
