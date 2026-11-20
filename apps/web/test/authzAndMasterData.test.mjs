/* Phase D — roles, authorization policy, vehicle/driver master data, identity.
   MOCK inputs only; not tenant validation. Client-side policy is NOT server-enforced security. */
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, BOOTSTRAP_ADMINISTRATOR_IDS, OPEX_ROLES, ROLE_ACTIONS, can, loadRoleMapping, parseRoleMapping, resolveRole } from "../src/authz/roles.ts";
import { mapDevice, mapDevices, isBookable, isWithinActiveWindow } from "../src/masterdata/vehicles.ts";
import { mapDriver, mapDrivers, validateDriverReference, deriveAssignedDriver } from "../src/masterdata/drivers.ts";
import { resolveAuthenticatedPrincipal } from "../src/auth/identityResolver.ts";
import { createNativeRuntime } from "../src/runtime/nativeRuntime.ts";
import { createCapabilityGate } from "../src/runtime/capabilities.ts";
import { createAddInDataStore } from "../src/storage/addinDataStore.ts";
import { encodeEnvelope } from "../src/storage/recordEnvelope.ts";
import { DEFAULT_ADDIN_ID } from "../src/config/addinId.ts";
import { createMockApi, ALL_TRUE, MOCK_ALLOWLIST, roleMap } from "./helpers/mockGeotab.mjs";

const AT = Date.parse("2026-06-01T00:00:00Z");
const mapping = (entries) => ({ updatedBy: "adm", entries });

test("roles: exactly requester/approver/administrator; bootstrap list is empty", () => {
  assert.deepEqual([...OPEX_ROLES], ["requester", "approver", "administrator"]);
  assert.equal(BOOTSTRAP_ADMINISTRATOR_IDS.length, 0);
  assert.ok(Object.isFrozen(BOOTSTRAP_ADMINISTRATOR_IDS));
});

test("role mapping parsing is strict and fails closed", () => {
  const good = { kind: "role_mapping", updatedBy: "a", entries: [{ userId: "u1", role: "approver" }] };
  assert.equal(parseRoleMapping(good).ok, true);
  const bad = [null, [], "x", {}, { ...good, kind: "x" }, { ...good, updatedBy: "" }, { ...good, entries: "no" },
    { ...good, entries: [{ userId: "u1", role: "root" }] }, { ...good, entries: [{ userId: "", role: "approver" }] },
    { ...good, entries: [{ userId: "u1", role: "approver" }, { userId: "u1", role: "requester" }] },
    { ...good, entries: Array.from({ length: 101 }, (_, i) => ({ userId: `u${i}`, role: "requester" })) }];
  for (const b of bad) assert.equal(parseRoleMapping(b).ok, false, JSON.stringify(b)?.slice(0, 60));
});

test("role resolution: missing mapping, unmapped user and bad ids are denied", () => {
  const m = mapping([{ userId: "u1", role: "approver" }]);
  assert.deepEqual(resolveRole("u1", m), { ok: true, role: "approver", source: "mapping" });
  for (const r of [resolveRole("u2", m), resolveRole("u1", null), resolveRole("", m), resolveRole(undefined, m), resolveRole(5, m)]) {
    assert.equal(r.ok, false); assert.equal(r.role, null);
  }
  assert.equal(resolveRole("boot", null, ["boot"]).role, "administrator");
  assert.equal(resolveRole("boot", m, ["boot"]).ok, false, "bootstrap applies only while no mapping exists");
});

test("a User.role value never grants an OPEX role", async () => {
  const api = createMockApi({ users: [{ id: "b1", name: "tester@example.test", role: "APPROVER" }] });
  const state = await resolveAuthenticatedPrincipal(api);
  assert.equal(state.status, "authenticated");
  assert.equal(resolveRole(state.principal.id, null).ok, false);
});

