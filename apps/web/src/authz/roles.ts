/*───────────────────── OPEX roles and permissions (Phase D) ─────────────────────
 * OPEX roles: requester | approver | administrator.
 *
 * IMPORTANT SECURITY LIMITATION: this is CLIENT-SIDE application policy. AddInData security
 * clearances are granted per method (Add/Get/Set/Remove), not per record or per OPEX role, so a
 * user with those clearances can still call the API directly and bypass anything in this file.
 * It prevents mistakes and hides actions; it is not server-enforced authorization. Sensitive
 * actions therefore stay behind disabled capability gates.
 *
 * Roles are NOT derived from `User.role` (not a documented MyGeotab property; the documented
 * `userRole` is a job-function label, not an authorization claim) nor from security groups.
 * They come only from an administrator-controlled mapping stored in AddInData
 * (application_config record `cfg_role_mapping`), plus an empty bootstrap list.
 * Missing, invalid, ambiguous or unreadable mapping → no role → everything denied.
 */
import type { AddInDataStore } from "../storage/addinDataStore.ts";

export const OPEX_ROLES = ["requester", "approver", "administrator"] as const;
export type OpexRole = (typeof OPEX_ROLES)[number];

export const ROLE_MAPPING_RECORD_ID = "cfg_role_mapping";
export const MAX_ROLE_MAPPING_ENTRIES = 100;

/** User ids allowed to administer before any mapping exists. Intentionally EMPTY (owner decision). */
export const BOOTSTRAP_ADMINISTRATOR_IDS: readonly string[] = Object.freeze([]);

export interface RoleMappingEntry { userId: string; role: OpexRole }
export interface RoleMapping { entries: readonly RoleMappingEntry[]; updatedBy: string }

export type RoleResolution =
  | { ok: true; role: OpexRole; source: "mapping" | "bootstrap" }
  | { ok: false; role: null; reason: string };

export type MappingParse = { ok: true; mapping: RoleMapping } | { ok: false; reason: string };

/** Validate an untrusted mapping payload. Any defect rejects the whole mapping (fail closed). */
export function parseRoleMapping(payload: unknown): MappingParse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "Role mapping is not an object." };
  const p = payload as Record<string, unknown>;
  if (p.kind !== "role_mapping") return { ok: false, reason: "Role mapping has the wrong kind." };
  if (typeof p.updatedBy !== "string" || !p.updatedBy.trim()) return { ok: false, reason: "Role mapping has no updatedBy." };
  if (!Array.isArray(p.entries)) return { ok: false, reason: "Role mapping entries are missing." };
  if (p.entries.length > MAX_ROLE_MAPPING_ENTRIES) return { ok: false, reason: "Role mapping has too many entries." };
  const seen = new Set<string>();
  const entries: RoleMappingEntry[] = [];
  for (const raw of p.entries) {
    if (!raw || typeof raw !== "object") return { ok: false, reason: "Role mapping entry is invalid." };
    const e = raw as Record<string, unknown>;
    if (typeof e.userId !== "string" || !e.userId.trim() || e.userId.length > 100) return { ok: false, reason: "Role mapping entry has an invalid userId." };
    if (typeof e.role !== "string" || !(OPEX_ROLES as readonly string[]).includes(e.role)) return { ok: false, reason: "Role mapping entry has an unknown role." };
    if (seen.has(e.userId)) return { ok: false, reason: "Role mapping assigns a user more than once." };
    seen.add(e.userId);
    entries.push({ userId: e.userId, role: e.role as OpexRole });
  }
  return { ok: true, mapping: { entries, updatedBy: p.updatedBy } };
}

