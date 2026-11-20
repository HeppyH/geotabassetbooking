/*───────────────────── App runtime contract (types only) ─────────────────────
 * The UI component receives exactly one runtime object. It never chooses, switches or
 * constructs a provider itself, and holds no MyGeotab API object.
 */
import type { BookingDataProvider, NotificationDataProvider } from "../data/types";
import type { IdentityResolutionState } from "../auth/identityResolver";
import type { OpexRole } from "../authz/roles";

export type RuntimeProvider = BookingDataProvider & NotificationDataProvider;

export interface AccessView {
  allowed: boolean;
  reason: string | null;
}

export interface RuntimeAccess {
  read: AccessView;
  write: AccessView;
  approve: AccessView;
}

export type AppRuntime =
  | {
      kind: "simulation";
      /** Local in-memory/demo provider. Never touches MyGeotab. */
      provider: RuntimeProvider;
    }
  | {
      kind: "native";
      /** Capability-gated native provider. */
      provider: RuntimeProvider;
      identity: IdentityResolutionState;
      tenantLabel: string;
      access: RuntimeAccess;
      /** OPEX role from the administrator-controlled mapping; null = none (everything denied). */
      role: OpexRole | null;
      roleReason: string | null;
    };
