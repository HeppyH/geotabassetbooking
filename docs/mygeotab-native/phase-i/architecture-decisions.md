# Architecture Decisions (summary of Phases B–I)
1. Fail-closed, centralized capability gates; frozen constants; tenant allowlist empty.
2. Two denial layers (provider + gated api); raw api never exposed when denied.
3. Native runtime and offline simulation have separate entry points and module graphs.
4. One AddInData store with a versioned envelope and type-prefixed ids; bounded reads; no invented pagination.
5. OPEX roles from an administrator-controlled mapping, never from `User.role`; roles never exceed gates; self-approval banned.
6. State machine and recipient scoping enforced in the native provider path.
7. Advisory availability with deterministic reconciliation; no atomicity claims.
8. Legacy backend isolated, not deleted.
9. Pure domain modules, tested independently of the UI; UI integration deferred (largest remaining work item).
