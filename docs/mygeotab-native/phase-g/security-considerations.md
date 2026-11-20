# Security Considerations
- Client-side admin policy only; a user with Set clearance can rewrite settings or the role mapping directly, including granting themselves administrator. This is the largest open security gap and the reason live writes/approvals/admin remain disabled.
- `updatedBy` is client-supplied. There is no signed change history; the audit repository records admin actions only if callers append them (not yet wired).
- Settings cannot reach capability gates or the tenant allowlist.
- Last-administrator rule prevents accidental lockout, not malicious overwrite.
