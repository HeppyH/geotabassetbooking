/*───────────────────── Runtime access policy (pure helpers for the UI) ─────────────────────
 * The UI asks these helpers; it never evaluates gates itself and never enables anything.
 * Simulation runtime: local fixtures only, always allowed to act on demo data.
 * Native runtime: requires a verified principal AND the access view computed in
 * nativeRuntime.ts (gate × tenant × identity).
 */
import type { AppRuntime } from "./appRuntime.ts";

export type AccessAction = "read" | "write" | "approve";

export function canWriteInRuntime(runtime: AppRuntime): boolean {
  if (runtime.kind === "simulation") return true;
  return runtime.identity.status === "authenticated" && runtime.access.write.allowed;
}

export function canApproveInRuntime(runtime: AppRuntime): boolean {
  if (runtime.kind === "simulation") return true;
  return runtime.identity.status === "authenticated" && runtime.access.approve.allowed;
}

/** Human-readable reason an action is blocked, or null when allowed. */
export function blockedReasonForRuntime(runtime: AppRuntime, action: AccessAction): string | null {
  if (runtime.kind === "simulation") return null;
  const { identity, access } = runtime;
  if (identity.status === "loading") return "Resolving authenticated MyGeotab identity…";
  if (identity.status !== "authenticated") return identity.reason || "Authenticated MyGeotab identity could not be verified.";
  const view = access[action];
  return view.allowed ? null : (view.reason || "Denied by capability gate.");
}
