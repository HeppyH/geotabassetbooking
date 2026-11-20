# Architecture Decisions
1. Preserve, don't delete: legacy backend, migrations, scripts and docs stay until a safe disposition is agreed.
2. Isolation by construction: no import path, no default script, no default CI job and no Pages step reaches it; enforced by tests.
3. Web-only installs in the native CI/Pages jobs so Hono/PostgreSQL tooling is not needed to build the Add-In.
4. Rename (not alias) legacy scripts to prevent accidental use; documented as a breaking change for old command names.
5. Keep `apps/api` as an npm workspace for now (changing workspaces would rewrite the lockfile, which cannot be validated offline).
