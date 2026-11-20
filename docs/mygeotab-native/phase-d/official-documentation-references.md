# Official Documentation References
- Device: https://developers.geotab.com/myGeotab/apiReference/objects/Device
- User: https://developers.geotab.com/myGeotab/apiReference/objects/User
- DriverChange: https://developers.geotab.com/myGeotab/apiReference/objects/DriverChange
- Add-In storage / AddInData: see Phase C.

Documented and relied on: Device and User properties listed in the summary; DriverChange properties and rate limits (Get 1000/min, results limit 50000, per the page).
Findings come from reading the official pages through a summarizing fetch tool; re-check wording against the live pages during sandbox validation.
**UNVERIFIED (tenant needed):** whether `licensePlate`/VIN are available through other objects or fields on a given tenant; `DriverChange` search parameters and current-driver logic; meaning/clearance effects of `securityGroups`; `Get User` search by `name` behaviour on the tenant; what security clearance a requester/approver user actually has for AddInData methods.
