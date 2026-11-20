# Known Limitations
- No Notification Center UI (bell, badge, filter tabs, booking navigation) yet.
- Notification/audit writes are not yet invoked automatically by the booking workflow (UI handlers still use the legacy provider calls and legacy audit trail).
- Service Add-In unverified and disabled; likely build-format problem.
- Reminders have a type and text but no scheduler.
- Client-side scoping and non-tamper-proof audit (see security).
- Notification volume bounded by the 1000-record Get limit.
