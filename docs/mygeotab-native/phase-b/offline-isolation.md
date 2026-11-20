# Offline Simulation Isolation

- Separate entry (`simulationMain.tsx`, `simulation.html`) and separate wiring (`simulation/simulationRuntime.ts`, the only module that connects the local demo provider).
- The simulation graph contains no `runtime/native*`, `gatedApi`, `NativeHost`, `addinDataProvider`, `lifecycleBridge`, `serviceAddin` or `main.tsx`, and no `window.geotab`, `fetch`, `XMLHttpRequest`, `WebSocket` or AddInData calls (static test).
- The native graph excludes `simulation/`, `data/dataProvider`, `data/mockMyGeotab`, `data/mygeotabProvider`, and uses no browser storage (static test). Exception: `serviceAddin.ts` uses Geotab's `service.localStorage`.
- Default build check: `dist` contains only `index.html` plus assets; no `opex-vbm-demo-*` keys, no "LIVE (MyGeotab AddInData)" string, no `workers.dev`/`8787`. With `OPEX_INCLUDE_SIMULATION=1` the demo keys appear only in the simulation chunk.
- The shared notification engine no longer touches `window.geotab`.
- The UI shows a status badge ("MyGeotab native" / "Offline simulation") and no mode switch.
