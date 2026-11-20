/* Pure actor-id selection. No MyGeotab API access; safe for both the native and the
   simulation module graphs. Re-exported from identityResolver for existing callers. */
import type { AppMode, IdentityResolutionState } from "./identityResolver.ts";

/**
 * Actor identity for booking/approval operations (this phase: make available; audit persistence documented separately).
 * - LIVE (ADDIN_DATA): verified MyGeotab principal id only.
 * - DEMO: explicit demo actor id (never used when mode is LIVE).
 */
export function getActorIdForMode(
  mode: AppMode,
  identity: IdentityResolutionState | null | undefined,
  demoActorId: string | null | undefined,
): string | null {
  if (mode === "ADDIN_DATA") {
    return identity && identity.status === "authenticated" ? identity.principal.id : null;
  }
  return demoActorId && demoActorId.trim() ? demoActorId : null;
}
