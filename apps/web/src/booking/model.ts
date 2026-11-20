/*───────────────────── Booking record model (Phase E) ─────────────────────
 * Booking payload stored inside a Phase C envelope (recordType "booking"). Validated on write
 * and on read; stores stable ids plus display-name SNAPSHOTS (names are never used as references).
 * Pure; no storage access.
 */
import { BOOKING_STATUSES, isBookingStatus } from "./stateMachine.ts";
import type { BookingStatus } from "./stateMachine.ts";
import { isValidTimeZone, DEFAULT_TIME_ZONE } from "./schedule.ts";

export interface BookingRecord {
  vehicleId: string;
  vehicleNameSnapshot: string;
  requesterUserId: string;
  requesterNameSnapshot: string;
  driverUserId: string | null;
  driverNameSnapshot: string | null;
  startDate: string; startTime: string; endDate: string; endTime: string;
  startUtc: string; endUtc: string;
  timeZone: string;
  purpose: string;
  destination: string | null;
  status: BookingStatus;
  approverId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingRules { destinationRequired?: boolean }
export type BookingParse = { ok: true; booking: BookingRecord } | { ok: false; field: string; reason: string };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isoOk = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v));
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v.trim() : null);
const optText = (v: unknown, max: number): string | null | undefined => (v === undefined || v === null || v === "" ? null : text(v, max) ?? undefined);

export function parseBookingRecord(raw: unknown, rules: BookingRules = {}): BookingParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "payload", reason: "Booking is not an object." };
  const r = raw as Record<string, unknown>;
  const bad = (field: string, reason: string): BookingParse => ({ ok: false, field, reason });

  const vehicleId = text(r.vehicleId, 100); if (!vehicleId) return bad("vehicleId", "Vehicle is required.");
  const vehicleName = text(r.vehicleNameSnapshot, 100); if (!vehicleName) return bad("vehicleNameSnapshot", "Vehicle name snapshot is required.");
  const requester = text(r.requesterUserId, 100); if (!requester) return bad("requesterUserId", "Requester is required.");
  const requesterName = text(r.requesterNameSnapshot, 100); if (!requesterName) return bad("requesterNameSnapshot", "Requester name snapshot is required.");
  const driverId = optText(r.driverUserId, 100); if (driverId === undefined) return bad("driverUserId", "Driver id is invalid.");
  const driverName = optText(r.driverNameSnapshot, 100); if (driverName === undefined) return bad("driverNameSnapshot", "Driver name is invalid.");
  if ((driverId === null) !== (driverName === null)) return bad("driverUserId", "Driver id and name snapshot must be set together.");

  for (const f of ["startUtc", "endUtc", "createdAt", "updatedAt"] as const) if (!isoOk(r[f])) return bad(f, "Must be an ISO-8601 UTC timestamp.");
  if (Date.parse(r.endUtc as string) <= Date.parse(r.startUtc as string)) return bad("endUtc", "End must be after start.");
  for (const f of ["startDate", "endDate"] as const) if (typeof r[f] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r[f] as string)) return bad(f, "Must be YYYY-MM-DD.");
  for (const f of ["startTime", "endTime"] as const) if (typeof r[f] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r[f] as string)) return bad(f, "Must be HH:mm.");
  const tz = r.timeZone === undefined ? DEFAULT_TIME_ZONE : r.timeZone;
  if (!isValidTimeZone(tz)) return bad("timeZone", "Unknown time zone.");

  const purpose = text(r.purpose, 500); if (!purpose) return bad("purpose", "Purpose is required.");
  const destination = optText(r.destination, 200); if (destination === undefined) return bad("destination", "Destination is invalid.");
  if (rules.destinationRequired && destination === null) return bad("destination", "Destination is required.");

  if (!isBookingStatus(r.status)) return bad("status", `Status must be one of ${BOOKING_STATUSES.join(", ")}.`);
  const status = r.status;
  const approverId = optText(r.approverId, 100); if (approverId === undefined) return bad("approverId", "Approver id is invalid.");
  const rejection = optText(r.rejectionReason, 500); if (rejection === undefined) return bad("rejectionReason", "Rejection reason is invalid.");
  const approvedAt = r.approvedAt === undefined || r.approvedAt === null ? null : isoOk(r.approvedAt) ? r.approvedAt : undefined;
  if (approvedAt === undefined) return bad("approvedAt", "Must be an ISO-8601 UTC timestamp.");
  if (status === "REJECTED" && !rejection) return bad("rejectionReason", "Rejected bookings need a reason.");
  if (["APPROVED", "ASSIGNED"].includes(status) && (!approverId || !approvedAt)) return bad("approverId", "Approved bookings need approver and approval time.");
  if (approverId && approverId === requester) return bad("approverId", "Requester cannot approve their own booking.");

  return { ok: true, booking: {
    vehicleId, vehicleNameSnapshot: vehicleName, requesterUserId: requester, requesterNameSnapshot: requesterName,
    driverUserId: driverId, driverNameSnapshot: driverName,
    startDate: r.startDate as string, startTime: r.startTime as string, endDate: r.endDate as string, endTime: r.endTime as string,
    startUtc: r.startUtc as string, endUtc: r.endUtc as string, timeZone: tz as string,
    purpose, destination, status, approverId, approvedAt, rejectionReason: rejection,
    createdAt: r.createdAt as string, updatedAt: r.updatedAt as string,
  } };
}
