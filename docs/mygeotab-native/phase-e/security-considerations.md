# Security Considerations
- All workflow rules are client-side policy; a user with AddInData Set clearance can write any status directly (e.g. approve own booking). This is NOT prevented by this code and is why approval and write capabilities remain off.
- Reconciliation order uses client-supplied `createdAt`, which a malicious client can forge to win a conflict.
- The native provider rejects a caller-supplied approver id that is not the authenticated user.
- No logging of booking content; no external calls.
