/*───────────────────── Capability-Gated MyGeotab API wrapper ─────────────────────
 * Phase B. The ONLY object native providers receive in place of the raw MyGeotab `api`.
 * Every call is classified and authorized BEFORE the underlying api is touched.
 *
 *  - Unknown methods / typeNames are denied (allowlist, fail closed).
 *  - Denied calls never reach the raw api; the error callback receives CapabilityDeniedError.
 *  - No fallback: a failing underlying call is reported as an error, never retried elsewhere.
 *
 * Call → required capabilities:
 *   Get Device|User|Group              LIVE_BOOKING_READ_ENABLED
 *   Get AddInData                      MYGEOTAB_STORAGE_ENABLED + LIVE_BOOKING_READ_ENABLED
 *   Add|Set|Remove AddInData           MYGEOTAB_STORAGE_ENABLED + LIVE_BOOKING_WRITE_ENABLED
 *   anything else                      denied
 * (Prerequisite chains in capabilities.ts are enforced by gate.evaluate.)
 */
import type { CapabilityGate, CapabilityName, CapabilityDecision } from "./capabilities.ts";
import { CapabilityDeniedError } from "./capabilities.ts";

export type RawGeotabApi = {
  call?: (method: string, params: Record<string, unknown>, success: (result: unknown) => void, error?: (error: unknown) => void) => void;
  getSession?: (callback: (session: { userName?: string; database?: string; server?: string } | null) => void) => void;
};

export interface GateContext {
  gate: CapabilityGate;
  /** Result of validateTenantContext(...).ok. */
  tenantApproved: boolean;
}

const MASTER_DATA_TYPES: readonly string[] = ["Device", "User", "Group"];
const ADDINDATA_WRITE_METHODS: readonly string[] = ["Add", "Set", "Remove"];

/** Returns the capabilities a call needs, or null when the call is not allowed at all. */
export function requiredCapabilitiesForCall(method: unknown, params: unknown): CapabilityName[] | null {
  if (typeof method !== "string" || !params || typeof params !== "object") return null;
  const typeName = (params as Record<string, unknown>).typeName;
  if (typeof typeName !== "string") return null;
  if (method === "Get") {
    if (typeName === "AddInData") return ["MYGEOTAB_STORAGE_ENABLED", "LIVE_BOOKING_READ_ENABLED"];
    if (MASTER_DATA_TYPES.includes(typeName)) return ["LIVE_BOOKING_READ_ENABLED"];
    return null;
  }
  if (ADDINDATA_WRITE_METHODS.includes(method) && typeName === "AddInData") {
    return ["MYGEOTAB_STORAGE_ENABLED", "LIVE_BOOKING_WRITE_ENABLED"];
  }
  return null;
}

/** First denial among the required capabilities, or null if all are allowed. */
export function firstDenial(ctx: GateContext, names: readonly CapabilityName[]): Extract<CapabilityDecision, { allowed: false }> | null {
  for (const name of names) {
    const decision = ctx.gate.evaluate(name, ctx.tenantApproved);
    if (!decision.allowed) return decision;
  }
  return null;
}

function deniedUnknownCall(method: unknown): Extract<CapabilityDecision, { allowed: false }> {
  return {
    allowed: false,
    capability: "UNKNOWN_API_CALL",
    code: "CAPABILITY_UNKNOWN",
    reason: `MyGeotab call "${String(method)}" is not permitted in the native runtime.`,
  };
}

/** Gated api for data providers. Never exposes `getSession` or any non-allowlisted call. */
export function createGatedApi(raw: RawGeotabApi | null | undefined, ctx: GateContext): RawGeotabApi {
  return {
    call(method, params, success, error) {
      const needed = requiredCapabilitiesForCall(method, params);
      const denial = needed === null ? deniedUnknownCall(method) : firstDenial(ctx, needed);
      if (denial) {
        error?.(new CapabilityDeniedError(denial));
        return;
      }
      if (!raw || typeof raw.call !== "function") {
        error?.(new Error("GEOTAB_API_NOT_AVAILABLE: MyGeotab API is not available."));
        return;
      }
      try {
        raw.call(method, params, success, error);
      } catch (e) {
        error?.(e);
      }
    },
  };
}

/**
 * Gated api used only for identity resolution. Allows getSession and `Get User`, and only
 * when MYGEOTAB_IDENTITY_ENABLED passes with an approved tenant.
 */
export function createIdentityApi(raw: RawGeotabApi | null | undefined, ctx: GateContext): RawGeotabApi {
  const decision = ctx.gate.evaluate("MYGEOTAB_IDENTITY_ENABLED", ctx.tenantApproved);
  return {
    call(method, params, success, error) {
      const isGetUser = method === "Get" && !!params && typeof params === "object" && (params as Record<string, unknown>).typeName === "User";
      if (!decision.allowed) {
        error?.(new CapabilityDeniedError(decision));
        return;
      }
      if (!isGetUser) {
        error?.(new CapabilityDeniedError(deniedUnknownCall(method)));
        return;
      }
      if (!raw || typeof raw.call !== "function") {
        error?.(new Error("GEOTAB_API_NOT_AVAILABLE: MyGeotab API is not available."));
        return;
      }
      try {
        raw.call(method, params, success, error);
      } catch (e) {
        error?.(e);
      }
    },
    getSession(callback) {
      if (!decision.allowed || !raw || typeof raw.getSession !== "function") {
        callback(null);
        return;
      }
      try {
        raw.getSession(callback);
      } catch {
        callback(null);
      }
    },
  };
}
