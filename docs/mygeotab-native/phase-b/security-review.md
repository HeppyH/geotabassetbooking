# Security Review (Phase B)

Scope: code review plus mocked tests. **No tenant was contacted; real MyGeotab permission behaviour is unverified.**

| Area | Finding / outcome |
|------|-------------------|
| Auto-LIVE (F-01) | Removed. No code path switches mode. |
| Dev controls (F-10) | Mode select and AddInId editor removed from UI. |
| Bundle composition (F-17) | Simulation excluded from default build. |
| Hidden overrides | No env/URL/localStorage/UI path can enable a capability or change the AddInId. |
| Raw API exposure | Providers receive a gated api; unknown calls denied. |
| Fallbacks | Native failures reject; no localStorage, mock or backend fallback. |
| Diagnostics (new finding) | `lifecycleDiagnostics.ts` made ungated `Device`/`AddInData` reads and read the AddInId from localStorage. Now gated (denied: no approved tenant) and uses the fixed AddInId. It is still disabled by `__DIAGNOSTICS_ENABLED__ = false`. |
| Service Add-In (F-07/08/09) | Registration is a no-op unless four local flags are true and the tenant is approved; flags are all false and a drift test ties them to the central config. Notification/ownership issues (F-07/F-08/F-09) remain for Phase F. |
| Page-side notifications | `showNativeNotification` is inert; behaviour unchanged in practice. |
| Authorization | Gates are client-side. They protect against mistakes, not a malicious user of the same browser. Real authorization depends on MyGeotab per-method permissions (documented) and is unverified. |
| Known leftovers | `User.role` use (F-02), `getAddInId` reading service storage, dead `mygeotabProvider.ts`, `data/types.ts` type import from `apps/api` (F-18). |
