# Security Considerations
- Notification and audit scoping is client-side. Any user with AddInData Get clearance can read every notification and audit record via the raw API; Set/Remove clearance allows altering or deleting them. Do not describe either as confidential or tamper-proof.
- `createdBy`/`actorId` and timestamps are client-supplied.
- Notifications contain only titles, booking ids and short reasons; no tokens or personal data beyond ids.
- A Service Add-In reading all pending notifications (F-07) would cross user boundaries: kept disabled.
