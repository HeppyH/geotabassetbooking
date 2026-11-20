# Official Geotab Documentation Reference Matrix

Retrieved 2026-11-18 from developers.geotab.com through the research tools of this session. Content was read as summarized extracts; where a page could not be retrieved or does not state something, it is marked **Unverified**. **Nothing here was verified in a real tenant.** Do not treat code that mocks an API as proof of API behaviour.

Status key: **Doc-confirmed** (stated on the retrieved page) · **Doc-silent** (page does not say) · **Not retrieved** (fetch blocked/failed) · **Tenant-required**.

## 1. Pages consulted

| Ref | Page | Retrieved |
|---|---|---|
| D1 | Add-In Storage API — https://developers.geotab.com/myGeotab/addIns/addInStorage/ | Yes |
| D2 | AddInData object — https://developers.geotab.com/myGeotab/apiReference/objects/AddInData/ | Yes |
| D3 | Service Add-Ins — https://developers.geotab.com/myGeotab/addIns/serviceAddins | Yes |
| D4 | Developing Add-Ins — https://developers.geotab.com/myGeotab/addIns/developingAddIns/ | Yes |
| D5 | User object — https://developers.geotab.com/myGeotab/apiReference/objects/User/ | Yes |
| D6 | Device object — https://developers.geotab.com/myGeotab/apiReference/objects/Device/ | Yes |
| D7 | GoDevice object — https://developers.geotab.com/myGeotab/apiReference/objects/GoDevice/ | Yes |
| D8 | DriverChange object — https://developers.geotab.com/myGeotab/apiReference/objects/DriverChange/ | Yes |
| D9 | Working with Rate Limits — https://developers.geotab.com/myGeotab/guides/rateLimits | Yes |
| D10 | Community thread on Add-In authentication — https://support.geotab.com/community/sdk-api/2348/how-to-properly-handle-data-access-and-authentication-in-a-geotab-add-in | Yes (non-normative) |
| — | `Get` method reference (resultsLimit default/max, paging) | **Not retrieved** |
| — | Add-In `api` object reference (`call`, `multiCall`, `getSession` for custom pages) | **Not documented on D4 extract**; `getSession` appears on D3 for services |
| — | Security Clearances / Groups documentation | **Not retrieved** |
| — | Official sample Add-Ins / SDK examples | **Not retrieved** |

## 2. Findings by topic

| Topic | What the docs say | Status | Impact on code |
|---|---|---|---|
| AddInId | Encoded GUID created before use; required for Add and Get; isolates each Add-In's data; example value 23 chars; generation described via an example script (Base64, character swap, fixed-length part, `a` prefix) | Doc-confirmed (format); exact algorithm **Unverified** | `addinId.ts` matches length/prefix; verify with the official script (F-25) |
| Add | Creates a new object with a unique Id bound to the AddInId; each call creates a new object | Doc-confirmed (D1) | No upsert/unique key; duplicates possible |
| Get | Returns an array; optional search object | Doc-confirmed | Default/max `resultsLimit` and paging **not retrieved** |
| Set | Updates by AddInId and object; returns null | Doc-confirmed | No concurrency token documented |
| Remove | Deletes by Id; returns null | Doc-confirmed | Any permitted user can delete audit/booking records |
| Details vs Data | `Details` is the current JSON property; `Data` is legacy and slated for removal | Doc-confirmed (D1). D2 describes `details` as a serialized JSON string; D1 says object. **Ambiguous** | Provider already accepts string or object; must contract-test both (Phase C) |
| Size limit | JSON per AddInData object ≤ 10,000 characters | Doc-confirmed | Sample booking = 522 chars [TEST]; fine |
| Reserved names | `geotabXYZ` property names reserved | Doc-confirmed | Avoid in schema |
| Groups | Optional; omitted = not group-restricted; included = limited to groups | Doc-confirmed (D1) | Code hard-codes `GroupCompanyId`; effect on visibility **Tenant-required** |
| Search | `selectClause`/`whereClause` use object-path notation; `=,<,>,<=,>=`; whereClause needs selectClause; no AND/OR; no LIKE; case-sensitive; arrays via `[]`; string values quoted/escaped | Doc-confirmed | Service Add-In sends whereClause without selectClause (F-08); app should filter client-side after bounded Get |
| Transactions / locking | Page contains nothing about transactions, concurrency or locking | **Doc-silent** | Cannot claim atomicity (F-14) |
| Permissions | Administrator, Supervisor, Default User, Drive App User: Add/Set/Get/Remove; ViewOnly: Get only; no clearance: none | Doc-confirmed | Per-method only; no per-record/owner rule (F-13) |
| AddInData rate limits | Get 650/min, Set 1700/min, Add 100/min, Remove 2250/min, GetCountOf 100/min | Doc-confirmed (D2) | Auto-refresh + whole-set Gets (F-05) |
| Rate-limit scope | Per method + entity + user + database; tiered multiplier by tracked-asset count; `OverLimitException` with `Retry-After`; keep ≥1010 ms between calls; prefer GetFeed where supported | Doc-confirmed (D9) | Add backoff handling (Phase C) |
| Custom page config | `name`, `supportEmail`, `items[url,path,menuName,svgIcon,category]`, `files` (`{}` when using items), `version`, `key`, `signature`, `enableViewSecurityId`, `securityIds` | Doc-confirmed (D4) | Whether `files` is mandatory, and menu path validity: **Tenant-required** (F-26) |
| Lifecycle | `initialize(api,state,callback)`, `focus(api,state)`, `blur(api,state)`; call `callback` after async setup | Doc-confirmed | Matches `main.tsx` |
| Namespace | `geotab.addin.<name>`, no hyphens | Doc-confirmed | `opexVehicleBooking` OK |
| Hosting | Own server; HTTPS, TLS ≥ 1.2; publicly reachable; URL must not contain `-`, `@`, `#`; no IP allow-listing | Doc-confirmed | Pages URL OK as written; custom domains with hyphens would not be |
| Accessibility | WCAG 2.2 AA required | Doc-confirmed | Phase B/I audit |
| Custom clearances | `enableViewSecurityId` creates a "View {ADDIN_NAME}" clearance; `securityIds` adds custom clearance entries (v9.0+) | Doc-confirmed (D4) | **Candidate native mechanism for OPEX roles**; how an Add-In reads the current user's clearances is **Not retrieved / Tenant-required** |
| Page `api` object | Signed-in API object running as the current user | Doc-confirmed | `call`, `getSession`, `multiCall` signatures for custom pages **Unverified** here |
| Service Add-In | WebWorker JS at `serviceSrc`; main function receives `service` (api, localStorage, notifications, page); runs when a user opens a MyGeotab page | Doc-confirmed (D3) | Script format (module vs classic), registration name, teardown **Doc-silent** (F-08) |
| Notifications | `notifications.show(title,text,type,duration,buttons)`; ≤2 visible; ≤6 calls/min | Doc-confirmed | Constants in code match; offline/not-logged-in delivery **Doc-silent** |
| User properties | `id,name,firstName,lastName,securityGroups,companyGroups,isDriver,employeeNo,activeFrom,activeTo,userRole,customUserRole,userAuthenticationType`; **no `role`** | Doc-confirmed (D5) | `User.role` usage is wrong (F-02) |
| Device properties | `id,name(≤50),serialNumber,groups,activeFrom,activeTo,comment,deviceType,timeZoneId,…`; no `make/model/vehicleClass/status` | Doc-confirmed (D6) | F-11 |
| Vehicle identity | `licensePlate`, `licenseState`, `vehicleIdentificationNumber` documented on GoDevice (base for GO products) | Doc-confirmed (D7) | Availability for non-GO/custom devices **Unverified** |
| Drivers | `User.isDriver` documented; `DriverChange` records a device↔driver change at a time; the page does **not** present it as the way to find a device's current driver | Doc-confirmed / Doc-silent (D5, D8) | Assigned-driver default is **Unverified** (`vehicle-and-driver-integration.md`) |
| Add-In auth model | Add-In calls run under the signed-in user's session and data access (community reply, non-normative) | Doc-confirmed (non-normative, D10) | Supports no-external-auth design |

