import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase B: the offline simulation (simulation.html) is a development-only entry. It is served
// by the dev server automatically, but the default production build emits ONLY index.html
// (the native MyGeotab entry). Building the simulation page requires an explicit opt-in.
const includeSimulation = process.env.OPEX_INCLUDE_SIMULATION === "1";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: includeSimulation
        ? { index: "index.html", simulation: "simulation.html" }
        : { index: "index.html" },
    },
  },
  define: {
    __DIAGNOSTICS_ENABLED__: false,
  },
});
