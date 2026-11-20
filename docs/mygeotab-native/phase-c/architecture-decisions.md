# Architecture Decisions
1. Envelope + type-prefixed ids over ad-hoc per-type shapes (F-04).
2. Reader tolerant (object or JSON string), writer emits object — `details` format UNVERIFIED against a tenant.
3. Bounded read + client filtering instead of invented server-side filtering/pagination (F-05).
4. No auto-retry for non-idempotent `Add`/`Remove`.
5. Optimistic stamp check for updates; documented as advisory (F-14).
6. Store consumes only the Phase B gated api; capability checks stay outside the store.
7. Provider migration deferred to Phase E/F to keep existing behaviour and tests intact.
