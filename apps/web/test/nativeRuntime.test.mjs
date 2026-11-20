/* Phase B — native runtime composition tests. ALL USE MOCKS (isolated fake `api`).
   They prove gating/composition logic only. They are NOT tenant validation. */
import test from "node:test";
import assert from "node:assert/strict";
import { createNativeRuntime } from "../src/runtime/nativeRuntime.ts";
import { createCapabilityGate, DEFAULT_CAPABILITIES } from "../src/runtime/capabilities.ts";
import { createGatedApi } from "../src/runtime/gatedApi.ts";
import { createNativeProvider } from "../src/runtime/nativeProvider.ts";
import { createMockApi, ALL_TRUE, MOCK_ALLOWLIST, roleMap, VALID_DATABASE, installStorageSpy, rejectsWithCode } from "./helpers/mockGeotab.mjs";

const gateWith = (overrides) => createCapabilityGate({ ...DEFAULT_CAPABILITIES, ...overrides });
const ID = { MYGEOTAB_IDENTITY_ENABLED: true };
const STORE = { ...ID, MYGEOTAB_STORAGE_ENABLED: true };
const READ = { ...STORE, LIVE_BOOKING_READ_ENABLED: true };
const WRITE = { ...READ, LIVE_BOOKING_WRITE_ENABLED: true };

test("no api object: blocked, provider rejects", async () => {
  const rt = await createNativeRuntime({ api: null });
  assert.equal(rt.kind, "native");
  assert.equal(rt.access.read.allowed, false);
  await rejectsWithCode(rt.provider.getBookings());
});

test("production defaults: zero API calls of any kind, every operation denied", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api });
  assert.equal(api.calls.length, 0);
  assert.equal(api.sessionCalls, 0);
  assert.equal(rt.access.read.allowed, false);
  assert.equal(rt.access.write.allowed, false);
  assert.equal(rt.access.approve.allowed, false);
  await rejectsWithCode(rt.provider.getBookings());
  await rejectsWithCode(rt.provider.createBooking({}));
  assert.equal(api.calls.length, 0);
});

test("missing capability config denies and makes no API call", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: createCapabilityGate(undefined), allowlist: MOCK_ALLOWLIST });
  assert.equal(api.calls.length + api.sessionCalls, 0);
  assert.equal(rt.access.read.allowed, false);
});

test("identity enabled + empty production allowlist: only getSession, no data call", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE) });
  assert.equal(api.calls.length, 0);
  assert.equal(rt.access.read.allowed, false);
  await rejectsWithCode(rt.provider.getBookings());
  assert.equal(api.calls.length, 0);
});

test("invalid tenant context denied (no data call)", async () => {
  for (const session of [null, {}, { database: "" }, { database: "bad name!" }]) {
    const api = createMockApi({ session });
    const rt = await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST });
    assert.equal(api.calls.length, 0, JSON.stringify(session));
    assert.equal(rt.access.read.allowed, false);
    await rejectsWithCode(rt.provider.getBookings());
  }
});

test("unknown tenant denied (no data call)", async () => {
  const api = createMockApi({ session: { userName: "u@e.test", database: "unknown_db" } });
  const rt = await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST });
  assert.equal(api.calls.length, 0);
  assert.equal(rt.access.read.allowed, false);
});

test("approved tenant + identity only: identity resolves, data access still denied", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: gateWith(ID), allowlist: MOCK_ALLOWLIST });
  assert.deepEqual(api.calls.map((c) => `${c.method}:${c.typeName}`), ["Get:User"]);
  assert.equal(rt.identity.status, "authenticated");
  assert.equal(rt.access.read.allowed, false);
  await rejectsWithCode(rt.provider.getBookings());
  await rejectsWithCode(rt.provider.createBooking({}));
  assert.deepEqual(api.calls.map((c) => c.typeName), ["User"]);
});

test("disabled capabilities prevent API calls: storage/read/write/approval matrix", async () => {
  const cases = [
    ["storage off", ID, ["getBookings"], "CAPABILITY_PREREQUISITE_DISABLED"],
    ["read off", STORE, ["getBookings"], "CAPABILITY_DISABLED"],
    ["write off", READ, ["createBooking", "createNotification", "markAsRead", "createAuditRecord"], "CAPABILITY_DISABLED"],
  ];
  for (const [label, flags, methods] of cases) {
    const api = createMockApi();
    const rt = await createNativeRuntime({ api, gate: gateWith(flags), allowlist: MOCK_ALLOWLIST });
    const before = api.calls.length;
    for (const m of methods) {
      await rejectsWithCode(rt.provider[m]({ id: "x" }, "n"));
    }
    assert.equal(api.calls.length, before, label);
  }
});

