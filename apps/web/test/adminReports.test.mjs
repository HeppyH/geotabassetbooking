/* Phase G — admin configuration and reporting. MOCK api only; not tenant validation.
   Admin checks are client-side policy, not server-enforced security. */
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, createAdminRepo, parseSettings, SETTINGS_RECORD_ID } from "../src/admin/config.ts";
import { approvalSummary, bookingHistory, bookingSummary, bookingsFromRecords, vehicleUtilization } from "../src/reports/reports.ts";
import { createAddInDataStore } from "../src/storage/addinDataStore.ts";
import { loadRoleMapping } from "../src/authz/roles.ts";
import { createNotificationRepo } from "../src/notifications/notificationRepo.ts";
import { createAuditRepo } from "../src/audit/auditRepo.ts";
import { PRODUCTION_CAPABILITY_CONFIG, getProductionCapabilityGate } from "../src/runtime/capabilities.ts";
import { DEFAULT_ADDIN_ID } from "../src/config/addinId.ts";

function memApi() {
  let n = 0; const rows = [];
  return { rows, call(m, p, ok, err) {
    if (m === "Get") return ok(rows.map((r) => ({ ...r, details: JSON.parse(JSON.stringify(r.details)) })));
    if (m === "Add") { const id = `s${++n}`; rows.push({ id, addInId: p.entity.addInId, details: p.entity.details }); return ok(id); }
    if (m === "Set") { const r = rows.find((x) => x.id === p.entity.id); if (!r) return err(new Error("nf")); r.details = p.entity.details; return ok(null); }
    return err(new Error("unsupported"));
  } };
}
const store = (api) => createAddInDataStore({ api, addInId: DEFAULT_ADDIN_ID, sleep: async () => {}, cacheTtlMs: 0 });
let t = 0; const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++));
const admin = (api, role = "administrator", actor = "adm") => createAdminRepo({ store: store(api), actorId: actor, role, now: clock });
const goodSettings = () => ({ timeZone: "Asia/Jakarta", minDurationMinutes: 30, maxDurationMinutes: 480, maxAdvanceDays: 60, destinationRequired: true, approvalRequired: true, notificationPreferences: { booking_reminder: false } });

test("settings validation: defaults are valid and strict rules reject bad input", () => {
  assert.equal(parseSettings({ kind: "app_settings", ...DEFAULT_SETTINGS }).ok, true);
  const base = () => ({ kind: "app_settings", ...goodSettings() });
  assert.equal(parseSettings(base()).ok, true);
  const bad = [["timeZone", "Mars/Base"], ["minDurationMinutes", 0], ["minDurationMinutes", 1.5], ["maxDurationMinutes", 10], ["maxDurationMinutes", 999999],
    ["maxAdvanceDays", -1], ["maxAdvanceDays", 731], ["destinationRequired", "yes"], ["approvalRequired", false], ["notificationPreferences", []],
    ["notificationPreferences", { nope: true }], ["notificationPreferences", { booking_reminder: "no" }], ["kind", "x"]];
  for (const [k, v] of bad) assert.equal(parseSettings({ ...base(), [k]: v }).ok, false, `${k}=${JSON.stringify(v)}`);
  for (const x of [null, [], "x", 3]) assert.equal(parseSettings(x).ok, false);
  assert.equal(parseSettings({ ...base(), minDurationMinutes: 600, maxDurationMinutes: 500 }).ok, false);
});

test("settings can never carry capability flags or other unknown keys", () => {
  for (const key of ["LIVE_BOOKING_WRITE_ENABLED", "MYGEOTAB_IDENTITY_ENABLED", "APPROVED_TENANT_CONTEXTS", "role", "__proto__x"]) {
    const r = parseSettings({ kind: "app_settings", ...goodSettings(), [key]: true });
    assert.equal(r.ok, false, key); assert.match(r.reason, /Unknown setting/);
  }
});

test("only administrators can save settings or roles; others are denied before any write", async () => {
  for (const role of ["requester", "approver", null]) {
    const api = memApi(); const a = admin(api, role);
    await assert.rejects(a.saveSettings(goodSettings()), /Administrator access required/, String(role));
    await assert.rejects(a.saveRoleMapping([{ userId: "u", role: "administrator" }]), /Administrator access required/);
    await assert.rejects(a.loadRoles(), /Administrator access required/);
    assert.equal(api.rows.length, 0);
  }
  await assert.rejects(admin(memApi(), "administrator", "").saveSettings(goodSettings()), /Administrator access required/);
});

