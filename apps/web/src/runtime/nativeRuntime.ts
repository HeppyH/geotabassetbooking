/*───────────────────── Native Runtime Composition ─────────────────────
 * Phase B. Builds the native MyGeotab runtime from: the lifecycle api object, the central
 * capability gate, the tenant allowlist and the (fixed, non-overridable) AddInId.
 *
 * Order of operations (each step fails closed and stops):
 *   1. No api object                         → blocked (no calls made)
 *   2. MYGEOTAB_IDENTITY_ENABLED flag false  → blocked (NO api call of any kind)
 *   3. getSession (session context only)     → tenant context {database, server}
 *   4. validateTenantContext                 → missing / invalid / unknown tenant → blocked
 *   5. identity gate with approved tenant    → resolveAuthenticatedPrincipal (Get User)
 *   6. principal session database must equal the validated tenant database
 *   7. access views + gated provider are built from gate × tenant × identity
 *
 * Nothing here selects a demo/local provider. A blocked or failing native runtime exposes a
 * provider that rejects; there is no fallback path to localStorage, mock data, or any backend.
 *
 * The AddInId is never read from localStorage, the URL, the UI or the environment.
 */
import type { IdentityResolutionState } from "../auth/identityResolver.ts";
import { resolveAuthenticatedPrincipal } from "../auth/identityResolver.ts";
import { DEFAULT_ADDIN_ID } from "../config/addinId.ts";
import type { AppRuntime, RuntimeAccess, AccessView } from "./appRuntime.ts";
import type { CapabilityGate } from "./capabilities.ts";
import { getProductionCapabilityGate } from "./capabilities.ts";
import { createGatedApi, createIdentityApi } from "./gatedApi.ts";
import { createAddInDataStore } from "../storage/addinDataStore.ts";
import { can, loadRoleMapping, resolveRole } from "../authz/roles.ts";
import type { OpexRole, RoleMapping } from "../authz/roles.ts";
import type { GateContext, RawGeotabApi } from "./gatedApi.ts";
import { createDeniedProvider, createNativeProvider } from "./nativeProvider.ts";
import { APPROVED_TENANT_CONTEXTS, validateTenantContext } from "./tenantContext.ts";

export interface NativeRuntimeOptions {
  api: RawGeotabApi | null | undefined;
  /** Defaults to the frozen production gate. Tests inject mock configurations. */
  gate?: CapabilityGate;
  /** Defaults to the (empty) approved allowlist. Tests inject mock allowlists. */
  allowlist?: readonly unknown[];
  /** Defaults to the fixed project AddInId. */
  addInId?: string;
  /**
   * OPEX role mapping. `undefined` = load it from AddInData (only when the read capability
   * is allowed); `null` = known missing. Tests inject mappings. No mapping → no role → denied.
   */
  roleMapping?: RoleMapping | null;
  /** Bootstrap administrator ids (defaults to the empty production list). */
  bootstrapAdministrators?: readonly string[];
}

function view(allowed: boolean, reason: string | null): AccessView {
  return { allowed, reason: allowed ? null : reason };
}

function blockedAccess(reason: string): RuntimeAccess {
  return { read: view(false, reason), write: view(false, reason), approve: view(false, reason) };
}

type NativeRuntime = Extract<AppRuntime, { kind: "native" }>;
const NO_ROLE = { role: null as OpexRole | null, roleReason: "OPEX role is not resolved." };

function blocked(reason: string, identity: IdentityResolutionState, tenantLabel = "—"): NativeRuntime {
  return {
    kind: "native",
    provider: createDeniedProvider(reason),
    identity,
    tenantLabel,
    access: blockedAccess(reason),
    ...NO_ROLE,
  };
}

function getSessionContext(api: RawGeotabApi): Promise<{ database?: unknown; server?: unknown } | null> {
  return new Promise((resolve) => {
    try {
      if (typeof api.getSession !== "function") {
        resolve(null);
        return;
      }
      api.getSession((session) => resolve(session ?? null));
    } catch {
      resolve(null);
    }
  });
}

