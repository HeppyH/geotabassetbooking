# Architecture Decisions
1. Separate record types and prefixes for notifications and audit (no collision with bookings).
2. Recipient scoping at three layers: repository query, post-decode filter, native-provider wrapper.
3. Idempotent creation by key rather than by retrying Add.
4. Delivery status is data about delivery, not about persistence; `delivered` needs evidence.
5. Audit is append-only by API surface, explicitly not tamper-proof.
6. Service Add-In stays disabled; in-app centre is the baseline.
