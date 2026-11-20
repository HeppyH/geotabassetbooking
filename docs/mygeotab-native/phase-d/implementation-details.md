# Implementation Details
## Roles (`authz/roles.ts`)
- Roles come only from `application_config` record `cfg_role_mapping` (payload `{kind:"role_mapping", updatedBy, entries:[{userId, role}]}`), plus `BOOTSTRAP_ADMINISTRATOR_IDS` (empty, frozen; usable only while no mapping exists).
- `parseRoleMapping` rejects the whole mapping on any defect (wrong kind, unknown role, duplicate user, >100 entries, bad ids).
- `loadRoleMapping` reads through the Phase C store; missing, duplicated (store reports duplicate ids), malformed or unreadable → no mapping → no role.
- `can(role, action, ctx)`: requester (create/edit-own/cancel-own/view-own/notifications-own); approver adds view-all, approve, reject; administrator adds cancel-any, admin.configure, audit.view. Own-actions require `requesterId === actorId`. Approve/reject deny when the booking owner is unknown or equals the actor (applies to administrators too).
## Identity (`auth/identityResolver.ts`)
Unchanged contract (session → `Get User` by name → exactly one match → id). Added: users outside `activeFrom/activeTo` are unresolved. The legacy `roles` field (from undocumented `User.role`, default "EMPLOYEE") is kept only for existing callers and tests; it is explicitly non-authoritative and no authorization code reads it.
## Runtime wiring (`runtime/nativeRuntime.ts`, `nativeProvider.ts`)
After identity and tenant checks, the role mapping is loaded only if the read capability is allowed. Access = capability gates AND role. `AppRuntime.native` now carries `role`/`roleReason`. The provider requires `roleAllows` (no permissive default) and denies role-forbidden writes/approvals before any API call.
## Master data
- `masterdata/vehicles.ts`: maps only documented Device fields; undocumented ones are ignored, never invented; active-window check; duplicate/invalid devices rejected; `isBookable` requires active.
- `masterdata/drivers.ts`: valid driver = `isDriver === true` AND active AND named; optional on bookings; references are user ids, names are rejected; `deriveAssignedDriver` is a pure helper over DriverChange-shaped data, NOT wired (source unverified), so the default driver stays empty.
## Changed files
New: `src/authz/roles.ts`, `src/masterdata/{vehicles,drivers}.ts`, `test/authzAndMasterData.test.mjs`. Modified: `src/auth/identityResolver.ts`, `src/runtime/{nativeRuntime,nativeProvider,appRuntime}.ts`, `src/storage/addinDataStore.ts` (duplicate rejections carry `recordId`), Phase B tests updated for the role requirement.
