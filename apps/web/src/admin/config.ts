/*───────────────────── Application configuration & role administration (Phase G) ─────────────────────
 * Settings live in AddInData `application_config` records (cfg_app_settings, cfg_role_mapping).
 * Only a mapped ADMINISTRATOR may write them (client-side policy; see authz/roles.ts limits).
 * Configuration can NEVER touch capability gates: unknown keys — including every capability
 * name — are rejected, and nothing here is read by capabilities.ts.
 * Invalid or missing stored settings fall back to conservative DEFAULTS (reported), they never
 * widen anything. Role-mapping saves refuse to remove the last administrator.
 */
import type { AddInDataStore } from "../storage/addinDataStore.ts";
import { StorageError } from "../storage/addinDataStore.ts";
import type { RecordEnvelope } from "../storage/recordEnvelope.ts";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "../booking/schedule.ts";
import { OPEX_ROLES, ROLE_MAPPING_RECORD_ID, can, loadRoleMapping, parseRoleMapping } from "../authz/roles.ts";
import type { OpexRole, RoleMapping } from "../authz/roles.ts";
import { NOTIFICATION_TYPES } from "../notifications/notificationRepo.ts";

export const SETTINGS_RECORD_ID = "cfg_app_settings";

export interface AppSettings {
  timeZone: string;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  maxAdvanceDays: number;
  destinationRequired: boolean;
  /** Approval is always required in this version; the field exists so the rule is explicit. */
  approvalRequired: true;
  notificationPreferences: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  timeZone: DEFAULT_TIME_ZONE,
  minDurationMinutes: 15,
  maxDurationMinutes: 14 * 24 * 60,
  maxAdvanceDays: 180,
  destinationRequired: false,
  approvalRequired: true as const,
  notificationPreferences: Object.freeze(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true]))) as Record<string, boolean>,
});

const KEYS = ["kind", "timeZone", "minDurationMinutes", "maxDurationMinutes", "maxAdvanceDays", "destinationRequired", "approvalRequired", "notificationPreferences"];

export type SettingsParse = { ok: true; settings: AppSettings } | { ok: false; reason: string };

const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export function parseSettings(raw: unknown): SettingsParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "Settings are not an object." };
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!KEYS.includes(k)) return { ok: false, reason: `Unknown setting "${k}".` };
  if (r.kind !== "app_settings") return { ok: false, reason: "Settings have the wrong kind." };
  if (!isValidTimeZone(r.timeZone)) return { ok: false, reason: "timeZone is not a valid IANA zone." };
  if (!intIn(r.minDurationMinutes, 1, 1440)) return { ok: false, reason: "minDurationMinutes must be 1–1440." };
  if (!intIn(r.maxDurationMinutes, 1, 60 * 24 * 90)) return { ok: false, reason: "maxDurationMinutes must be 1–129600." };
  if (r.maxDurationMinutes < r.minDurationMinutes) return { ok: false, reason: "maxDurationMinutes must be >= minDurationMinutes." };
  if (!intIn(r.maxAdvanceDays, 0, 730)) return { ok: false, reason: "maxAdvanceDays must be 0–730." };
  if (typeof r.destinationRequired !== "boolean") return { ok: false, reason: "destinationRequired must be boolean." };
  if (r.approvalRequired !== true) return { ok: false, reason: "approvalRequired must be true." };
  const prefs = r.notificationPreferences;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return { ok: false, reason: "notificationPreferences must be an object." };
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(prefs as Record<string, unknown>)) {
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(k)) return { ok: false, reason: `Unknown notification type "${k}".` };
    if (typeof v !== "boolean") return { ok: false, reason: `Preference "${k}" must be boolean.` };
    out[k] = v;
  }
  for (const t of NOTIFICATION_TYPES) if (!(t in out)) out[t] = true;
  return { ok: true, settings: { timeZone: r.timeZone, minDurationMinutes: r.minDurationMinutes, maxDurationMinutes: r.maxDurationMinutes, maxAdvanceDays: r.maxAdvanceDays, destinationRequired: r.destinationRequired, approvalRequired: true, notificationPreferences: out } };
}

export function settingsToPayload(s: AppSettings): Record<string, unknown> {
  return { kind: "app_settings", ...s };
}

export interface AdminDeps { store: Pick<AddInDataStore, "list" | "add" | "update">; actorId: string; role: OpexRole | null; now?: () => Date }

export function createAdminRepo(deps: AdminDeps) {
  const now = deps.now ?? (() => new Date());
  const guard = () => {
    const d = can(deps.role, "admin.configure", { actorId: deps.actorId });
    if (!d.allowed) throw new StorageError("INVALID_RECORD", `Administrator access required: ${d.reason}`);
  };

  async function find(recordId: string) {
    const { records } = await deps.store.list({ type: "application_config", forceRefresh: true });
    return records.find((r) => r.envelope.recordId === recordId) ?? null;
  }

  async function upsert(recordId: string, payload: Record<string, unknown>): Promise<void> {
    const existing = await find(recordId);
    const stamp = now().toISOString();
    if (existing) {
      const env: RecordEnvelope = { ...existing.envelope, updatedAt: stamp, payload };
      await deps.store.update(existing.serverId, env, existing.envelope.updatedAt ?? existing.envelope.createdAt);
    } else {
      await deps.store.add({ schemaVersion: 1, recordType: "application_config", recordId, createdAt: stamp, createdBy: deps.actorId, payload });
    }
  }

  return {
    /** Readable by any authenticated role; invalid/missing → defaults + reason (never throws on bad data). */
    async loadSettings(): Promise<{ settings: AppSettings; source: "stored" | "default"; reason: string | null }> {
      try {
        const rec = await find(SETTINGS_RECORD_ID);
        if (!rec) return { settings: { ...DEFAULT_SETTINGS }, source: "default", reason: "No stored settings." };
        const parsed = parseSettings(rec.envelope.payload);
        return parsed.ok ? { settings: parsed.settings, source: "stored", reason: null } : { settings: { ...DEFAULT_SETTINGS }, source: "default", reason: parsed.reason };
      } catch (e) {
        return { settings: { ...DEFAULT_SETTINGS }, source: "default", reason: e instanceof Error ? e.message : "Settings unavailable." };
      }
    },
    async saveSettings(input: unknown): Promise<AppSettings> {
      guard();
      const parsed = parseSettings(typeof input === "object" && input !== null ? { kind: "app_settings", ...(input as object) } : input);
      if (!parsed.ok) throw new StorageError("INVALID_RECORD", parsed.reason);
      await upsert(SETTINGS_RECORD_ID, settingsToPayload(parsed.settings));
      return parsed.settings;
    },
    async loadRoles(): Promise<{ mapping: RoleMapping | null; reason: string | null }> {
      guard();
      return loadRoleMapping(deps.store);
    },
    /** Replace the whole mapping. Refuses to leave the system without an administrator. */
    async saveRoleMapping(entries: unknown): Promise<RoleMapping> {
      guard();
      const parsed = parseRoleMapping({ kind: "role_mapping", updatedBy: deps.actorId, entries });
      if (!parsed.ok) throw new StorageError("INVALID_RECORD", parsed.reason);
      if (!parsed.mapping.entries.some((e) => e.role === "administrator")) throw new StorageError("INVALID_RECORD", "At least one administrator must remain mapped.");
      await upsert(ROLE_MAPPING_RECORD_ID, { kind: "role_mapping", updatedBy: deps.actorId, entries: parsed.mapping.entries });
      return parsed.mapping;
    },
  };
}
export type AdminRepo = ReturnType<typeof createAdminRepo>;
export { OPEX_ROLES };
