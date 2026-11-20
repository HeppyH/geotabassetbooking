/*───────────────────── Offline Simulation Runtime ─────────────────────
 * Phase B. The ONLY place that wires the local demo provider (in-memory fixtures +
 * localStorage). It is reachable only from simulationMain.tsx (simulation.html).
 *
 * Isolation rules (enforced by test/runtimeArchitecture.test.mjs and test/simulationIsolation.test.mjs):
 *  - never imports runtime/native*, runtime/gatedApi, data/addinDataProvider or auth/identityResolver
 *  - never imports config/lifecycleBridge and never reads window.geotab / self.geotab
 *  - never receives a MyGeotab api object
 *  - never switches itself to the native runtime
 *  - never talks to the legacy backend (no HTTP client)
 * Simulation data is fixtures only; it is not evidence of MyGeotab behaviour.
 */
import { bookingDataProvider } from "../data/dataProvider.ts";
import type { AppRuntime } from "../runtime/appRuntime.ts";

export function createSimulationRuntime(): Extract<AppRuntime, { kind: "simulation" }> {
  return { kind: "simulation", provider: bookingDataProvider };
}