test("permission matrix by role", () => {
  const ctx = { actorId: "u1", requesterId: "u1" };
  for (const a of ROLE_ACTIONS.requester) assert.equal(can("requester", a, ctx).allowed, true, a);
  for (const a of ["booking.view_all", "booking.approve", "booking.reject", "booking.cancel_any", "admin.configure", "audit.view"]) {
    assert.equal(can("requester", a, { actorId: "u1", requesterId: "u2" }).allowed, false, a);
  }
  assert.equal(can("approver", "booking.approve", { actorId: "u1", requesterId: "u2" }).allowed, true);
  assert.equal(can("approver", "admin.configure", { actorId: "u1" }).allowed, false);
  assert.equal(can("approver", "audit.view", { actorId: "u1" }).allowed, false);
  for (const a of ACTIONS) if (!a.endsWith("_own") && !["booking.approve", "booking.reject"].includes(a)) assert.equal(can("administrator", a, { actorId: "u1" }).allowed, true, a);
});

test("self-approval is prohibited for every role, including administrator", () => {
  for (const role of OPEX_ROLES) for (const a of ["booking.approve", "booking.reject"]) {
    assert.equal(can(role, a, { actorId: "u1", requesterId: "u1" }).allowed, false, `${role} ${a}`);
  }
  assert.equal(can("administrator", "booking.approve", { actorId: "u1", requesterId: "u2" }).allowed, true);
  assert.equal(can("approver", "booking.approve", { actorId: "u1" }).allowed, false, "unknown owner denied");
});

test("own-record actions require ownership; unknown roles/actions/actors denied", () => {
  assert.equal(can("requester", "booking.edit_own", { actorId: "u1", requesterId: "u2" }).allowed, false);
  assert.equal(can("requester", "booking.cancel_own", { actorId: "u1" }).allowed, false);
  assert.equal(can("requester", "notification.view_own", { actorId: "u1", requesterId: "u2" }).allowed, false, "cross-user notification denied");
  assert.equal(can("requester", "notification.view_own", { actorId: "u1", requesterId: "u1" }).allowed, true);
  assert.equal(can(null, "booking.create", { actorId: "u1" }).allowed, false);
  assert.equal(can("root", "booking.create", { actorId: "u1" }).allowed, false);
  assert.equal(can("administrator", "nope", { actorId: "u1" }).allowed, false);
  assert.equal(can("administrator", "audit.view", { actorId: "" }).allowed, false);
  assert.equal(can("administrator", "audit.view", {}).allowed, false);
});

test("loadRoleMapping: missing, ambiguous, invalid and valid", async () => {
  const mk = (rows) => {
    const api = createMockApi({ addInData: rows });
    return createAddInDataStore({ api, addInId: DEFAULT_ADDIN_ID, sleep: async () => {} });
  };
  const rec = (payload, id = "cfg_role_mapping", server = "s1") => ({
    id: server, addInId: DEFAULT_ADDIN_ID,
    details: encodeEnvelope({ schemaVersion: 1, recordType: "application_config", recordId: id, createdAt: "2026-01-01T00:00:00.000Z", createdBy: "adm", payload }),
  });
  const ok = { kind: "role_mapping", updatedBy: "adm", entries: [{ userId: "u1", role: "approver" }] };
  assert.equal((await loadRoleMapping(mk([]))).mapping, null);
  assert.equal((await loadRoleMapping(mk([rec({ ...ok, entries: [{ userId: "u1", role: "x" }] })]))).mapping, null);
  assert.equal((await loadRoleMapping(mk([rec(ok), rec(ok, "cfg_role_mapping", "s2")]))).mapping, null, "duplicate mapping records are ambiguous -> no mapping (fail closed)");
  assert.equal((await loadRoleMapping(mk([rec(ok)]))).mapping.entries[0].role, "approver");
  const failing = { list: async () => { throw new Error("boom"); } };
  assert.equal((await loadRoleMapping(failing)).mapping, null);
});

