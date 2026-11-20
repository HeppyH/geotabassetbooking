# Tests and Evidence
`npm test` (apps/web): 281 pass / 0 fail (268 + 13 in `notificationsAudit.test.mjs`). Typecheck clean.
Covered: type set; text builders; pagination (offset/limit/filters/edges, F-06 regression through the legacy provider with malformed and booking records present); recipient scoping for list/count/markRead/delivery; persistent read state across fresh store instances; mark all; idempotent creation; delivery-confirmation rule; corrupted records ignored; audit separate/append-only/actor/history/validation; diff of driver/vehicle/date-time; native provider cross-user denial, foreign idempotency lookup, audit visibility.
**Mocks only. Not tenant validation. No notification was sent.**
