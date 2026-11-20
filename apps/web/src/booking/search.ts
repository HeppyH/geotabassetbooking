/*───────────────────── Booking filter / search (Phase E) ─────────────────────
 * Pure client-side filtering over already-validated bookings (bounded retrieval happens in the
 * storage layer). Notifications/audit records are never bookings: callers pass booking records only.
 */
export interface SearchableBooking {
  id: string; status: string; vehicleId: string; vehicleNameSnapshot: string; requesterUserId: string;
  requesterNameSnapshot: string; purpose: string; destination: string | null; startUtc: string; endUtc: string;
  driverNameSnapshot?: string | null;
}

export interface BookingFilter {
  statuses?: readonly string[];
  vehicleId?: string;
  requesterUserId?: string;
  /** Inclusive range over overlap with [fromUtc, toUtc). */
  fromUtc?: string; toUtc?: string;
  text?: string;
}

export function filterBookings<T extends SearchableBooking>(items: readonly T[], f: BookingFilter): T[] {
  const q = f.text?.trim().toLowerCase();
  const from = f.fromUtc ? Date.parse(f.fromUtc) : null;
  const to = f.toUtc ? Date.parse(f.toUtc) : null;
  return items.filter((b) => {
    if (f.statuses && f.statuses.length && !f.statuses.includes(b.status)) return false;
    if (f.vehicleId && b.vehicleId !== f.vehicleId) return false;
    if (f.requesterUserId && b.requesterUserId !== f.requesterUserId) return false;
    if (from !== null && Date.parse(b.endUtc) <= from) return false;
    if (to !== null && Date.parse(b.startUtc) >= to) return false;
    if (q) {
      const hay = [b.id, b.vehicleNameSnapshot, b.requesterNameSnapshot, b.purpose, b.destination ?? "", b.driverNameSnapshot ?? ""].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Visibility: requesters see only their own bookings; approvers and administrators see all. */
export function visibleBookings<T extends SearchableBooking>(items: readonly T[], actorId: string | null | undefined, canViewAll: boolean): T[] {
  if (!actorId) return [];
  return canViewAll ? [...items] : items.filter((b) => b.requesterUserId === actorId);
}
