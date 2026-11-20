/*───────────────────── Offline Simulation entry (development only) ─────────────────────
 * Served at /simulation.html by the Vite dev server. It is NOT part of the default
 * production build (see vite.config.ts: set OPEX_INCLUDE_SIMULATION=1 to build it).
 *
 * Deliberately does NOT register geotab.addin.*, does NOT import the lifecycle bridge,
 * the Service Add-In, or any native runtime module.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";
import { createSimulationRuntime } from "./simulation/simulationRuntime";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("OPEX_VBM_ROOT_NOT_FOUND");
createRoot(rootElement).render(
  <React.StrictMode>
    <App runtime={createSimulationRuntime()} />
  </React.StrictMode>,
);
