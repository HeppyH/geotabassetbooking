/*───────────────────── Audit records (Phase F) ─────────────────────
 * Audit entries are SEPARATE AddInData records (recordType "audit", id prefix aud_), never
 * booking or notification records. The repository exposes append + read only: no update and no
 * remove, so normal application workflows cannot rewrite history.
 *
 * This is NOT tamper-proof. Anyone with AddInData Set/Remove clearance can alter or delete audit
 * records through the raw API, and `actorId`/timestamps are client-supplied. Do not present this
 * as an immutable ledger.
 */
import type { AddInDataStore, StoredRecord } from "../storage/addinDataStore.ts";
import { newRecordId } from "../storage/recordEnvelope.ts";
import type { RecordEnvelope } from "../storage/recordEnvelope.ts";

export const AUDIT_ACTIONS = [
  "CREATE", "EDIT", "SUBMIT", "APPROVE", "REJECT", "CANCEL", "ASSIGN", "COMPLETE",
  "DRIVER_CHANGE", "VEHICLE_CHANGE", "DATETIME_CHANGE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditChange { field: string; from: string | null; to: string | null }
export interface AuditEntry {
  recordId: string; serverId: string; bookingId: string; action: AuditAction; actorId: string;
  at: string; reason: string | null; changes: AuditChange[]; previousStatus: string | null; newStatus: string | null;
}
export interface NewAuditEntry {
  bookingId: string; action: AuditAction; reason?: string | null; changes?: AuditChange[];
  previousStatus?: string | null; newStatus?: string | null;
}

const MAX_CHANGES = 20;
const clip = (v: unknown, n: number): string | null => (v === null || v === undefined ? null : String(v).slice(0, n));

/** Pure diff of the audited booking fields → driver/vehicle/date-time changes with action hints. */
export function diffBooking(
  before: Record<string, unknown>, after: Record<string, unknown>,
): { changes: AuditChange[]; actions: AuditAction[] } {
  const groups: Array<[AuditAction, string[]]> = [
    ["VEHICLE_CHANGE", ["vehicleId", "vehicleNameSnapshot"]],
    ["DRIVER_CHANGE", ["driverUserId", "driverNameSnapshot"]],
    ["DATETIME_CHANGE", ["startUtc", "endUtc", "timeZone"]],
  ];
  const changes: AuditChange[] = [];
  const actions: AuditAction[] = [];
  for (const [action, fields] of groups) {
    let hit = false;
    for (const f of fields) {
      if ((before[f] ?? null) !== (after[f] ?? null)) { changes.push({ field: f, from: clip(before[f], 200), to: clip(after[f], 200) }); hit = true; }
    }
    if (hit) actions.push(action);
  }
  for (const f of ["purpose", "destination"]) {
    if ((before[f] ?? null) !== (after[f] ?? null)) changes.push({ field: f, from: clip(before[f], 200), to: clip(after[f], 200) });
  }
  return { changes: changes.slice(0, MAX_CHANGES), actions };
}

function toEntry(rec: StoredRecord): AuditEntry | null {
  if (rec.envelope.recordType !== "audit") return null;
  const p = rec.envelope.payload;
  if (p.kind !== "audit" || typeof p.bookingId !== "string" || !p.bookingId) return null;
  if (typeof p.action !== "string" || !(AUDIT_ACTIONS as readonly string[]).includes(p.action)) return null;
  if (!Array.isArray(p.changes)) return null;
  const changes: AuditChange[] = [];
  for (const c of p.changes) {
    if (!c || typeof c !== "object" || typeof (c as AuditChange).field !== "string") return null;
    changes.push({ field: (c as AuditChange).field, from: clip((c as AuditChange).from, 200), to: clip((c as AuditChange).to, 200) });
  }
  return {
    recordId: rec.envelope.recordId, serverId: rec.serverId, bookingId: p.bookingId, action: p.action as AuditAction,
    actorId: rec.envelope.createdBy, at: rec.envelope.createdAt, reason: typeof p.reason === "string" ? p.reason : null, changes,
    previousStatus: typeof p.previousStatus === "string" ? p.previousStatus : null, newStatus: typeof p.newStatus === "string" ? p.newStatus : null,
  };
}

export interface AuditDeps { store: Pick<AddInDataStore, "list" | "add">; actorId: string; now?: () => Date; random?: () => string }

export function createAuditRepo(deps: AuditDeps) {
  if (typeof deps.actorId !== "string" || !deps.actorId.trim()) throw new Error("AUDIT_REPO_NO_ACTOR");
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? (() => Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
  return {
    /** Append-only. The actor is always the authenticated user; callers cannot supply another. */
    async append(entry: NewAuditEntry): Promise<AuditEntry> {
      if (!(AUDIT_ACTIONS as readonly string[]).includes(entry.action)) throw new Error("AUDIT_UNKNOWN_ACTION");
      if (!entry.bookingId || typeof entry.bookingId !== "string") throw new Error("AUDIT_NO_BOOKING");
      const env: RecordEnvelope = {
        schemaVersion: 1, recordType: "audit", recordId: newRecordId("audit", random), createdAt: now().toISOString(), createdBy: deps.actorId,
        payload: { kind: "audit", bookingId: entry.bookingId, action: entry.action, reason: clip(entry.reason, 500),
          changes: (entry.changes ?? []).slice(0, MAX_CHANGES), previousStatus: clip(entry.previousStatus, 50), newStatus: clip(entry.newStatus, 50) },
      };
      const saved = await deps.store.add(env);
      const e = toEntry(saved);
      if (!e) throw new Error("AUDIT_INVALID_RECORD");
      return e;
    },
    /** Chronological history for one booking. */
    async history(bookingId: string): Promise<AuditEntry[]> {
      const { records } = await deps.store.list({ type: "audit" });
      return records.map(toEntry).filter((e): e is AuditEntry => e !== null && e.bookingId === bookingId)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.recordId < b.recordId ? -1 : 1));
    },
  };
}

export type AuditRepo = ReturnType<typeof createAuditRepo>;