test("settings: save, reload, update with stamp check; invalid saves rejected", async () => {
  const api = memApi(); const a = admin(api);
  assert.equal((await a.loadSettings()).source, "default");
  await a.saveSettings(goodSettings());
  const loaded = await a.loadSettings();
  assert.equal(loaded.source, "stored"); assert.equal(loaded.settings.maxDurationMinutes, 480);
  assert.equal(loaded.settings.notificationPreferences.booking_reminder, false);
  assert.equal(loaded.settings.notificationPreferences.booking_approved, true, "missing prefs default to true");
  await a.saveSettings({ ...goodSettings(), maxAdvanceDays: 90 });
  assert.equal((await a.loadSettings()).settings.maxAdvanceDays, 90);
  assert.equal(api.rows.length, 1, "update, not a second record");
  assert.equal(api.rows[0].details.recordId, SETTINGS_RECORD_ID);
  await assert.rejects(a.saveSettings({ ...goodSettings(), timeZone: "Nope" }), /time ?Zone/i);
  await assert.rejects(a.saveSettings({ ...goodSettings(), LIVE_BOOKING_WRITE_ENABLED: true }), /Unknown setting/);
  await assert.rejects(a.saveSettings(null), /not an object/);
  assert.equal((await a.loadSettings()).settings.maxAdvanceDays, 90);
});

test("corrupt stored settings fall back to defaults with a reason (never widen)", async () => {
  const api = memApi(); const a = admin(api);
  await a.saveSettings(goodSettings());
  api.rows[0].details.payload.maxDurationMinutes = -5;
  const r = await a.loadSettings();
  assert.equal(r.source, "default"); assert.ok(r.reason);
  assert.deepEqual(r.settings, { ...DEFAULT_SETTINGS });
  const failing = createAdminRepo({ store: { list: async () => { throw new Error("boom"); }, add: async () => {}, update: async () => {} }, actorId: "a", role: "administrator" });
  assert.equal((await failing.loadSettings()).source, "default");
});

test("admin settings do not bypass or alter capability gates", async () => {
  const before = JSON.stringify(PRODUCTION_CAPABILITY_CONFIG);
  const a = admin(memApi()); await a.saveSettings(goodSettings());
  assert.equal(JSON.stringify(PRODUCTION_CAPABILITY_CONFIG), before);
  for (const n of Object.keys(PRODUCTION_CAPABILITY_CONFIG)) assert.equal(getProductionCapabilityGate().isFlagEnabled(n), false);
});

test("role mapping admin: validated, last administrator protected, readable by loadRoleMapping", async () => {
  const api = memApi(); const a = admin(api);
  await assert.rejects(a.saveRoleMapping([{ userId: "u1", role: "approver" }]), /administrator must remain/);
  await assert.rejects(a.saveRoleMapping([{ userId: "u1", role: "root" }]), /unknown role/);
  await assert.rejects(a.saveRoleMapping([{ userId: "u1", role: "administrator" }, { userId: "u1", role: "requester" }]), /more than once/);
  await assert.rejects(a.saveRoleMapping("nope"), /entries/);
  assert.equal(api.rows.length, 0);
  const saved = await a.saveRoleMapping([{ userId: "adm", role: "administrator" }, { userId: "u2", role: "approver" }]);
  assert.equal(saved.updatedBy, "adm");
  const m = await loadRoleMapping(store(api));
  assert.equal(m.mapping.entries.length, 2);
  await a.saveRoleMapping([{ userId: "adm", role: "administrator" }]);
  assert.equal(api.rows.length, 1);
  assert.equal((await a.loadRoles()).mapping.entries.length, 1);
});