export async function createNativeRuntime(options: NativeRuntimeOptions): Promise<NativeRuntime> {
  const gate = options.gate ?? getProductionCapabilityGate();
  const allowlist = options.allowlist ?? APPROVED_TENANT_CONTEXTS;
  const addInId = options.addInId ?? DEFAULT_ADDIN_ID;
  const api = options.api;

  if (!api || typeof api.call !== "function") {
    return blocked("MyGeotab API is not available. The native runtime only runs inside a MyGeotab Add-In page.", {
      status: "unresolved",
      reason: "MyGeotab API is not available.",
    });
  }

  // Step 2: identity flag off → no API call at all (not even getSession).
  if (!gate.isFlagEnabled("MYGEOTAB_IDENTITY_ENABLED")) {
    const reason = "Live MyGeotab capabilities are disabled (MYGEOTAB_IDENTITY_ENABLED is false).";
    return blocked(reason, { status: "unresolved", reason });
  }

  // Step 3: session context only (no data access).
  const session = await getSessionContext(api);
  const tenantDecision = validateTenantContext(
    session === null ? null : { database: session.database, server: session.server },
    allowlist,
  );
  const tenantApproved = tenantDecision.ok;
  if (!tenantDecision.ok) {
    return blocked(tenantDecision.reason, { status: "unresolved", reason: tenantDecision.reason });
  }

  const ctx: GateContext = { gate, tenantApproved };

  // Step 5: identity (Get User) through the gated identity api.
  const identity = await resolveAuthenticatedPrincipal(createIdentityApi(api, ctx));
  if (identity.status !== "authenticated") {
    const reason = identity.status === "loading" ? "MyGeotab identity is still resolving." : identity.reason;
    return blocked(reason, identity, tenantDecision.tenant.database);
  }

  // Step 6: the principal must belong to the tenant that was validated.
  if (identity.session.database !== tenantDecision.tenant.database) {
    const reason = "Authenticated session does not match the validated tenant.";
    return blocked(reason, { status: "unresolved", reason }, tenantDecision.tenant.database);
  }

  // Step 7: access views from gate × tenant × identity.
  const readDecision = gate.evaluate("LIVE_BOOKING_READ_ENABLED", tenantApproved);
  const writeDecision = gate.evaluate("LIVE_BOOKING_WRITE_ENABLED", tenantApproved);
  const approveDecision = gate.evaluate("APPROVAL_ACTIONS_ENABLED", tenantApproved);
  const storageDecision = gate.evaluate("MYGEOTAB_STORAGE_ENABLED", tenantApproved);

  const readOk = readDecision.allowed && storageDecision.allowed;
  const writeOk = readOk && writeDecision.allowed;
  const approveOk = writeOk && approveDecision.allowed;

  const reasonFor = (decision: { allowed: boolean; reason: string | null }) => decision.reason ?? "Denied.";

  // Step 8 (Phase D): OPEX role. Fail closed: no mapping / no entry → no role → no access.
  let mapping: RoleMapping | null = null;
  let mappingReason: string | null = "OPEX role mapping is unavailable.";
  if (options.roleMapping !== undefined) {
    mapping = options.roleMapping;
    mappingReason = mapping ? null : "OPEX role mapping is missing.";
  } else if (readOk) {
    const store = createAddInDataStore({ api: createGatedApi(api, ctx), addInId });
    const loaded = await loadRoleMapping(store);
    mapping = loaded.mapping;
    mappingReason = loaded.reason;
  }
  const roleResolution = resolveRole(identity.principal.id, mapping, options.bootstrapAdministrators);
  const role = roleResolution.ok ? roleResolution.role : null;
  const roleReason = roleResolution.ok ? null : mappingReason && !mapping ? mappingReason : roleResolution.reason;
  const roleDenied = (allowedByRole: boolean) => (role === null ? roleReason ?? "No OPEX role." : allowedByRole ? null : "OPEX role does not permit this action.");
  const actor = identity.principal.id;
  const roleCreate = role !== null && can(role, "booking.create", { actorId: actor }).allowed;
  const roleApprove = role !== null && ["approver", "administrator"].includes(role);

  const gateRead = !storageDecision.allowed ? reasonFor(storageDecision) : reasonFor(readDecision);
  const readFinal = readOk && role !== null;
  const writeFinal = writeOk && roleCreate;
  const approveFinal = approveOk && roleApprove;
  const access: RuntimeAccess = {
    read: view(readFinal, !readOk ? gateRead : roleDenied(true)),
    write: view(writeFinal, !writeOk ? (!readOk ? gateRead : reasonFor(writeDecision)) : roleDenied(roleCreate)),
    approve: view(approveFinal, !approveOk ? (!writeOk ? (!readOk ? gateRead : reasonFor(writeDecision)) : reasonFor(approveDecision)) : roleDenied(roleApprove)),
  };

  return {
    kind: "native",
    provider: readFinal ? createNativeProvider({ api, addInId, ctx, identityAuthenticated: true, roleAllows: { write: roleCreate, approve: roleApprove }, actor: { id: actor, role } }) : createDeniedProvider(access.read.reason ?? "Denied."),
    identity,
    tenantLabel: tenantDecision.tenant.database,
    access,
    role,
    roleReason,
  };
}

/** Initial runtime shown before any MyGeotab lifecycle callback has delivered an api object. */
export function createInitialNativeRuntime(): NativeRuntime {
  const reason = "MyGeotab runtime not initialized.";
  return blocked(reason, { status: "unresolved", reason });
}