test("read enabled: reads reach AddInData Get; writes still denied", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: gateWith(READ), allowlist: MOCK_ALLOWLIST, roleMapping: roleMap("administrator") });
  assert.equal(rt.access.read.allowed, true);
  assert.equal(rt.access.write.allowed, false);
  await rt.provider.getBookings();
  assert.ok(api.calls.some((c) => c.method === "Get" && c.typeName === "AddInData"));
  const n = api.calls.length;
  await rejectsWithCode(rt.provider.createBooking({}));
  assert.equal(api.calls.length, n);
});

test("approval statuses need APPROVAL_ACTIONS_ENABLED even when write is enabled", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: gateWith(WRITE), allowlist: MOCK_ALLOWLIST, roleMapping: roleMap("administrator") });
  assert.equal(rt.access.write.allowed, true);
  assert.equal(rt.access.approve.allowed, false);
  const n = api.calls.length;
  for (const s of ["APPROVED", "REJECTED", "ASSIGNED"]) {
    await rejectsWithCode(rt.provider.updateBookingStatus("b1", s, "u1"));
  }
  assert.equal(api.calls.length, n);
});

test("deleteBooking and resetDemoData are always rejected, even fully enabled", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST });
  const n = api.calls.length;
  await rejectsWithCode(rt.provider.deleteBooking("b1"));
  await rejectsWithCode(rt.provider.resetDemoData());
  assert.equal(api.calls.length, n);
});

test("fully enabled mock: access views allowed", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST, roleMapping: roleMap("administrator") });
  assert.equal(rt.access.read.allowed, true);
  assert.equal(rt.access.write.allowed, true);
  assert.equal(rt.access.approve.allowed, true);
  assert.equal(rt.tenantLabel, VALID_DATABASE);
});

test("invalid AddInId denied before any AddInData call", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST, addInId: "not valid" });
  const n = api.calls.length;
  await rejectsWithCode(rt.provider.getBookings());
  assert.equal(api.calls.length, n);
});

test("session database differing from validated tenant is denied", async () => {
  const api = createMockApi({
    sessions: [
      { userName: "tester@example.test", database: VALID_DATABASE },
      { userName: "tester@example.test", database: "other_db" },
    ],
  });
  const rt = await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST });
  assert.equal(rt.access.read.allowed, false);
  await rejectsWithCode(rt.provider.getBookings());
});

test("gated api denies unknown methods and type names without touching raw api", async () => {
  const raw = createMockApi();
  const ctx = { gate: createCapabilityGate(ALL_TRUE), tenantApproved: true };
  const api = createGatedApi(raw, ctx);
  const attempts = [
    ["Get", { typeName: "DeviceStatusInfo" }],
    ["Remove", { typeName: "Device", entity: {} }],
    ["Add", { typeName: "User", entity: {} }],
    ["Set", { typeName: "Group", entity: {} }],
    ["GetFeed", { typeName: "LogRecord" }],
    ["Authenticate", {}],
  ];
  for (const [m, p] of attempts) {
    const err = await new Promise((resolve) => api.call(m, p, () => resolve(null), (e) => resolve(e)));
    assert.ok(err, `${m} ${p.typeName} must be denied`);
  }
  assert.equal(raw.calls.length, 0);
});

test("gated api denies even allowed calls when capability disabled", async () => {
  const raw = createMockApi();
  const api = createGatedApi(raw, { gate: gateWith(ID), tenantApproved: true });
  const err = await new Promise((resolve) => api.call("Get", { typeName: "AddInData" }, () => resolve(null), (e) => resolve(e)));
  assert.ok(err);
  assert.equal(raw.calls.length, 0);
});

test("native failures never touch localStorage and never return fallback data", async () => {
  const spy = installStorageSpy();
  try {
    const failing = createMockApi({ failCalls: true });
    const rt = await createNativeRuntime({ api: failing, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST });
    assert.notEqual(rt.access.read.allowed && rt.identity.status === "authenticated", true);
    await assert.rejects(rt.provider.getBookings());
    await assert.rejects(rt.provider.getAssets());
    // direct provider with working identity but failing storage
    const provider = createNativeProvider({
      api: failing,
      addInId: "aXVrP3m2x0iA9n5s1Zq7Wb8",
      ctx: { gate: createCapabilityGate(ALL_TRUE), tenantApproved: true },
      identityAuthenticated: true,
      roleAllows: { write: true, approve: true },
      actor: { id: "b1", role: "administrator" },
    });
    await assert.rejects(provider.getBookings());
    await assert.rejects(provider.createBooking({}));
    assert.deepEqual(spy.accessed, []);
  } finally {
    spy.restore();
  }
});

test("blocked native runtime never touches localStorage", async () => {
  const spy = installStorageSpy();
  try {
    const rt = await createNativeRuntime({ api: createMockApi() });
    await assert.rejects(rt.provider.getBookings());
    assert.deepEqual(spy.accessed, []);
  } finally {
    spy.restore();
  }
});
