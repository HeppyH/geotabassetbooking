# Known Limitations (final)
- UI integration outstanding: new modules are tested but `App.tsx` is not driven by them; no Notification Center, admin, report or audit-history screens; no manual or visual UI QA performed in this run.
- No tenant validation; many contract details UNVERIFIED (see matrix and sandbox plan).
- Client-side authorization only; double-booking protection unproven; audit not tamper-proof.
- Legacy provider debt (unbounded Gets, undocumented fields, legacy record shape, dead file).
- Service Add-In disabled and unverified.
- Workflows and Add-In registration JSON unverified; source maps published.
- Git state unverifiable; no commit/push.
