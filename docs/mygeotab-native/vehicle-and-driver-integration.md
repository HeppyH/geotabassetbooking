# Vehicle and Driver Integration — Gaps

Evidence labels: [DOC] [CODE] [TEST] [ASSUMPTION] [TENANT]. No tenant data was accessed.

## 1. Vehicle / asset (MyGeotab `Device`)

### Current behaviour [CODE]
- `Get` with `typeName: "Device"`, `resultsLimit: 1000`; mapped by `mapLiveAsset`.
- Fields read: `id, name, serialNumber, licensePlate, make, model, vehicleClass, groupIds, status`.
- Synthetic values: `asset_code = "VEH-" + last 3 chars of id (upper)`, `asset_class` default `OPERATIONAL_4X4`, `status` default `AVAILABLE`, `make_model` = `"<make|Unknown> <model|Asset>"`.
- `parseVehicleName` assumes device names follow `"<plate>_<make model>[_<variant>]"`, discards the first segment, and renders the rest.

### What the docs confirm [DOC]
| Needed field | Documented? | Where |
|---|---|---|
| Device id | Yes | Device |
| Name (≤ 50 chars) | Yes | Device |
| Description / comment | `comment` free text | Device |
| License plate | Yes, `licensePlate` (≤ 50) | GoDevice (base for GO products) |
| VIN | Yes, `vehicleIdentificationNumber` (≤ 50) | GoDevice |
| Group association | Yes, `groups` | Device |
| Active/inactive | `activeFrom` / `activeTo` dates (no status enum) | Device |
| Time zone | `timeZoneId` (IANA) | Device |
| make, model, vehicleClass, status | **No** | not on Device page |

### Gaps
| Gap | Ref | Required |
|---|---|---|
| Undocumented fields (`make`, `model`, `vehicleClass`, `status`) | F-11 | Remove or source from a documented place (e.g., OPEX config record mapping deviceId → class/category) |
| Invented defaults (class, status) | F-11 | No silent defaults; unknown class = "Unclassified"; availability derived from `activeFrom/activeTo` and bookings only |
| Synthetic `asset_code` | F-11 | Display name from `name`/plate; do not fabricate codes |
| Name-parsing convention | F-11 | Organization-specific, undocumented; if retained, make it an explicit, tested, optional display rule and never an identity source |
| 1,000-item cap with silent truncation | F-05 | Detect full page and surface a warning; verify `Get` limits [TENANT] |
| Inactive devices | — | Filter by `activeFrom/activeTo` relative to booking window |
| Subtype fields | — | Whether `licensePlate`/VIN are returned for non-GO/custom devices is **Unverified** [TENANT] |
| Access | — | Use only what `Get Device` returns for the signed-in user; do not cache across users |
| Hard-coded class | F-11 | UI creates every booking as `PASSENGER`; class must come from the vehicle/config or be removed |
| Hard-coded vehicle lists | — | None found in live path (mock fixtures only in DEMO) [CODE] |

## 2. Driver

### Master-prompt requirements
Default to the vehicle's assigned driver; allow another driver where business rules permit; leave empty if none; driver optional; never infer from vehicle name; validate against MyGeotab; decide whether to store id, name snapshot, or both.

### Current behaviour [CODE]
- Drivers = users whose app `roles` include EMPLOYEE/GA/MANAGEMENT. Live, every user is `EMPLOYEE` → every user is "eligible" (including non-drivers).
- Stored: `assignedDriverUserId` only. Display name resolved at read time from the current user list; the `driverName` argument is accepted but not persisted by the AddInData provider.
- No default from MyGeotab; no validation against the entity at write time.

### What the docs confirm [DOC]
- `User.isDriver` (boolean) exists; users also carry `employeeNo`, `activeFrom/activeTo`.
- `DriverChange` records a device↔driver change at a point in time (Get 1,000/min; results capped at 50,000). The page does **not** describe it as the method for determining a device's current/assigned driver, and does not explain driver identification/keys. So **"assigned driver" retrieval is unverified**.

### Options for default-driver (decision + tenant proof required)
| Option | Description | Risk |
|---|---|---|
| 1 | Most recent `DriverChange` for the device before booking start | Reflects who last logged in, not a standing assignment [ASSUMPTION]; may be empty for non-driver-ID setups |
| 2 | OPEX config record `deviceId → defaultDriverUserId` maintained by administrators | Fully controlled, native; manual upkeep |
| 3 | No default; requester chooses or leaves empty | Simplest; loses requirement |
| ✖ | Parse a person name from `Device.name` | **Prohibited by master prompt**. Note: the code comment's example (`"AD 1283 VO_Honda Brio_Andri"`) suggests the third segment may be a person's name in this fleet's naming; it must not be used as a driver source [ASSUMPTION] |

### Gaps and required changes
| Gap | Required |
|---|---|
| Driver eligibility | Filter by `isDriver === true` (and active dates), not app roles |
| Validation at creation | Re-check driver exists and is active when persisting; reject otherwise |
| Evaluation time | Resolve default at booking creation time, record source of default |
| Storage | Store `driverId` plus `driverNameSnapshot` (privacy-minimal) and a flag whether it was defaulted; document in schema |
| Optional | Absent driver stays `null`; UI shows "No driver" |
| Privacy | Do not store more personal data than id + display name |

## 3. Data-minimization note
Requester and driver display-name snapshots protect history when users are renamed or deactivated, but are personal data; retention rules belong in `security-and-privacy.md` (Phase I).
