# Remaining Blockers and Carried-Over Items

**None block Phase B. All live capabilities remain disabled.**

1. Git state unverifiable (ZIP has no `.git`); user changes in a real working tree not checked.
2. No tenant validation of anything. Tenant allowlist is empty; a real tenant must be chosen and approved by the owner before any gate is enabled.
3. `auth/identityResolver.ts` still relies on undocumented `User.role` (F-02) — Phase C.
4. `serviceAddin.ts` `getAddInId` still reads `service.localStorage`; notification ownership/rate-limit issues (F-07/F-08/F-09); service bundle format (`tsc` ESM output) unverified in MyGeotab — Phase F.
5. Page-side native notification delivery is inert (no documented page-side API).
6. `data/mygeotabProvider.ts` is dead code; `data/types.ts` has a type-only import from `apps/api` (F-18); legacy `apps/api`, `db/`, root scripts and CI still default to the legacy backend — Phase H.
7. `ADMIN_CONFIGURATION_ENABLED` has no provider surface yet — Phase E.
8. `ADDIN_ID_STORAGE_KEY` constant is still exported (unused by native paths).
9. Dashboard/`TENANT` label (`VITE_GEOTAB_DATABASE`) is a simulation-only cosmetic fallback.
10. AddInData concurrency (no transactions/CAS) is unaddressed — Phase D.

Phase C onward was subsequently authorized and implemented; see `../implementation-status.md`.
