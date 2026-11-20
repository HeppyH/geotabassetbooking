/*───────────────────── Explicit Tenant Context Validation ─────────────────────
 * Phase B. Fail-closed validation of the MyGeotab tenant (database/server) the Add-In is
 * running in, against an explicit allowlist.
 *
 * - APPROVED_TENANT_CONTEXTS is EMPTY. It may only be populated after written administrator
 *   approval (separately authorized change). With an empty allowlist every tenant is denied.
 * - Matching is exact and case-sensitive. A database name that differs only by case does not
 *   match (fail closed; MyGeotab's case handling is not verified).
 * - Malformed allowlist entries deny everything (an unreadable allowlist is never "open").
 * - This module has NO imports and performs no I/O.
 */

export interface TenantContext {
  /** MyGeotab database name from the session. */
  database: string;
  /** Optional MyGeotab server host. When an allowlist entry lists a server it must match. */
  server?: string;
}

export type TenantDenialCode =
  | "TENANT_CONTEXT_MISSING"
  | "TENANT_CONTEXT_INVALID"
  | "TENANT_ALLOWLIST_INVALID"
  | "TENANT_ALLOWLIST_EMPTY"
  | "TENANT_NOT_APPROVED";

export type TenantDecision =
  | { ok: true; tenant: TenantContext }
  | { ok: false; code: TenantDenialCode; reason: string };

/** Approved tenant allowlist. MUST remain empty until written administrator approval. */
export const APPROVED_TENANT_CONTEXTS: readonly TenantContext[] = Object.freeze([]) as readonly TenantContext[];

const DATABASE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const SERVER_PATTERN = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

function parseTenantContext(raw: unknown): TenantContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const database = record.database;
  if (typeof database !== "string" || !DATABASE_PATTERN.test(database)) return null;
  const server = record.server;
  if (server === undefined || server === null || server === "") {
    return { database };
  }
  if (typeof server !== "string" || !SERVER_PATTERN.test(server)) return null;
  return { database, server };
}

/**
 * Validate a session-derived tenant context against the allowlist.
 * `rawContext` is whatever the runtime observed (e.g. the MyGeotab session). Nothing about it is trusted.
 */
export function validateTenantContext(
  rawContext: unknown,
  allowlist: readonly unknown[] = APPROVED_TENANT_CONTEXTS,
): TenantDecision {
  if (rawContext === undefined || rawContext === null) {
    return { ok: false, code: "TENANT_CONTEXT_MISSING", reason: "Tenant context is missing." };
  }
  const tenant = parseTenantContext(rawContext);
  if (!tenant) {
    return { ok: false, code: "TENANT_CONTEXT_INVALID", reason: "Tenant context is malformed." };
  }
  if (!Array.isArray(allowlist)) {
    return { ok: false, code: "TENANT_ALLOWLIST_INVALID", reason: "Tenant allowlist is not readable." };
  }
  if (allowlist.length === 0) {
    return { ok: false, code: "TENANT_ALLOWLIST_EMPTY", reason: "No tenant has been approved (allowlist is empty)." };
  }

  const parsedAllowlist: TenantContext[] = [];
  for (const entry of allowlist) {
    const parsed = parseTenantContext(entry);
    if (!parsed) {
      return { ok: false, code: "TENANT_ALLOWLIST_INVALID", reason: "Tenant allowlist contains a malformed entry." };
    }
    parsedAllowlist.push(parsed);
  }

  const approved = parsedAllowlist.some(
    (entry) => entry.database === tenant.database && (entry.server === undefined || entry.server === tenant.server),
  );
  if (!approved) {
    return { ok: false, code: "TENANT_NOT_APPROVED", reason: "Tenant is not on the approved allowlist." };
  }
  return { ok: true, tenant };
}
