/*───────────────────── Reporting (Phase G) ─────────────────────
 * Reports are computed ONLY from validated booking records (parseBookingRecord). Notification,
 * audit and config records can never be counted as bookings: `bookingsFromRecords` keeps only
 * recordType "booking" payloads that pass validation and reports the rest as skipped.
 * Pure; no storage access. Scope: bounded data set from the Phase C store (<=1000 records).
 */
import type { StoredRecord } from "../storage/addinDataStore.ts";
import { parseBookingRecord } from "../booking/model.ts";
import type { BookingRecord } from "../booking/model.ts";
import { BOOKING_STATUSES } from "../booking/stateMachine.ts";

export interface BookingWithId extends BookingRecord { id: string }

export function bookingsFromRecords(records: readonly StoredRecord[]): { bookings: BookingWithId[]; skipped: number } {
  const bookings: BookingWithId[] = [];
  let skipped = 0;
  for (const r of records) {
    if (r.envelope.recordType !== "booking") { skipped++; continue; }
    const p = parseBookingRecord(r.envelope.payload);
    if (!p.ok) { skipped++; continue; }
    bookings.push({ ...p.booking, id: r.envelope.recordId });
  }
  return { bookings, skipped };
}

export interface Period { fromUtc: string; toUtc: string }
const inPeriod = (b: BookingRecord, p?: Period) => !p || (Date.parse(b.endUtc) > Date.parse(p.fromUtc) && Date.parse(b.startUtc) < Date.parse(p.toUtc));

export function bookingSummary(bookings: readonly BookingRecord[], period?: Period) {
  const byStatus: Record<string, number> = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const b of bookings) if (inPeriod(b, period)) { byStatus[b.status]++; total++; }
  return { total, byStatus };
}

export function approvalSummary(bookings: readonly BookingRecord[], period?: Period) {
  let pending = 0, approved = 0, rejected = 0, decided = 0, decisionMs = 0;
  for (const b of bookings) {
    if (!inPeriod(b, period)) continue;
    if (b.status === "PENDING_APPROVAL") pending++;
    if (b.status === "REJECTED") rejected++;
    if (["APPROVED", "ASSIGNED", "COMPLETED", "CHECKED_OUT", "RETURNED", "CLOSED"].includes(b.status)) approved++;
    if (b.approvedAt) { decided++; decisionMs += Math.max(0, Date.parse(b.approvedAt) - Date.parse(b.createdAt)); }
  }
  return { pending, approved, rejected, averageDecisionMinutes: decided ? Math.round(decisionMs / decided / 60000) : null };
}

const USED = ["APPROVED", "ASSIGNED", "CHECKED_OUT", "OVERDUE", "RETURNED", "COMPLETED", "CLOSED"];

/** Booked hours per vehicle, clipped to the period, merged so overlapping bookings are not double counted. */
export function vehicleUtilization(bookings: readonly BookingRecord[], period: Period) {
  const from = Date.parse(period.fromUtc); const to = Date.parse(period.toUtc);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new Error("INVALID_PERIOD");
  const byVehicle = new Map<string, { name: string; spans: Array<[number, number]> }>();
  for (const b of bookings) {
    if (!USED.includes(b.status)) continue;
    const s = Math.max(from, Date.parse(b.startUtc)); const e = Math.min(to, Date.parse(b.endUtc));
    if (e <= s) continue;
    const v = byVehicle.get(b.vehicleId) ?? { name: b.vehicleNameSnapshot, spans: [] };
    v.spans.push([s, e]); byVehicle.set(b.vehicleId, v);
  }
  return [...byVehicle.entries()].map(([vehicleId, v]) => {
    v.spans.sort((a, b) => a[0] - b[0]);
    let ms = 0; let [cs, ce] = v.spans[0];
    for (const [s, e] of v.spans.slice(1)) { if (s <= ce) ce = Math.max(ce, e); else { ms += ce - cs; cs = s; ce = e; } }
    ms += ce - cs;
    return { vehicleId, vehicleName: v.name, bookedHours: Math.round((ms / 3600000) * 100) / 100, utilizationPercent: Math.round((ms / (to - from)) * 1000) / 10 };
  }).sort((a, b) => b.bookedHours - a.bookedHours || (a.vehicleId < b.vehicleId ? -1 : 1));
}

/** Booking history list newest first (read-only view model). */
export function bookingHistory<T extends BookingRecord>(bookings: readonly T[], period?: Period): T[] {
  return bookings.filter((b) => inPeriod(b, period)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
