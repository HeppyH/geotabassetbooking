# LEGACY — not the target architecture

This Hono / Cloudflare Worker / PostgreSQL scaffold predates the decision to make OPEX Vehicle Booking a
100% MyGeotab native Add-In (AddInData is the only persistent store; there is no external application
backend or database). It is preserved, unmodified, until a safe disposition is agreed.

- Nothing in `apps/web` imports from this package (enforced by `apps/web/test/runtimeArchitecture.test.mjs`).
- Default root scripts (`dev`, `build`, `test`, `typecheck`) do not run it. Use the `legacy:*` scripts.
- Do not deploy it, run `legacy:db:migrate`, or provision Neon/Hyperdrive for the native Add-In.
- See `docs/mygeotab-native/phase-h/` for the isolation record.
