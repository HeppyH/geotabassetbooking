/*───────────────────── Driver master data (Phase D) ─────────────────────
 * A MyGeotab `User` is a valid driver only when `isDriver === true` (documented, default false)
 * and the user is within activeFrom/activeTo (documented). Not every User is a driver.
 * Driver is OPTIONAL on a booking. Stored references are stable user ids, never names.
 *
 * Default driver from a vehicle's assigned driver: NOT enabled. The documented DriverChange
 * object (device, driver, dateTime, type) could provide it, but its Get search parameters and
 * the "current driver" derivation are not documented (UNVERIFIED), and DriverChange is not on
 * the gated API allowlist. `deriveAssignedDriver` below is a pure, tested helper only; the
 * default stays EMPTY until a tenant validates the source.
 */
import { isWithinActiveWindow } from "./vehicles.ts";

export interface Driver { userId: string; name: string }
export type DriverParse = { ok: true; driver: Driver } | { ok: false; reason: string };

export function mapDriver(raw: unknown, at: number): DriverParse {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "User is not an object." };
  const u = raw as Record<string, unknown>;
  if (typeof u.id !== "string" || !u.id.trim()) return { ok: false, reason: "User has no id." };
  if (u.isDriver !== true) return { ok: false, reason: "User is not a driver." };
  if (!isWithinActiveWindow(u.activeFrom, u.activeTo, at)) return { ok: false, reason: "User is not active." };
  const name = [u.firstName, u.lastName].filter((x) => typeof x === "string" && x.trim()).join(" ") || (typeof u.name === "string" ? u.name : "");
  if (!name.trim()) return { ok: false, reason: "User has no display name." };
  return { ok: true, driver: { userId: u.id.trim(), name: name.trim() } };
}

export function mapDrivers(raw: unknown, at: number): Driver[] {
  const out: Driver[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = mapDriver(item, at);
    if (r.ok && !ids.has(r.driver.userId)) { ids.add(r.driver.userId); out.push(r.driver); }
  }
  return out;
}

/** Validate a driver reference chosen on a booking. Empty/absent is valid (optional). */
export function validateDriverReference(driverId: unknown, drivers: readonly Driver[]): { ok: true; driver: Driver | null } | { ok: false; reason: string } {
  if (driverId === undefined || driverId === null || driverId === "") return { ok: true, driver: null };
  if (typeof driverId !== "string") return { ok: false, reason: "Driver reference is invalid." };
  const hit = drivers.find((d) => d.userId === driverId);
  return hit ? { ok: true, driver: hit } : { ok: false, reason: "Driver is not a valid active driver." };
}

export interface DriverChangeLike { device?: { id?: unknown } | null; driver?: { id?: unknown } | null; dateTime?: unknown }

/** Pure helper, UNVERIFIED source: latest change for the device at or before `at`. */
export function deriveAssignedDriver(changes: readonly DriverChangeLike[], deviceId: string, at: number, drivers: readonly Driver[]): Driver | null {
  let best: { t: number; id: string } | null = null;
  for (const c of changes) {
    if (c?.device?.id !== deviceId || typeof c.driver?.id !== "string" || typeof c.dateTime !== "string") continue;
    const t = Date.parse(c.dateTime);
    if (Number.isNaN(t) || t > at) continue;
    if (!best || t > best.t) best = { t, id: c.driver.id };
  }
  if (!best) return null;
  return drivers.find((d) => d.userId === best!.id) ?? null;
}
