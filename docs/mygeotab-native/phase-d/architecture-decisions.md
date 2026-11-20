# Architecture Decisions
1. No role from `User.role`, `userRole` or security groups; administrator-controlled mapping only (not documented as a MyGeotab feature; a design choice).
2. Fail closed on missing mapping, unmapped user, duplicate or malformed mapping.
3. Empty bootstrap list: who the first administrator is remains an owner decision (blocker).
4. Self-approval banned for all roles.
5. Role AND gate: roles never widen what the capability gates allow.
6. Unverified DriverChange-based default driver stays off; driver empty by default.
7. Legacy `roles` retained for compatibility but isolated from authorization.
