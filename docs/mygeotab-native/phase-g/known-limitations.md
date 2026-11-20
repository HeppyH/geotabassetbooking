# Known Limitations
- No admin or reporting UI; the existing UI is unchanged.
- Settings are not yet applied by booking creation (limits, time zone, destination rule) in the UI/provider.
- Notification preferences are stored but not consulted when notifications are created.
- Reports read at most 1000 AddInData records (no pagination); results are partial beyond that.
- No export, no charts, no audit-history report UI.
- Admin actions are not yet written to the audit trail.
