/* Phase B — offline simulation isolation (MOCK; not tenant validation). */
import test from "node:test";
import assert from "node:assert/strict";
import { createSimulationRuntime } from "../src/simulation/simulationRuntime.ts";
import { getProductionCapabilityGate } from "../src/runtime/capabilities.ts";

function installGeotabTrap() {
  const touched = [];
  const trap = new Proxy({}, { get(_t, p) { touched.push(String(p)); return () => { throw new Error("native api used by simulation"); }; } });
  const saved = {};
  for (const k of ["window", "self"]) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const fake = new Proxy({ localStorage: undefined }, {
    get(t, p) { if (p === "geotab") { touched.push("geotab"); return trap; } return t[p]; },
  });
  Object.defineProperty(globalThis, "window", { value: fake, configurable: true, writable: true });
  Object.defineProperty(globalThis, "self", { value: fake, configurable: true, writable: true });
  Object.defineProperty(globalThis, "geotab", { get() { touched.push("geotab"); return trap; }, configurable: true });
  return {
    touched,
    restore() {
      for (const k of ["window", "self"]) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
      delete globalThis.geotab;
    },
  };
}

test("simulation runtime is kind=simulation and never exposes native identity/access", () => {
  const rt = createSimulationRuntime();
  assert.equal(rt.kind, "simulation");
  assert.equal("access" in rt, false);
  assert.equal(rt.provider.isLive(), false);
});

test("offline simulation cannot invoke native providers or the MyGeotab api", async () => {
  const trap = installGeotabTrap();
  try {
    const rt = createSimulationRuntime();
    await rt.provider.getAssets();
    await rt.provider.getUsers();
    await rt.provider.getBookings();
    await rt.provider.getApprovers();
    assert.deepEqual(trap.touched, []);
  } finally {
    trap.restore();
  }
});

test("enabling nothing in the simulation changes the production gate", () => {
  createSimulationRuntime();
  const gate = getProductionCapabilityGate();
  for (const n of Object.keys(gate.snapshot())) assert.equal(gate.isFlagEnabled(n), false, n);
});
