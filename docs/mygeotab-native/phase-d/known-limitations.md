# Known Limitations
- Not server-enforced; role mapping tamperable by anyone with write clearance.
- No admin UI to edit the mapping yet (Phase G); no bootstrap administrator defined.
- Legacy `AddInDataBookingDataProvider` still builds the approver list from undocumented `User.role === "APPROVER"` and fabricates asset fields (`make_model`, `asset_class`, `status`) from undocumented Device properties; display-only, to be replaced by role-mapping approvers and `masterdata/vehicles` during the Phase E provider migration.
- Default driver from assignment not available (source unverified).
- `userRole`, `securityGroups` deliberately unused.