test("vehicles: only documented Device fields are mapped; undocumented fields are ignored", () => {
  const r = mapDevice({ id: "b9", name: "Truck 1", comment: "c", serialNumber: "G9ABC", groups: [{ id: "g1" }, { x: 1 }],
    licensePlate: "B 1234", vehicleIdentificationNumber: "VIN", make: "Toyota", model: "X", vehicleClass: "4x4", status: "AVAILABLE" }, AT);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.vehicle).sort(), ["active", "comment", "deviceId", "groupIds", "name", "serialNumber", "timeZoneId"]);
  assert.deepEqual(r.vehicle.groupIds, ["g1"]);
  for (const bad of [null, {}, { id: "x" }, { id: "x", name: "n".repeat(51) }, { name: "n" }]) assert.equal(mapDevice(bad, AT).ok, false);
});

test("vehicles: active window, duplicates and bookability", () => {
  assert.equal(isWithinActiveWindow("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z", AT), true);
  assert.equal(isWithinActiveWindow("2027-01-01T00:00:00Z", undefined, AT), false);
  assert.equal(isWithinActiveWindow(undefined, "2026-01-01T00:00:00Z", AT), false);
  assert.equal(isWithinActiveWindow("garbage", undefined, AT), false);
  const { vehicles, rejected } = mapDevices([{ id: "a", name: "A" }, { id: "a", name: "A2" }, { id: "b" }, { id: "c", name: "C", activeTo: "2020-01-01T00:00:00Z" }], AT);
  assert.equal(vehicles.length, 2); assert.equal(rejected, 2);
  assert.equal(isBookable(vehicles[0]), true);
  assert.equal(isBookable(vehicles[1]), false);
  assert.equal(isBookable(null), false);
});

test("drivers: only active users with isDriver===true; optional; validated; ids not names", () => {
  const users = [
    { id: "d1", firstName: "Dina", lastName: "R", isDriver: true },
    { id: "u2", firstName: "Not", lastName: "Driver" },
    { id: "d3", name: "d3@example.test", isDriver: true, activeTo: "2020-01-01T00:00:00Z" },
    { id: "d4", name: "d4@example.test", isDriver: "true" },
    { id: "d1", name: "dup", isDriver: true },
  ];
  const drivers = mapDrivers(users, AT);
  assert.deepEqual(drivers, [{ userId: "d1", name: "Dina R" }]);
  assert.equal(mapDriver({ id: "x", isDriver: true }, AT).ok, false, "no name");
  assert.deepEqual(validateDriverReference(undefined, drivers), { ok: true, driver: null });
  assert.deepEqual(validateDriverReference("", drivers), { ok: true, driver: null });
  assert.equal(validateDriverReference("d1", drivers).driver.userId, "d1");
  assert.equal(validateDriverReference("u2", drivers).ok, false);
  assert.equal(validateDriverReference("Dina R", drivers).ok, false, "names are not references");
  assert.equal(validateDriverReference(5, drivers).ok, false);
});

test("assigned-driver derivation helper (UNVERIFIED source) is pure and conservative", () => {
  const drivers = [{ userId: "d1", name: "D1" }, { userId: "d2", name: "D2" }];
  const ch = [
    { device: { id: "v1" }, driver: { id: "d1" }, dateTime: "2026-01-01T00:00:00Z" },
    { device: { id: "v1" }, driver: { id: "d2" }, dateTime: "2026-03-01T00:00:00Z" },
    { device: { id: "v1" }, driver: { id: "d1" }, dateTime: "2027-01-01T00:00:00Z" },
    { device: { id: "v2" }, driver: { id: "d1" }, dateTime: "2026-02-01T00:00:00Z" },
    { device: { id: "v1" }, driver: { id: "zz" }, dateTime: "2026-04-01T00:00:00Z" },
  ];
  assert.equal(deriveAssignedDriver(ch.slice(0, 3), "v1", AT, drivers).userId, "d2");
  assert.equal(deriveAssignedDriver(ch, "v1", AT, drivers), null, "latest driver not a valid driver -> empty, not an older one");
  assert.equal(deriveAssignedDriver([], "v1", AT, drivers), null);
  assert.equal(deriveAssignedDriver(ch, "v9", AT, drivers), null);
});

