# Security Considerations
- Removing the API URL variable and Worker wiring eliminates an accidental path to an external backend from the production bundle (also checked in the built bundle: no `workers.dev`/`8787`).
- The Pages workflow still publishes `dist` including source maps (`sourcemap: true`); consider disabling for production (open item).
- Legacy code is untouched and still contains its own security gates (identity adapter fail-closed); it must not be deployed alongside the native Add-In.
- `apps/api` remains in the install of the `legacy-backend` CI job only.
