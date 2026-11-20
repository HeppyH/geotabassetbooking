/*───────────────────── Availability, duplicates, reconciliation (Phase E) ─────────────────────
 * ADVISORY ONLY. AddInData has no documented atomic reservation or transaction, so
 * Get → check → Add does NOT prevent double booking: two clients can both pass the check.
 * This module detects conflicts before writing, and — after writing — re-reads and decides a
 * deterministic "winner" so a double booking is surfaced and can be reconciled by a person.
 * It does not and cannot prove that double booking is impossible.
 */
import { isBlockingStatus } from "./stateMachine.ts";

export interface IntervalBooking {
  id: string;
  vehicleId: string | null | undefined;
  startUtc: string;
  endUtc: string;
  status: string;
  requesterId?: string | null;
  createdAt?: string | null;
  purpose?: string | null;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
}

export const ADVISORY_NOTE =
  "Availability checks are advisory: MyGeotab AddInData provides no atomic reservation, so two users can still create overlapping bookings. Conflicts are detected after the fact and must be reconciled.";

function t(v: string): number { return Date.parse(v); }

/** existing.start < requested.end AND existing.end > requested.start (half-open intervals). */
export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const [as, ae, bs, be] = [t(aStart), t(aEnd), t(bStart), t(bEnd)];
  if ([as, ae, bs, be].some(Number.isNaN)) return false;
  return as < be && ae > bs;
}

function effective(b: IntervalBooking, useBuffers: boolean): [string, string] {
  if (!useBuffers) return [b.startUtc, b.endUtc];
  const before = Math.max(0, b.bufferBeforeMinutes ?? 0) * 60000;
  const after = Math.max(0, b.bufferAfterMinutes ?? 0) * 60000;
  return [new Date(t(b.startUtc) - before).toISOString(), new Date(t(b.endUtc) + after).toISOString()];
}

export interface ConflictOptions { excludeId?: string; useBuffers?: boolean }

/** Blocking bookings on the same vehicle that overlap the candidate. */
export function findConflicts(candidate: Pick<IntervalBooking, "vehicleId" | "startUtc" | "endUtc"> & { bufferBeforeMinutes?: number; bufferAfterMinutes?: number }, existing: readonly IntervalBooking[], opts: ConflictOptions = {}): IntervalBooking[] {
  if (!candidate.vehicleId) return [];
  const [cs, ce] = effective(candidate as IntervalBooking, !!opts.useBuffers);
  return existing.filter((b) => {
    if (b.id === opts.excludeId) return false;
    if (b.vehicleId !== candidate.vehicleId) return false;
    if (!isBlockingStatus(b.status)) return false;
    const [bs, be] = effective(b, !!opts.useBuffers);
    return intervalsOverlap(cs, ce, bs, be);
  });
}

/** Same requester, vehicle, interval and purpose as a still-active booking (e.g. double submit). */
export function findDuplicates(candidate: Pick<IntervalBooking, "vehicleId" | "startUtc" | "endUtc" | "requesterId" | "purpose">, existing: readonly IntervalBooking[]): IntervalBooking[] {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return existing.filter((b) =>
    isBlockingStatus(b.status) && b.vehicleId === candidate.vehicleId && b.requesterId === candidate.requesterId &&
    b.startUtc === candidate.startUtc && b.endUtc === candidate.endUtc && norm(b.purpose) === norm(candidate.purpose));
}

function order(a: IntervalBooking, b: IntervalBooking): number {
  const ca = a.createdAt ? t(a.createdAt) : Infinity;
  const cb = b.createdAt ? t(b.createdAt) : Infinity;
  if (ca !== cb) return ca - cb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface ConflictPair { winner: IntervalBooking; loser: IntervalBooking }

/** Existing overlapping blocking pairs per vehicle; earlier createdAt (then id) is the winner. */
export function reconcile(bookings: readonly IntervalBooking[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  const live = bookings.filter((b) => b.vehicleId && isBlockingStatus(b.status));
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]; const b = live[j];
      if (a.vehicleId !== b.vehicleId) continue;
      if (!intervalsOverlap(a.startUtc, a.endUtc, b.startUtc, b.endUtc)) continue;
      const [winner, loser] = order(a, b) <= 0 ? [a, b] : [b, a];
      pairs.push({ winner, loser });
    }
  }
  return pairs;
}

/** After a write: did the newly added booking lose against an earlier overlapping one? */
export function checkAfterWrite(newId: string, fresh: readonly IntervalBooking[]): { status: "ok" } | { status: "conflict"; with: IntervalBooking[] } | { status: "missing" } {
  const mine = fresh.find((b) => b.id === newId);
  if (!mine) return { status: "missing" }; // not visible yet: re-read, never assume success or retry the Add blindly
  const losses = reconcile(fresh).filter((p) => p.loser.id === newId).map((p) => p.winner);
  return losses.length ? { status: "conflict", with: losses } : { status: "ok" };
}