/*────────── reports ──────────*/
const mkBooking = (id, over = {}) => ({ id, vehicleId: "v1", vehicleNameSnapshot: "Truck", requesterUserId: "u1", requesterNameSnapshot: "R", driverUserId: null, driverNameSnapshot: null,
  startDate: "2026-03-10", startTime: "08:00", endDate: "2026-03-10", endTime: "10:00", startUtc: "2026-03-10T01:00:00.000Z", endUtc: "2026-03-10T03:00:00.000Z", timeZone: "Asia/Jakarta",
  purpose: "p", destination: null, status: "APPROVED", approverId: "a1", approvedAt: "2026-03-01T01:00:00.000Z", rejectionReason: null,
  createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T01:00:00.000Z", ...over });
const rec = (recordType, recordId, payload, serverId = recordId) => ({ serverId, envelope: { schemaVersion: 1, recordType, recordId, createdAt: "2026-03-01T00:00:00.000Z", createdBy: "u", payload } });
const PERIOD = { fromUtc: "2026-03-10T00:00:00.000Z", toUtc: "2026-03-11T00:00:00.000Z" };

test("reports use only validated booking records; other record types and invalid bookings are excluded", async () => {
  const api = memApi(); const st = store(api);
  await st.add({ schemaVersion: 1, recordType: "booking", recordId: "bkg_1", createdAt: "2026-03-01T00:00:00.000Z", createdBy: "u1", payload: { ...mkBooking("x"), id: undefined } });
  await st.add({ schemaVersion: 1, recordType: "booking", recordId: "bkg_bad", createdAt: "2026-03-01T00:00:00.000Z", createdBy: "u1", payload: { vehicleId: "v1" } });
  await createNotificationRepo({ store: st, actorId: "u1", now: clock }).create({ eventId: "e", idempotencyKey: "k", type: "booking_approved", recipientUserId: "u1", bookingId: "bkg_1", title: "t", message: "m" });
  await createAuditRepo({ store: st, actorId: "u1", now: clock }).append({ bookingId: "bkg_1", action: "CREATE" });
  await admin(api).saveSettings(goodSettings());
  const { records } = await st.list({ forceRefresh: true });
  assert.equal(records.length, 5);
  const { bookings, skipped } = bookingsFromRecords(records);
  assert.equal(bookings.length, 1); assert.equal(skipped, 4);
  assert.equal(bookings[0].id, "bkg_1");
  assert.equal(bookingSummary(bookings).total, 1);
});

test("booking and approval summaries", () => {
  const b = [mkBooking("1"), mkBooking("2", { status: "PENDING_APPROVAL", approverId: null, approvedAt: null }), mkBooking("3", { status: "REJECTED", approverId: "a1", approvedAt: "2026-03-01T02:00:00.000Z", rejectionReason: "no" }),
    mkBooking("4", { status: "CANCELLED", approverId: null, approvedAt: null }), mkBooking("5", { startUtc: "2026-04-01T01:00:00.000Z", endUtc: "2026-04-01T03:00:00.000Z" })];
  const s = bookingSummary(b);
  assert.equal(s.total, 5); assert.equal(s.byStatus.APPROVED, 2); assert.equal(s.byStatus.CANCELLED, 1); assert.equal(s.byStatus.PENDING_APPROVAL, 1);
  assert.equal(bookingSummary(b, PERIOD).total, 4);
  const a = approvalSummary(b, PERIOD);
  assert.deepEqual([a.pending, a.approved, a.rejected], [1, 1, 1]);
  assert.equal(a.averageDecisionMinutes, 90); // (60 + 120) / 2
  assert.equal(approvalSummary([], PERIOD).averageDecisionMinutes, null);
});

test("vehicle utilization: clipped to period, overlaps merged, only used statuses", () => {
  const b = [
    mkBooking("1"), // 01:00-03:00 -> 2h
    mkBooking("2", { startUtc: "2026-03-10T02:00:00.000Z", endUtc: "2026-03-10T05:00:00.000Z" }), // overlaps -> merged 01:00-05:00 = 4h
    mkBooking("3", { status: "CANCELLED" }), mkBooking("4", { status: "REJECTED" }), mkBooking("5", { status: "PENDING_APPROVAL" }),
    mkBooking("6", { vehicleId: "v2", vehicleNameSnapshot: "Van", startUtc: "2026-03-09T20:00:00.000Z", endUtc: "2026-03-10T02:00:00.000Z", status: "COMPLETED" }), // clipped to 00:00-02:00 = 2h
  ];
  const u = vehicleUtilization(b, PERIOD);
  assert.deepEqual(u.map((x) => [x.vehicleId, x.bookedHours, x.utilizationPercent]), [["v1", 4, 16.7], ["v2", 2, 8.3]]);
  assert.deepEqual(vehicleUtilization([], PERIOD), []);
  assert.throws(() => vehicleUtilization(b, { fromUtc: PERIOD.toUtc, toUtc: PERIOD.fromUtc }), /INVALID_PERIOD/);
  assert.throws(() => vehicleUtilization(b, { fromUtc: "x", toUtc: "y" }), /INVALID_PERIOD/);
});

test("booking history is newest first and period-filtered", () => {
  const b = [mkBooking("1"), mkBooking("2", { createdAt: "2026-03-05T00:00:00.000Z" }), mkBooking("3", { startUtc: "2026-05-01T01:00:00.000Z", endUtc: "2026-05-01T03:00:00.000Z", createdAt: "2026-03-09T00:00:00.000Z" })];
  assert.deepEqual(bookingHistory(b).map((x) => x.id), ["3", "2", "1"]);
  assert.deepEqual(bookingHistory(b, PERIOD).map((x) => x.id), ["2", "1"]);
});