test("identity: inactive users and ambiguous/missing users are denied", async () => {
  const past = [{ id: "b1", name: "tester@example.test", activeTo: "2020-01-01T00:00:00Z" }];
  assert.equal((await resolveAuthenticatedPrincipal(createMockApi({ users: past }))).status, "unresolved");
  assert.equal((await resolveAuthenticatedPrincipal(createMockApi({ users: [] }))).status, "unresolved");
  assert.equal((await resolveAuthenticatedPrincipal(createMockApi({ users: [{ id: "1", name: "a" }, { id: "2", name: "a" }] }))).status, "unresolved");
  assert.equal((await resolveAuthenticatedPrincipal(createMockApi({ session: null }))).status, "unresolved");
  assert.equal((await resolveAuthenticatedPrincipal(createMockApi({ session: { database: "d" } }))).status, "unresolved");
});

const full = (extra = {}) => ({ gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST, ...extra });

test("native runtime: missing role mapping denies everything even with every gate on", async () => {
  const api = createMockApi();
  const rt = await createNativeRuntime({ api, ...full() }); // loads mapping from (empty) mock AddInData
  assert.equal(rt.role, null);
  for (const k of ["read", "write", "approve"]) assert.equal(rt.access[k].allowed, false, k);
  await assert.rejects(rt.provider.getBookings());
});

test("native runtime: unmapped user denied; requester can write but not approve; approver can approve", async () => {
  const other = await createNativeRuntime({ api: createMockApi(), ...full({ roleMapping: mapping([{ userId: "someone-else", role: "administrator" }]) }) });
  assert.equal(other.access.read.allowed, false);

  const req = await createNativeRuntime({ api: createMockApi(), ...full({ roleMapping: roleMap("requester") }) });
  assert.equal(req.role, "requester");
  assert.equal(req.access.read.allowed, true); assert.equal(req.access.write.allowed, true); assert.equal(req.access.approve.allowed, false);
  const calls = [];
  const apiR = createMockApi(); const orig = apiR.call; apiR.call = (m, p, ok, err) => { calls.push(`${m}:${p.typeName}`); orig(m, p, ok, err); };
  const req2 = await createNativeRuntime({ api: apiR, ...full({ roleMapping: roleMap("requester") }) });
  const before = calls.length;
  await assert.rejects(req2.provider.updateBookingStatus("b", "APPROVED", "u"), (e) => e.name === "CapabilityDeniedError");
  assert.equal(calls.length, before, "role denial happens before any API call");

  const apr = await createNativeRuntime({ api: createMockApi(), ...full({ roleMapping: roleMap("approver") }) });
  assert.equal(apr.access.approve.allowed, true);
});

test("native runtime: a role cannot exceed the capability gates", async () => {
  const gate = createCapabilityGate({ ...ALL_TRUE, APPROVAL_ACTIONS_ENABLED: false });
  const rt = await createNativeRuntime({ api: createMockApi(), gate, allowlist: MOCK_ALLOWLIST, roleMapping: roleMap("administrator") });
  assert.equal(rt.access.write.allowed, true);
  assert.equal(rt.access.approve.allowed, false);
});

test("role mapping is not loaded (no AddInData call) unless read capability is allowed", async () => {
  const api = createMockApi();
  const gate = createCapabilityGate({ MYGEOTAB_IDENTITY_ENABLED: true });
  await createNativeRuntime({ api, gate, allowlist: MOCK_ALLOWLIST });
  assert.equal(api.calls.some((c) => c.typeName === "AddInData"), false);
});
