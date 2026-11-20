# Service Add-In Review (F.3)
Source: https://developers.geotab.com/myGeotab/addIns/serviceAddins (read through a summarizing fetch tool; re-verify wording in the sandbox).

| Question | Documented answer | Our code | Status |
|---|---|---|---|
| Registration | Add-In configuration keys `serviceName` and `serviceSrc` (URL of a JS file) | Not configured anywhere | Not registered; no tenant change made |
| Worker format | JS file runs in a WebWorker; ES module vs classic script **not stated** | `build:service` emits ESM and the output ends with `export { … }` (line 255 of `dist/serviceAddin.js`) | **UNVERIFIED, likely incompatible**: an `export` statement is a syntax error in a classic worker script |
| Registration function | A "main function" taking one `service` argument; its global name is **not documented** on that page | Assigns `geotab.addin.service` | **UNVERIFIED** |
| `service` object | `notifications.show(options)` → object with `hide()`, `api.call/multiCall/getSession`, `localStorage.get/set/remove`, `page.*` | Uses `api.call`, `api.getSession`, `notifications.show`, `localStorage` | Matches on names; promise semantics UNVERIFIED |
| Lifecycle | Runs when a user opens a MyGeotab page; no UI; no teardown documented | Poll loop with cleanup | Offline/logged-out delivery: **not claimed, not proven** |
| Limits | 2 notifications visible, 6 `show` calls per minute per add-in | `NotificationRateLimiter` | Consistent |

## Decisions
1. Service Add-In stays disabled and isolated: registration is a no-op unless four local flags are true and the tenant is approved (all false/empty). No API call and no timer start otherwise (Phase B, tested).
2. The Notification Center over persisted AddInData notifications is the supported baseline.
3. Open findings carried forward: F-07 (delivery loop reads pending notifications of all recipients through one session — must be scoped to the session user before any enablement), F-09 (delivery status is only meaningful with confirmed delivery), F-08 (loading format/name).
4. Not changed this phase: `serviceAddin.ts` delivery logic and the ESM build output, to avoid claiming a fix that cannot be verified without a tenant.
