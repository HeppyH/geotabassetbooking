# Known Limitations
- Not proven: double-booking prevention. Detection only.
- UI (`App.tsx`) still uses its own handlers and the legacy provider's create/validate logic; it is not yet driven by `booking/*`. Create/Edit/Submit/Complete flows are implemented as domain functions and enforced only for status changes in the native provider.
- Legacy provider booking records use the old shape (`deviceId`, `startAt`...), not the Phase C envelope/E.1 model; migration is not done.
- No "edit booking" persistence path through the store yet; no stored time-zone/UTC fields in the legacy shape.
- Admin-configured limits (duration, advance window, timezone, destination rule) have no UI/config source until Phase G.
- Booking history relies on audit records (Phase F).