## 3. Open documentation questions to resolve before Phase C/D

1. `Get` method: default and maximum `resultsLimit`; sort and paging for AddInData.
2. Exact AddInId generation script; confirm the current derivation.
3. Exact Service Add-In script format and registration (module vs classic worker).
4. Security clearances: how to read current user's clearances/security groups inside a custom page.
5. Whether `groups` is mandatory in practice for Add and what visibility `GroupCompanyId` yields.
6. Whether `details` is returned as object or string by `Get` in the current server version.
7. Device subtypes returned by `Get Device` and where `licensePlate`/VIN live for non-GO devices.
8. Official guidance for current driver of a device.
9. Behaviour of `Get User` with `search: { name }` (case, exactness).

Each item must be recorded with the page, date and outcome in the final `official-geotab-documentation-matrix.md` at Phase I.


---

## Additions during implementation (Phases C–F)

| Topic | Finding | Status |
|---|---|---|
| `User.role` | Not a documented property of `User`; `userRole` (job function), `isDriver`, `activeFrom`, `activeTo`, `securityGroups` are documented | Doc-confirmed (summarized fetch, Phase D); OPEX roles therefore do not use it |
| `Device` fields | Documents `id`, `name` (max 50), `comment`, `serialNumber`, `groups`, `activeFrom`, `activeTo`, `timeZoneId`, `deviceType`; does **not** document `licensePlate`, `vehicleIdentificationNumber`, `make`, `model`, `vehicleClass`, `status` | Doc-confirmed; undocumented fields are not used by `masterdata/vehicles.ts` (legacy provider still reads some; see blockers) |
| `DriverChange` | Documented object (device, driver, dateTime, type); Get search parameters and "current driver" derivation not documented | Doc-silent → default driver stays empty |
| Service Add-In | Config keys `serviceName`/`serviceSrc`; WebWorker; worker script format and the registration function's global name not stated; 2 visible / 6 per minute notification limits; runs when a user opens a MyGeotab page | Doc-confirmed / Doc-silent as noted; our ESM build ends with `export {…}` → likely incompatible (UNVERIFIED) |
| AddInData `details` | 10,000-character limit; object vs JSON-string storage behaviour, `selectClause`/`whereClause` grammar, result ceiling | Limit Doc-confirmed; others Tenant-required (reader accepts both forms, writer emits an object) |
| Concurrency | No documented transaction or compare-and-set | Doc-silent → advisory detection only |
| Static hosting | Add-In files are hosted on HTTPS | Doc-confirmed (D4) |
