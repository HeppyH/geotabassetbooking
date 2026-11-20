# Architecture Decisions
1. One state machine, existing statuses kept; rejection reason and self-approval ban enforced centrally.
2. Permission checked before edge validity (an unauthorized caller learns nothing about valid edges).
3. Reject DST-ambiguous times instead of guessing.
4. Advisory availability + deterministic post-write reconciliation; no claim of atomicity; no external service.
5. Editing locked after a decision (cancel + recreate) to keep approvals meaningful.
6. Domain modules are pure and storage-agnostic; wiring to the Phase C store is the next step.
