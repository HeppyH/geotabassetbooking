# Identity and Authorization — Gaps and Design Options

Evidence labels: [DOC] [CODE] [TEST] [ASSUMPTION] [TENANT]. Nothing was validated in a tenant.

## 1. Current state

| Capability | Implementation | Assessment |
|---|---|---|
| Session context | `api.getSession(cb)` → `userName`, `database`, `server` | Implemented; `getSession` on a custom-page `api` is **unverified** in the docs retrieved (documented for the Service Add-In `service.api`) [DOC][TENANT] |
| Principal lookup | `Get User` with `search: { name: userName }`, `resultsLimit: 10`; requires exactly one match; non-empty `id` | Good fail-closed shape [CODE][TEST]; name-search semantics (exactness/case) **Unverified** |
| Never trust display name | Principal keyed on MyGeotab `id`; no email/display fallback | Good [CODE][TEST] |
| Roles | `role` property of the User record, default `EMPLOYEE` | **Wrong source**: no `role` property is documented; `userRole`/`customUserRole` exist and `securityGroups` define access [DOC D5] (F-02) |
| Approver discovery | Users with `role === "APPROVER"` | Always empty live (F-02) |
| Write gate | `canPerformLiveWrite` = identity authenticated | No role, ownership, capability or gate check (F-01/F-02) |
| Self-approval | Not enforced in web | Enforced only in legacy API `canApprove` (F-03) |
| Admin access | No admin features in the web app | Nothing to protect yet; Phase G must add with fail-closed default |

## 2. Fundamental limit of a 100% native design

AddInData authorization is **by method and clearance**, not by record, owner or OPEX role (Administrator/Supervisor/Default User/Drive App User may Add/Set/Get/Remove; ViewOnly may Get) [DOC D1]. The page `api` runs as the signed-in user [DOC D4, D10]. Consequences:

1. Role checks inside the browser app are **advisory**. A user with Set clearance can call the API directly and set a booking to APPROVED or delete audit records.
2. OPEX "Approver" or "Administrator" cannot be enforced server-side without an external backend, which is prohibited.
3. Mitigations are **detective and procedural**: append-only audit conventions, reconciliation that flags records whose last writer lacked the role, restricting which MyGeotab users have Add/Set/Remove clearance on the Add-In's data, group scoping, and administrator review.

This residual risk is a business-acceptance item (`remaining-blockers.md`, decision D-3). It must be documented in `security-and-privacy.md` and must not be described as "secure authorization".

## 3. Role-mapping options (decision required in Phase D)

| Option | Mechanism | Pros | Cons / unknowns |
|---|---|---|---|
| A. Custom Add-In clearances | `enableViewSecurityId` + `securityIds` in the Add-In config create clearance entries in the clearance editor (MyGeotab 9.0+) [DOC D4] | Native, administered in MyGeotab, auditable by MyGeotab admins | How an Add-In reads the current user's clearances is **not retrieved**; may only gate visibility of the page; per-role entries need tenant proof [TENANT] |
| B. MyGeotab security groups | Map `User.securityGroups` (documented) to Requester/Approver/Administrator | Documented property; native | Security groups in MyGeotab are broader than OPEX roles; naming convention would be a policy decision; group ids vs names [TENANT] |
| C. Config record in AddInData | Admin-maintained mapping userId → role stored as `config` records | Flexible, no MyGeotab config changes | Bootstrapping admin; editable by anyone with Set; advisory only |
| D. `userRole` / `customUserRole` | Use documented User fields | Simple | Semantics are HR-style functional roles, not authorization; not recommended as sole source |

**Recommendation (for approval, not implemented):** combine A (page visibility and administrator gate) with B or C (role assignment), always **fail closed** when mapping is missing, and never grant administrator by default. Choice depends on tenant validation of A.

## 4. Gaps to close (Phase D)

| Gap | Required |
|---|---|
| Role source | Replace `User.role` with the chosen documented mechanism; migrate `roles` type to application roles (Requester, Approver, Administrator) |
| Authorization policy | Pure functions `canCreate`, `canEdit`, `canCancel`, `canApprove`, `canReject`, `canViewAll`, `canAdminister` with unit tests; enforce **before persistence** in the application layer, not only by hiding buttons |
| Self-approval | Explicit business rule; default deny (master prompt §9) |
| Approver determination | Defined source (role mapping, optional per-group/site approvers); missing approver → block submit with clear error |
| Vehicle access | Only devices from `Get Device` under the user's own session; do not widen via cached lists |
| Driver access | Validate selected driver via `Get User` (`isDriver`) |
| Record ownership | Check `createdBy`/`requesterId` against principal in app policy; flag mismatches during reconciliation |
| Missing mapping | Fail closed with a reason shown to the user; no default `EMPLOYEE` elevation of capabilities |
| Capability gates | Identity, storage, read, write, approval, admin gates default `false` with explicit tenant allowlist (Phase B) |
| Logging | Never log session ids, tokens or personal data (existing `diagLog` already avoids this; keep and test) |

## 5. Draft security matrix (to be finalized and tested in Phase D/I)

Legend: ✔ allowed (policy), ✖ denied, ◐ conditional. All rows are **client-side policy**; AddInData does not enforce them.

| Action | Requester | Approver | Administrator | Unmapped user |
|---|---|---|---|---|
| View own bookings | ✔ | ✔ | ✔ | ✖ |
| View all bookings | ✖ | ✔ | ✔ | ✖ |
| Create booking | ✔ | ✔ | ✔ | ✖ |
| Edit own booking (Draft/Rejected only) | ✔ | ◐ | ✔ | ✖ |
| Submit | ✔ (own) | ✔ (own) | ✔ | ✖ |
| Approve / Reject | ✖ | ✔ (not own, unless business rule) | ◐ (not own, unless rule) | ✖ |
| Cancel | ✔ (own, allowed states) | ◐ | ✔ | ✖ |
| View audit for booking | ◐ own | ✔ | ✔ | ✖ |
| Read notifications | own only | own only | own only | ✖ |
| Edit configuration | ✖ | ✖ | ✔ (gate `ADMIN_CONFIGURATION_ENABLED`) | ✖ |
| Delete records | ✖ | ✖ | ✖ by default | ✖ |

Underlying enforcement: MyGeotab clearance for Add/Set/Get/Remove [DOC]; everything else is application policy + audit + reconciliation.

## 6. Preserve / modify / replace

| Item | Disposition |
|---|---|
| `identityResolver.ts` session + single-match `User` lookup | **Preserve**; after docs/tenant verification of `getSession` and search semantics |
| `normalizePrincipal` role defaulting | **Replace** (roles from documented source) |
| `modeGuards.ts` demo guards | **Preserve**, extend with capability gates |
| `canPerformLiveWrite` | **Modify** (identity AND capability AND policy) |
| Legacy `canApprove`/role lists in `apps/api` | **Reference only**; port logic, not code dependency |
