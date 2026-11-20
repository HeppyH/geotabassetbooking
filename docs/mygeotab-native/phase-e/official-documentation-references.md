# Official Documentation References
- AddInData and add-in storage: see Phase C (no documented transaction or compare-and-set).
- Device/User/DriverChange: see Phase D.
- Time zones: `Intl.DateTimeFormat` / IANA tz database (platform standard, not MyGeotab).
**UNVERIFIED:** MyGeotab server-side behaviour of concurrent AddInData writes; ordering of `Get` results; whether `createdAt` ordering is reliable across clients (client clocks are untrusted — the tie-break uses client-supplied timestamps).
