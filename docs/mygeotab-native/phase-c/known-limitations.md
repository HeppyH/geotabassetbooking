# Known Limitations
- No atomicity: `update` is check-then-set with a race window; `add` duplicate check is client-side only.
- No pagination; >1000 records are silently invisible except for the `possiblyTruncated` flag.
- Cache is per store instance and per page session; other users' changes appear after TTL or refresh.
- Real behaviour of `details` typing, clauses and limits is UNVERIFIED.
- Existing provider not yet migrated; its booking/notification/audit records use the legacy shape.
