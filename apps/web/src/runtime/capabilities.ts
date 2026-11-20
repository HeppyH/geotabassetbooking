/*───────────────────── Centralized Runtime Capability Gate ─────────────────────
 * Phase B. Single source of truth for which live MyGeotab capabilities may run.
 *
 * Design rules (see docs/mygeotab-native/phase-b/capability-gate-design.md):
 *  - Every live capability defaults to false.
 *  - Missing, malformed or non-boolean configuration is treated as false (fail closed).
 *    Only the boolean literal `true` enables a capability.
 *  - The production gate is built from a frozen compile-time constant. It is never read
 *    from environment variables, localStorage, URL parameters, UI state, user roles or
 *    MyGeotab data, so none of those can enable a capability.
 *  - A capability is allowed only when its own flag AND all of its prerequisites are true
 *    AND the tenant context has been approved by tenantContext.ts.
 *  - This module has NO imports so it can be bundled into any entry point.
 *
 * Enabling a capability is a deliberate, separately authorized code change. Tests inject
 * mock configurations through createCapabilityGate(); production code never does.
 */

export const CAPABILITY_NAMES = [
  "MYGEOTAB_IDENTITY_ENABLED",
  "MYGEOTAB_STORAGE_ENABLED",
  "LIVE_BOOKING_READ_ENABLED",
  "LIVE_BOOKING_WRITE_ENABLED",
  "APPROVAL_ACTIONS_ENABLED",
  "ADMIN_CONFIGURATION_ENABLED",
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export type CapabilityConfig = Readonly<Record<CapabilityName, boolean>>;

/** Prerequisites: a capability is never allowed unless every prerequisite is also enabled. */
export const CAPABILITY_PREREQUISITES: Readonly<Record<CapabilityName, readonly CapabilityName[]>> = Object.freeze({
  MYGEOTAB_IDENTITY_ENABLED: Object.freeze([]) as readonly CapabilityName[],
  MYGEOTAB_STORAGE_ENABLED: Object.freeze(["MYGEOTAB_IDENTITY_ENABLED"]) as readonly CapabilityName[],
  LIVE_BOOKING_READ_ENABLED: Object.freeze(["MYGEOTAB_STORAGE_ENABLED"]) as readonly CapabilityName[],
  LIVE_BOOKING_WRITE_ENABLED: Object.freeze(["MYGEOTAB_STORAGE_ENABLED", "LIVE_BOOKING_READ_ENABLED"]) as readonly CapabilityName[],
  APPROVAL_ACTIONS_ENABLED: Object.freeze(["MYGEOTAB_STORAGE_ENABLED", "LIVE_BOOKING_READ_ENABLED", "LIVE_BOOKING_WRITE_ENABLED"]) as readonly CapabilityName[],
  ADMIN_CONFIGURATION_ENABLED: Object.freeze(["MYGEOTAB_IDENTITY_ENABLED", "MYGEOTAB_STORAGE_ENABLED"]) as readonly CapabilityName[],
});

/** Default configuration: every live capability is disabled. */
export const DEFAULT_CAPABILITIES: CapabilityConfig = Object.freeze({
  MYGEOTAB_IDENTITY_ENABLED: false,
  MYGEOTAB_STORAGE_ENABLED: false,
  LIVE_BOOKING_READ_ENABLED: false,
  LIVE_BOOKING_WRITE_ENABLED: false,
  APPROVAL_ACTIONS_ENABLED: false,
  ADMIN_CONFIGURATION_ENABLED: false,
});

/**
 * Configuration used by the production runtime. Deliberately a frozen constant equal to the
 * defaults. Changing it is a separately authorized change, not a runtime setting.
 */
export const PRODUCTION_CAPABILITY_CONFIG: CapabilityConfig = DEFAULT_CAPABILITIES;

export type CapabilityDenialCode =
  | "CAPABILITY_UNKNOWN"
  | "CAPABILITY_DISABLED"
  | "CAPABILITY_PREREQUISITE_DISABLED"
  | "TENANT_NOT_APPROVED";

export type CapabilityDecision =
  | { allowed: true; capability: CapabilityName; reason: null }
  | { allowed: false; capability: string; code: CapabilityDenialCode; reason: string };

export type CapabilityConfigIssue = "CONFIG_MISSING" | "CONFIG_NOT_OBJECT" | "UNKNOWN_KEY" | "NON_BOOLEAN_VALUE";

export interface CapabilityGate {
  /** Normalized, frozen copy of the effective configuration. */
  snapshot(): CapabilityConfig;
  /** Problems found while normalizing the input (informational; always fail closed). */
  readonly issues: readonly { issue: CapabilityConfigIssue; key?: string }[];
  /** True only if the flag and all prerequisites are enabled. Does not consider the tenant. */
  isFlagEnabled(name: string): boolean;
  /** Full decision including tenant approval. `tenantApproved` must come from tenantContext.ts. */
  evaluate(name: string, tenantApproved: boolean): CapabilityDecision;
}

export class CapabilityDeniedError extends Error {
  readonly code: CapabilityDenialCode;
  readonly capability: string;
  constructor(decision: Extract<CapabilityDecision, { allowed: false }>) {
    super(`${decision.capability} denied: ${decision.reason}`);
    this.name = "CapabilityDeniedError";
    this.code = decision.code;
    this.capability = decision.capability;
  }
}

function isKnownCapability(name: unknown): name is CapabilityName {
  return typeof name === "string" && (CAPABILITY_NAMES as readonly string[]).includes(name);
}

/**
 * Build a gate from arbitrary input. Anything other than an object whose known keys are the
 * boolean literal `true` results in `false` for that capability.
 */
export function createCapabilityGate(input?: unknown): CapabilityGate {
  const issues: { issue: CapabilityConfigIssue; key?: string }[] = [];
  const effective: Record<CapabilityName, boolean> = { ...DEFAULT_CAPABILITIES };

  if (input === undefined || input === null) {
    issues.push({ issue: "CONFIG_MISSING" });
  } else if (typeof input !== "object" || Array.isArray(input)) {
    issues.push({ issue: "CONFIG_NOT_OBJECT" });
  } else {
    const source = input as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      if (!isKnownCapability(key)) {
        issues.push({ issue: "UNKNOWN_KEY", key });
        continue;
      }
      const value = Object.getOwnPropertyDescriptor(source, key)?.value;
      if (value === true) {
        effective[key] = true;
      } else if (value !== false) {
        issues.push({ issue: "NON_BOOLEAN_VALUE", key });
      }
    }
  }

  const frozen: CapabilityConfig = Object.freeze({ ...effective });

  function flagDecision(name: string): CapabilityDecision {
    if (!isKnownCapability(name)) {
      return { allowed: false, capability: String(name), code: "CAPABILITY_UNKNOWN", reason: "Unknown capability." };
    }
    if (frozen[name] !== true) {
      return { allowed: false, capability: name, code: "CAPABILITY_DISABLED", reason: `${name} is disabled.` };
    }
    for (const prerequisite of CAPABILITY_PREREQUISITES[name]) {
      if (frozen[prerequisite] !== true) {
        return {
          allowed: false,
          capability: name,
          code: "CAPABILITY_PREREQUISITE_DISABLED",
          reason: `${name} requires ${prerequisite}, which is disabled.`,
        };
      }
    }
    return { allowed: true, capability: name, reason: null };
  }

  return {
    snapshot: () => frozen,
    issues: Object.freeze(issues.slice()),
    isFlagEnabled: (name) => flagDecision(name).allowed,
    evaluate(name, tenantApproved) {
      const decision = flagDecision(name);
      if (!decision.allowed) return decision;
      if (tenantApproved !== true) {
        return {
          allowed: false,
          capability: decision.capability,
          code: "TENANT_NOT_APPROVED",
          reason: "Tenant context has not been approved.",
        };
      }
      return decision;
    },
  };
}

let productionGate: CapabilityGate | null = null;

/** The only gate production code may use. Built from the frozen production constant. */
export function getProductionCapabilityGate(): CapabilityGate {
  if (!productionGate) productionGate = createCapabilityGate(PRODUCTION_CAPABILITY_CONFIG);
  return productionGate;
}
