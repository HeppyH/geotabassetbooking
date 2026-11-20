# Capability Gate Design

## Gates (all false in production)
`MYGEOTAB_IDENTITY_ENABLED`, `MYGEOTAB_STORAGE_ENABLED`, `LIVE_BOOKING_READ_ENABLED`, `LIVE_BOOKING_WRITE_ENABLED`, `APPROVAL_ACTIONS_ENABLED`, `ADMIN_CONFIGURATION_ENABLED`.

## Rules
- Single source: `src/runtime/capabilities.ts`. The production configuration is a frozen constant. No environment variable, `VITE_*`, localStorage, URL parameter, UI control or role can change it (tested with a fresh module import while all such sources say "true").
- Fail closed: only the boolean literal `true` enables a flag. Missing config, non-object config, strings, numbers, inherited properties and unknown keys never enable anything. Unknown capability names are denied.
- Prerequisites: STORAGE needs IDENTITY; READ needs STORAGE; WRITE needs STORAGE+READ; APPROVAL needs STORAGE+READ+WRITE; ADMIN needs IDENTITY+STORAGE.
- Tenant approval: `evaluate(name, tenantApproved)` denies unless `tenantApproved === true` (code `TENANT_NOT_APPROVED`).
- Decisions carry codes: `CAPABILITY_UNKNOWN`, `CAPABILITY_DISABLED`, `CAPABILITY_PREREQUISITE_DISABLED`, `TENANT_NOT_APPROVED`.

## Enforcement layers
1. `nativeRuntime.ts`: identity flag off → no API call at all (not even `getSession`).
2. `nativeProvider.ts`: per-method capability checks; `deleteBooking` and `resetDemoData` always rejected; approve/reject/assign need `APPROVAL_ACTIONS_ENABLED`.
3. `gatedApi.ts`: allowlist of API calls (Get Device/User/Group, Get/Add/Set/Remove AddInData). Anything else is denied; denied calls never reach the raw `api`.
4. UI: `accessPolicy.ts` derives enabled state from the runtime's access views.
5. Service Add-In and diagnostics: gated separately (see security-review).

`ADMIN_CONFIGURATION_ENABLED` is evaluated by the gate and tested, but no admin provider surface exists yet (Phase E).
