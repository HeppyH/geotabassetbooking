# Tenant Context Validation

`validateTenantContext(raw, allowlist = APPROVED_TENANT_CONTEXTS)` in `src/runtime/tenantContext.ts`.

- Input is the session context from `api.getSession` (`database`, optional `server`). No data access happens before validation.
- Result codes: `TENANT_CONTEXT_MISSING`, `TENANT_CONTEXT_INVALID` (database must match `^[A-Za-z0-9_-]{1,100}$`; server must be a plausible hostname), `TENANT_ALLOWLIST_INVALID` (not an array, or any malformed entry → deny everything), `TENANT_ALLOWLIST_EMPTY`, `TENANT_NOT_APPROVED`.
- Matching is exact and case-sensitive on `database`; an allowlist entry that names a `server` also requires it.
- **Production allowlist is empty, so every tenant is denied.**
- After identity resolves, the principal's session database must equal the validated tenant, otherwise the runtime is blocked.

The identity call (`Get User`) is made only after the tenant passes. Tests inject mock allowlists such as `mock_tenant_a`; these are fixtures, not real tenants. Which real tenant identifiers are acceptable remains an owner decision for a later phase.
