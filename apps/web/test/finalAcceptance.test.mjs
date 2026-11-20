/* Phase I — acceptance checks that tie the master-prompt security/architecture list (I.2/I.3) to
   runtime behaviour. MOCK api only. This is NOT tenant validation and NOT a production-readiness claim. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeRuntime } from "../src/runtime/nativeRuntime.ts";
import { createCapabilityGate, PRODUCTION_CAPABILITY_CONFIG } from "../src/runtime/capabilities.ts";
import { APPROVED_TENANT_CONTEXTS } from "../src/runtime/tenantContext.ts";
import { createSimulationRuntime } from "../src/simulation/simulationRuntime.ts";
import { evaluateTransition } from "../src/booking/stateMachine.ts";
import { decodeDetails } from "../src/storage/recordEnvelope.ts";
import { createMockApi, ALL_TRUE, MOCK_ALLOWLIST, roleMap } from "./helpers/mockGeotab.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const everyGate = () => createCapabilityGate(ALL_TRUE);
const opts = (api, extra = {}) => ({ api, gate: everyGate(), allowlist: MOCK_ALLOWLIST, roleMapping: roleMap("administrator"), ...extra });

test("no default live activation: production config false, allowlist empty, runtime blocked with zero calls", async () => {
  assert.ok(Object.values(PRODUCTION_CAPABILITY_CONFIG).every((v) => v === false));
  assert.equal(APPROVED_TENANT_CONTEXTS.length, 0);
  const api = createMockApi();
  const rt = await createNativeRuntime({ api });
  assert.equal(api.calls.length + api.sessionCalls, 0);
  assert.ok(!rt.access.read.allowed && !rt.access.write.allowed && !rt.access.approve.allowed);
});

test("missing identity is denied even with every gate on (mock)", async () => {
  for (const mock of [{ session: null }, { session: { database: "mock_tenant_a" } }, { users: [] }, { users: [{ id: "1", name: "a" }, { id: "2", name: "a" }] }]) {
    const rt = await createNativeRuntime(opts(createMockApi(mock)));
    assert.equal(rt.access.read.allowed, false, JSON.stringify(mock));
    await assert.rejects(rt.provider.getBookings());
  }
});

test("unknown tenant denied; unauthorized roles denied; self-approval denied", async () => {
  const unknown = await createNativeRuntime(opts(createMockApi({ session: { userName: "tester@example.test", database: "other" } })));
  assert.equal(unknown.access.read.allowed, false);
  const requester = await createNativeRuntime(opts(createMockApi(), { roleMapping: roleMap("requester") }));
  assert.equal(requester.access.approve.allowed, false);
  assert.equal(evaluateTransition({ from: "PENDING_APPROVAL", to: "APPROVED", requesterId: "b1", actorId: "b1", role: "administrator" }).ok, false);
});

test("malformed and oversized records are rejected", () => {
  assert.equal(decodeDetails("{bad").ok, false);
  assert.equal(decodeDetails({ schemaVersion: 1 }).ok, false);
  assert.equal(decodeDetails({ schemaVersion: 1, recordType: "booking", recordId: "bkg_1", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "u", payload: { x: "y".repeat(10001) } }).code, "OVERSIZED");
});

test("offline simulation cannot invoke live providers; its provider is not live", () => {
  const sim = createSimulationRuntime();
  assert.equal(sim.kind, "simulation");
  assert.equal(sim.provider.isLive(), false);
});

test("native failure cannot fall back to localStorage", async () => {
  const touched = [];
  const prev = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new Proxy({}, { get(_t, p) { touched.push(String(p)); return () => null; } }) });
  try {
    const rt = await createNativeRuntime(opts(createMockApi({ failCalls: true })));
    await assert.rejects(rt.provider.getBookings());
    assert.deepEqual(touched, []);
  } finally { prev ? Object.defineProperty(globalThis, "localStorage", prev) : delete globalThis.localStorage; }
});

test("no PostgreSQL / Hono / Cloudflare / external-DB runtime dependency in the web package", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
  for (const name of Object.keys(all)) assert.equal(/^(hono|@hono\/|pg|postgres|mysql2?|mongodb|mongoose|@supabase\/|@neondatabase\/|drizzle|wrangler|@cloudflare\/|firebase|axios)/.test(name), false, name);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["react", "react-dom"]);
});

test("built bundle (when present) has no demo keys, backend hosts, or legacy hooks", () => {
  const dist = path.join(root, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) return; // build not run in this invocation
  assert.equal(fs.existsSync(path.join(dist, "simulation.html")), false);
  const assets = path.join(dist, "assets");
  for (const f of fs.readdirSync(assets).filter((x) => x.endsWith(".js"))) {
    const t = fs.readFileSync(path.join(assets, f), "utf8");
    for (const bad of ["opex-vbm-demo", "workers.dev", ":8787", "VITE_API_BASE_URL", "LIVE (MyGeotab AddInData)"]) assert.equal(t.includes(bad), false, `${f} contains ${bad}`);
  }
});