/** Role for a verified MyGeotab user id. `mapping` null = mapping missing/unreadable. */
export function resolveRole(userId: unknown, mapping: RoleMapping | null, bootstrap: readonly string[] = BOOTSTRAP_ADMINISTRATOR_IDS): RoleResolution {
  if (typeof userId !== "string" || !userId.trim()) return { ok: false, role: null, reason: "No verified user id." };
  if (mapping) {
    const hit = mapping.entries.find((e) => e.userId === userId);
    if (hit) return { ok: true, role: hit.role, source: "mapping" };
    return { ok: false, role: null, reason: "User has no OPEX role mapping." };
  }
  if (bootstrap.includes(userId)) return { ok: true, role: "administrator", source: "bootstrap" };
  return { ok: false, role: null, reason: "OPEX role mapping is missing." };
}

/** Load the mapping through the AddInData store. Never throws; failure → null + reason. */
export async function loadRoleMapping(store: Pick<AddInDataStore, "list">): Promise<{ mapping: RoleMapping | null; reason: string | null }> {
  try {
    const { records, rejected } = await store.list({ type: "application_config" });
    if (rejected.some((r) => r.recordId === ROLE_MAPPING_RECORD_ID)) return { mapping: null, reason: "OPEX role mapping is ambiguous." };
    const hits = records.filter((r) => r.envelope.recordId === ROLE_MAPPING_RECORD_ID);
    if (hits.length === 0) return { mapping: null, reason: "OPEX role mapping is missing." };
    if (hits.length > 1) return { mapping: null, reason: "OPEX role mapping is ambiguous." };
    const parsed = parseRoleMapping(hits[0].envelope.payload);
    return parsed.ok ? { mapping: parsed.mapping, reason: null } : { mapping: null, reason: parsed.reason };
  } catch (e) {
    return { mapping: null, reason: e instanceof Error ? e.message : "OPEX role mapping could not be loaded." };
  }
}

/*───────────────────── Permission matrix ─────────────────────*/

export const ACTIONS = [
  "booking.create", "booking.edit_own", "booking.cancel_own", "booking.view_own", "notification.view_own",
  "booking.view_all", "booking.approve", "booking.reject",
  "booking.cancel_any", "admin.configure", "audit.view",
] as const;
export type Action = (typeof ACTIONS)[number];

const REQUESTER: readonly Action[] = ["booking.create", "booking.edit_own", "booking.cancel_own", "booking.view_own", "notification.view_own"];
const APPROVER: readonly Action[] = [...REQUESTER, "booking.view_all", "booking.approve", "booking.reject"];
const ADMIN: readonly Action[] = [...APPROVER, "booking.cancel_any", "admin.configure", "audit.view"];
export const ROLE_ACTIONS: Readonly<Record<OpexRole, readonly Action[]>> = Object.freeze({ requester: REQUESTER, approver: APPROVER, administrator: ADMIN });

export interface PermissionContext {
  actorId: string | null | undefined;
  /** Booking owner, required for *_own actions and for approve/reject (self-approval check). */
  requesterId?: string | null;
}

export type PermissionDecision = { allowed: true } | { allowed: false; reason: string };

export function can(role: OpexRole | null | undefined, action: unknown, ctx: PermissionContext): PermissionDecision {
  if (!role || !(OPEX_ROLES as readonly string[]).includes(role)) return { allowed: false, reason: "No OPEX role." };
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) return { allowed: false, reason: "Unknown action." };
  if (typeof ctx.actorId !== "string" || !ctx.actorId.trim()) return { allowed: false, reason: "No verified actor." };
  if (!ROLE_ACTIONS[role].includes(action as Action)) return { allowed: false, reason: `Role ${role} may not ${action}.` };
  if (action === "booking.approve" || action === "booking.reject") {
    if (!ctx.requesterId) return { allowed: false, reason: "Booking owner unknown." };
    if (ctx.requesterId === ctx.actorId) return { allowed: false, reason: "Self-approval is prohibited." };
  }
  if (action.endsWith("_own")) {
    // For notification.view_own the caller passes the notification recipient as requesterId.
    if (!ctx.requesterId || ctx.requesterId !== ctx.actorId) return { allowed: false, reason: "Not the owner." };
  }
  return { allowed: true };
}
