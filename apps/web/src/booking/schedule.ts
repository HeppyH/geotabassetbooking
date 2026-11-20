/*───────────────────── Booking schedule / time zones (Phase E) ─────────────────────
 * Local date+time in a configurable IANA time zone (default Asia/Jakarta) → UTC ISO instants.
 * Supports different start/end dates and times, cross-midnight and multi-day bookings.
 * Ambiguous (DST fall-back) and non-existent (DST gap) local times are REJECTED, never guessed.
 * Uses only Intl (no dependency). Pure; no storage, no network.
 */
export const DEFAULT_TIME_ZONE = "Asia/Jakarta";

export type ScheduleErrorCode =
  | "INVALID_TIME_ZONE" | "INVALID_DATE" | "INVALID_TIME" | "AMBIGUOUS_LOCAL_TIME"
  | "NONEXISTENT_LOCAL_TIME" | "END_NOT_AFTER_START";

export type LocalToUtc = { ok: true; utc: string } | { ok: false; code: ScheduleErrorCode; reason: string };

export interface ScheduleInput { startDate: string; startTime: string; endDate: string; endTime: string; timeZone?: string }
export type ScheduleResult =
  | { ok: true; startUtc: string; endUtc: string; timeZone: string; startLocal: string; endLocal: string }
  | { ok: false; code: ScheduleErrorCode; reason: string; field?: "start" | "end" };

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parts(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute };
}

const sameLocal = (ms: number, tz: string, y: number, mo: number, d: number, h: number, mi: number) => {
  const p = parts(ms, tz);
  return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi;
};

export function localToUtc(date: string, time: string, timeZone: string = DEFAULT_TIME_ZONE): LocalToUtc {
  if (!isValidTimeZone(timeZone)) return { ok: false, code: "INVALID_TIME_ZONE", reason: "Unknown time zone." };
  const dm = typeof date === "string" ? DATE_RE.exec(date) : null;
  if (!dm) return { ok: false, code: "INVALID_DATE", reason: "Date must be YYYY-MM-DD." };
  const tm = typeof time === "string" ? TIME_RE.exec(time) : null;
  if (!tm) return { ok: false, code: "INVALID_TIME", reason: "Time must be HH:mm (24h)." };
  const [y, mo, d, h, mi] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return { ok: false, code: "INVALID_DATE", reason: "Date does not exist." };
  }
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  // Candidate instants: the naive time shifted by each offset seen within +-1 day.
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const t = naive + delta;
    const p = parts(t, timeZone);
    offsets.add(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - t);
  }
  const hits = new Set<number>();
  for (const off of offsets) {
    const cand = naive - off;
    if (sameLocal(cand, timeZone, y, mo, d, h, mi)) hits.add(cand);
  }
  if (hits.size === 0) return { ok: false, code: "NONEXISTENT_LOCAL_TIME", reason: "That local time does not exist (daylight-saving gap)." };
  if (hits.size > 1) return { ok: false, code: "AMBIGUOUS_LOCAL_TIME", reason: "That local time occurs twice (daylight-saving overlap)." };
  return { ok: true, utc: new Date([...hits][0]).toISOString() };
}

export function formatLocal(utcIso: string, timeZone: string = DEFAULT_TIME_ZONE): string | null {
  const t = Date.parse(utcIso);
  if (Number.isNaN(t) || !isValidTimeZone(timeZone)) return null;
  const p = parts(t, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const tz = input.timeZone ?? DEFAULT_TIME_ZONE;
  const s = localToUtc(input.startDate, input.startTime, tz);
  if (!s.ok) return { ...s, field: "start" };
  const e = localToUtc(input.endDate, input.endTime, tz);
  if (!e.ok) return { ...e, field: "end" };
  if (Date.parse(e.utc) <= Date.parse(s.utc)) return { ok: false, code: "END_NOT_AFTER_START", reason: "End must be after start.", field: "end" };
  return { ok: true, startUtc: s.utc, endUtc: e.utc, timeZone: tz, startLocal: formatLocal(s.utc, tz)!, endLocal: formatLocal(e.utc, tz)! };
}

export interface ScheduleLimits { minDurationMinutes?: number; maxDurationMinutes?: number; maxAdvanceDays?: number; now?: number }

/** Optional business limits (configured by administrators in Phase G). */
export function checkLimits(startUtc: string, endUtc: string, limits: ScheduleLimits): { ok: true } | { ok: false; reason: string } {
  const s = Date.parse(startUtc);
  const e = Date.parse(endUtc);
  const minutes = (e - s) / 60000;
  if (limits.minDurationMinutes !== undefined && minutes < limits.minDurationMinutes) return { ok: false, reason: "Booking is shorter than the minimum duration." };
  if (limits.maxDurationMinutes !== undefined && minutes > limits.maxDurationMinutes) return { ok: false, reason: "Booking is longer than the maximum duration." };
  if (limits.maxAdvanceDays !== undefined && limits.now !== undefined && s - limits.now > limits.maxAdvanceDays * 86400000) return { ok: false, reason: "Booking is too far in advance." };
  return { ok: true };
}
