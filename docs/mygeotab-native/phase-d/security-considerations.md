# Security Considerations
- Client-side policy only; direct API calls by a user with AddInData clearances bypass it (documented limitation, not solved).
- The role mapping is itself AddInData: anyone with Add/Set clearance could alter it. `updatedBy` is client-supplied and unauthenticated. Integrity of the mapping therefore depends on MyGeotab clearances (UNVERIFIED) and a future audit trail.
- Mapping duplicates are treated as ambiguous (fail closed) so a planted second mapping cannot silently win.
- Self-approval banned; unknown owner denied; inactive users denied.
- No role is inferred from names, e-mail, display text, or `User.role`.
