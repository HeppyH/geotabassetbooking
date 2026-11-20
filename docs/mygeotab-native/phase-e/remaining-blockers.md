# Remaining Blockers
1. Business decision: accept non-atomic booking writes (advisory detection + manual reconciliation), or require a MyGeotab-side mechanism; until then `LIVE_BOOKING_WRITE_ENABLED` stays false.
2. Sandbox: real AddInData concurrency, ordering and rate-limit behaviour.
3. Migration of UI and provider to the E.1 model and the Phase C store.
4. Clearance model: can MyGeotab restrict who may Set booking records (otherwise direct API writes bypass all rules)?
