/*───────────────────── Vehicle master data (Phase D) ─────────────────────
 * Maps MyGeotab `Device` records using ONLY properties documented on the official Device page
 * (https://developers.geotab.com/myGeotab/apiReference/objects/Device): id, name (max 50),
 * comment, serialNumber, groups, activeFrom, activeTo, timeZoneId, deviceType.
 *
 * NOT documented on that page (so NOT used and never invented): licensePlate,
 * vehicleIdentificationNumber, make, model, vehicleClass, status. If a tenant returns them they
 * are ignored here; any use must wait for tenant validation (UNVERIFIED).
 * No hardcoded vehicle lists.
 */
export interface Vehicle {
  deviceId: string;
  name: string;
  comment: string | null;
  serialNumber: string | null;
  groupIds: string[];
  timeZoneId: string | null;
  active: boolean;
}

export type VehicleParse = { ok: true; vehicle: Vehicle } | { ok: false; reason: string };

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : null;
}

function validDate(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function isWithinActiveWindow(activeFrom: unknown, activeTo: unknown, at: number): boolean {
  const from = activeFrom === undefined || activeFrom === null ? null : validDate(activeFrom);
  const to = activeTo === undefined || activeTo === null ? null : validDate(activeTo);
  if (activeFrom != null && from === null) return false;
  if (activeTo != null && to === null) return false;
  if (from !== null && at < from) return false;
  if (to !== null && at >= to) return false;
  return true;
}

export function mapDevice(raw: unknown, at: number): VehicleParse {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "Device is not an object." };
  const d = raw as Record<string, unknown>;
  const deviceId = str(d.id, 100);
  if (!deviceId) return { ok: false, reason: "Device has no id." };
  const name = str(d.name, 50);
  if (!name) return { ok: false, reason: "Device has no valid name." };
  const groupIds = Array.isArray(d.groups)
    ? d.groups.map((g) => (g && typeof g === "object" ? str((g as Record<string, unknown>).id, 100) : null)).filter((x): x is string => x !== null)
    : [];
  return {
    ok: true,
    vehicle: {
      deviceId,
      name,
      comment: str(d.comment, 1000),
      serialNumber: str(d.serialNumber, 12),
      groupIds,
      timeZoneId: str(d.timeZoneId, 100),
      active: isWithinActiveWindow(d.activeFrom, d.activeTo, at),
    },
  };
}

/** Map a Device list; invalid devices are reported, duplicates by id are rejected. */
export function mapDevices(raw: unknown, at: number): { vehicles: Vehicle[]; rejected: number } {
  const vehicles: Vehicle[] = [];
  const ids = new Set<string>();
  let rejected = 0;
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = mapDevice(item, at);
    if (!r.ok || ids.has(r.vehicle.deviceId)) { rejected++; continue; }
    ids.add(r.vehicle.deviceId);
    vehicles.push(r.vehicle);
  }
  return { vehicles, rejected };
}

/** A vehicle can be booked only while active. */
export function isBookable(vehicle: Vehicle | null | undefined): boolean {
  return !!vehicle && vehicle.active;
}
