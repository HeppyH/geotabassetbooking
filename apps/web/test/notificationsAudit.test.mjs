/* Phase F — persisted notifications, recipient scoping, pagination fix, audit records.
   MOCK api only; not tenant validation. Persisting a notification is NOT live delivery. */
import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationRepo, queryNotifications, buildNotificationText, NOTIFICATION_TYPES } from "../src/notifications/notificationRepo.ts";
import { createAuditRepo, diffBooking, AUDIT_ACTIONS } from "../src/audit/auditRepo.ts";
import { createAddInDataStore } from "../src/storage/addinDataStore.ts";
import { AddInDataBookingDataProvider } from "../src/data/addinDataProvider.ts";
import { createNativeRuntime } from "../src/runtime/nativeRuntime.ts";
import { createCapabilityGate } from "../src/runtime/capabilities.ts";
import { DEFAULT_ADDIN_ID } from "../src/config/addinId.ts";
import { createMockApi, ALL_TRUE, MOCK_ALLOWLIST, roleMap } from "./helpers/mockGeotab.mjs";

/* In-memory AddInData mock that supports Add/Get/Set. */
function memApi() {
  let n = 0; const rows = [];
  return { rows, calls: [], call(m, p, ok, err) {
    this.calls.push(m);
    if (m === "Get") return ok(rows.map((r) => ({ ...r, details: JSON.parse(JSON.stringify(r.details)) })));
    if (m === "Add") { const id = `s${++n}`; rows.push({ id, addInId: p.entity.addInId, details: p.entity.details }); return ok(id); }
    if (m === "Set") { const r = rows.find((x) => x.id === p.entity.id); if (!r) return err(new Error("nf")); r.details = p.entity.details; return ok(null); }
    return err(new Error("unsupported"));
  } };
}
const mkStore = (api) => createAddInDataStore({ api, addInId: DEFAULT_ADDIN_ID, sleep: async () => {}, cacheTtlMs: 0 });
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
let rnd = 0; const random = () => `r${++rnd}`;
const nn = (key, to, over = {}) => ({ eventId: `e-${key}`, idempotencyKey: key, type: "booking_approved", recipientUserId: to, bookingId: "bk1", title: "T", message: "M", ...over });
const repoFor = (api, actor) => createNotificationRepo({ store: mkStore(api), actorId: actor, now: clock, random });

test("six required notification types exist (booking_created = submitted)", () => {
  for (const t of ["booking_created", "booking_approved", "booking_rejected", "booking_cancelled", "booking_updated", "booking_reminder"]) assert.ok(NOTIFICATION_TYPES.includes(t), t);
  for (const t of NOTIFICATION_TYPES) { const x = buildNotificationText(t, "BK-1", "no car"); assert.ok(x.title && x.message); }
  assert.match(buildNotificationText("booking_rejected", "BK-1", "no car").message, /no car/);
});

test("pagination: offset and limit are applied after filtering (F-06 regression)", () => {
  const all = Array.from({ length: 10 }, (_, i) => ({ recordId: `ntf_${i}`, recipientUserId: "u1", type: "booking_approved", isRead: i % 2 === 0, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  const p1 = queryNotifications(all, "u1", { limit: 3, offset: 0 });
  const p2 = queryNotifications(all, "u1", { limit: 3, offset: 3 });
  assert.deepEqual(p1.items.map((x) => x.recordId), ["ntf_9", "ntf_8", "ntf_7"]);
  assert.deepEqual(p2.items.map((x) => x.recordId), ["ntf_6", "ntf_5", "ntf_4"]);
  assert.equal(p2.hasMore, true); assert.equal(p2.total, 10);
  assert.equal(queryNotifications(all, "u1", { limit: 3, offset: 9 }).items.length, 1);
  assert.equal(queryNotifications(all, "u1", { limit: 3, offset: 99 }).items.length, 0);
  assert.equal(queryNotifications(all, "u1", { offset: 8 }).items.length, 2, "offset without limit");
  assert.equal(queryNotifications(all, "u1", { filter: "unread" }).total, 5);
  assert.equal(queryNotifications(all, "u1", { filter: "read", limit: 2, offset: 1 }).items.length, 2);
  assert.equal(queryNotifications(all, "u1", { limit: 0 }).items.length, 0);
  assert.equal(queryNotifications(all, "other", {}).total, 0);
});

test("legacy provider pagination bug is fixed (offset + limit)", async () => {
  const api = memApi();
  for (let i = 0; i < 5; i++) api.rows.push({ id: `s${i}`, addInId: DEFAULT_ADDIN_ID, details: { id: `n${i}`, eventId: "e", idempotencyKey: `k${i}`, type: "booking_approved", recipient_user_id: "u1", related_booking_id: null, title: "t", message: "m", is_read: false, delivery_status: "pending", delivered_at: null, created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), updated_at: "x" } });
  api.rows.push({ id: "sx", addInId: DEFAULT_ADDIN_ID, details: "{broken" });
  api.rows.push({ id: "sb", addInId: DEFAULT_ADDIN_ID, details: { id: "bk", deviceId: "d", status: "APPROVED" } });
  const p = new AddInDataBookingDataProvider(api, DEFAULT_ADDIN_ID);
  assert.deepEqual((await p.getNotifications("u1", { limit: 2, offset: 2 })).map((n) => n.id), ["n2", "n1"]);
  assert.equal((await p.getNotifications("u1", { offset: 1 })).length, 4);
  assert.equal((await p.getNotifications("u1", { limit: 3 })).length, 3);
  assert.equal(await p.getUnreadCount("u1"), 5, "malformed and booking records are skipped");
});

test("repo: only the actor's notifications are listed, counted and changed", async () => {
  const api = memApi();
  const admin = repoFor(api, "approver");
  await admin.create(nn("k1", "alice")); await admin.create(nn("k2", "bob")); await admin.create(nn("k3", "alice", { type: "booking_rejected" }));
  const alice = repoFor(api, "alice"); const bob = repoFor(api, "bob");
  assert.equal((await alice.list()).total, 2); assert.equal((await bob.list()).total, 1);
  assert.ok((await alice.list()).items.every((x) => x.recipientUserId === "alice"));
  assert.equal(await alice.unreadCount(), 2);
  const bobId = (await bob.list()).items[0].recordId;
  await assert.rejects(alice.markRead(bobId), /not found/i, "cross-user mark-read denied");
  assert.equal(await bob.unreadCount(), 1);
  await assert.rejects(alice.setDeliveryStatus(bobId, "pending"), /not found/i);
  assert.equal((await alice.list({ type: "booking_rejected" })).total, 1);
});

test("repo: persistent read status, mark one, mark all, filters", async () => {
  const api = memApi();
  const sender = repoFor(api, "approver");
  for (let i = 0; i < 4; i++) await sender.create(nn(`k${i}`, "alice"));
  const alice = repoFor(api, "alice");
  const first = (await alice.list()).items[0];
  await alice.markRead(first.recordId);
  await alice.markRead(first.recordId); // idempotent
  assert.equal(await alice.unreadCount(), 3);
  assert.equal((await alice.list({ filter: "read" })).total, 1);
  assert.equal((await alice.list({ filter: "unread" })).total, 3);
  assert.equal(await alice.markAllRead(), 3);
  assert.equal(await alice.unreadCount(), 0);
  // persisted: a fresh repo/store instance sees the same state
  assert.equal(await repoFor(api, "alice").unreadCount(), 0);
  const read = (await repoFor(api, "alice").list({ filter: "read" })).items[0];
  assert.ok(read.readAt);
  await assert.rejects(alice.markRead("ntf_missing"), /not found/i);
});

test("repo: creation is idempotent and records have a distinct type/id prefix", async () => {
  const api = memApi();
  const r = repoFor(api, "approver");
  const a = await r.create(nn("same", "alice")); const b = await r.create(nn("same", "alice"));
  assert.equal(a.recordId, b.recordId);
  assert.equal(api.rows.length, 1);
  assert.match(a.recordId, /^ntf_/);
  assert.equal(a.deliveryStatus, "not_applicable", "persisted != delivered");
  assert.equal(api.rows[0].details.recordType, "notification");
});

test("delivery is never marked delivered without confirmation", async () => {
  const api = memApi(); const sender = repoFor(api, "approver"); await sender.create(nn("k", "alice"));
  const alice = repoFor(api, "alice"); const id = (await alice.list()).items[0].recordId;
  await assert.rejects(alice.setDeliveryStatus(id, "delivered"), /confirmation/i);
  await assert.rejects(alice.setDeliveryStatus(id, "delivered", { channel: "", confirmedAt: "2026-01-01T00:00:00Z" }), /confirmation/i);
  await assert.rejects(alice.setDeliveryStatus(id, "delivered", { channel: "service", confirmedAt: "nope" }), /confirmation/i);
  await alice.setDeliveryStatus(id, "pending");
  assert.equal((await alice.list()).items[0].deliveryStatus, "pending");
  await alice.setDeliveryStatus(id, "delivered", { channel: "service", confirmedAt: "2026-01-02T00:00:00.000Z" });
  assert.equal((await alice.list()).items[0].deliveredAt, "2026-01-02T00:00:00.000Z");
  await assert.rejects(alice.setDeliveryStatus(id, "bogus"), /Unknown delivery status/);
});

test("repo: malformed/foreign-shaped notification records are ignored, never rendered", async () => {
  const api = memApi();
  const r = repoFor(api, "approver"); await r.create(nn("k", "alice"));
  api.rows.push({ id: "bad1", addInId: DEFAULT_ADDIN_ID, details: "{nope" });
  api.rows[0].details.payload.recipientUserId = 5; // corrupt the real one
  assert.equal((await repoFor(api, "alice").list()).total, 0);
  assert.throws(() => createNotificationRepo({ store: mkStore(api), actorId: "" }), /NO_ACTOR/);
});

/*────────── audit ──────────*/
test("audit: separate records, append-only API, actor is the authenticated user", async () => {
  const api = memApi();
  const audit = createAuditRepo({ store: mkStore(api), actorId: "u1", now: clock, random });
  assert.deepEqual(Object.keys(audit).sort(), ["append", "history"], "no update/remove exposed");
  const e = await audit.append({ bookingId: "bk1", action: "CREATE", newStatus: "PENDING_APPROVAL" });
  await audit.append({ bookingId: "bk1", action: "REJECT", reason: "no vehicle", previousStatus: "PENDING_APPROVAL", newStatus: "REJECTED" });
  await audit.append({ bookingId: "bk2", action: "CREATE" });
  assert.equal(e.actorId, "u1"); assert.match(e.recordId, /^aud_/);
  assert.equal(api.rows[0].details.recordType, "audit");
  const h = await audit.history("bk1");
  assert.deepEqual(h.map((x) => x.action), ["CREATE", "REJECT"]);
  assert.equal(h[1].reason, "no vehicle");
  assert.equal((await audit.history("none")).length, 0);
  assert.ok(!api.calls.includes("Set") && !api.calls.includes("Remove"));
  await assert.rejects(audit.append({ bookingId: "bk1", action: "HACK" }), /UNKNOWN_ACTION/);
  await assert.rejects(audit.append({ bookingId: "", action: "CREATE" }), /NO_BOOKING/);
  assert.throws(() => createAuditRepo({ store: mkStore(api), actorId: " " }), /NO_ACTOR/);
});

test("audit: all required actions exist; entries never appear as notifications or bookings", async () => {
  for (const a of ["CREATE", "EDIT", "SUBMIT", "APPROVE", "REJECT", "CANCEL", "DRIVER_CHANGE", "VEHICLE_CHANGE", "DATETIME_CHANGE"]) assert.ok(AUDIT_ACTIONS.includes(a), a);
  const api = memApi();
  await createAuditRepo({ store: mkStore(api), actorId: "u1", now: clock, random }).append({ bookingId: "bk1", action: "EDIT" });
  assert.equal((await repoFor(api, "u1").list()).total, 0);
});

test("audit: diff captures driver, vehicle and date/time changes with old/new values", () => {
  const before = { vehicleId: "v1", vehicleNameSnapshot: "A", driverUserId: null, driverNameSnapshot: null, startUtc: "2026-03-10T01:00:00.000Z", endUtc: "2026-03-10T03:00:00.000Z", timeZone: "Asia/Jakarta", purpose: "x", destination: null };
  const after = { ...before, vehicleId: "v2", vehicleNameSnapshot: "B", driverUserId: "d1", driverNameSnapshot: "Dina", endUtc: "2026-03-10T04:00:00.000Z", purpose: "y" };
  const d = diffBooking(before, after);
  assert.deepEqual(d.actions.sort(), ["DATETIME_CHANGE", "DRIVER_CHANGE", "VEHICLE_CHANGE"]);
  assert.deepEqual(d.changes.find((c) => c.field === "driverUserId"), { field: "driverUserId", from: null, to: "d1" });
  assert.deepEqual(d.changes.find((c) => c.field === "endUtc"), { field: "endUtc", from: "2026-03-10T03:00:00.000Z", to: "2026-03-10T04:00:00.000Z" });
  assert.ok(d.changes.some((c) => c.field === "purpose"));
  assert.deepEqual(diffBooking(before, { ...before }), { changes: [], actions: [] });
});

/*────────── native provider scoping ──────────*/
const notifRow = (id, to, read = false) => ({ id: `s-${id}`, addInId: "x", details: { id, eventId: "e", idempotencyKey: `k-${id}`, type: "booking_approved", recipient_user_id: to, related_booking_id: null, title: "t", message: "m", is_read: read, delivery_status: "pending", delivered_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "x" } });
async function nativeWith(rows, role) {
  const api = createMockApi({ addInData: [] });
  const orig = api.call;
  api.call = (m, p, ok, err) => {
    if (m === "Get" && p.typeName === "AddInData") { api.calls.push({ method: m, typeName: "AddInData" }); return ok(rows.map((r) => ({ ...r, addInId: p.search.addInId }))); }
    if (m === "Set") { api.calls.push({ method: m, typeName: "AddInData" }); return ok(null); }
    return orig(m, p, ok, err);
  };
  return { api, rt: await createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST, roleMapping: roleMap(role) }) };
}

test("native provider: cross-user notification access is denied or filtered", async () => {
  const { api, rt } = await nativeWith([notifRow("n1", "b1"), notifRow("n2", "other")], "requester");
  assert.deepEqual((await rt.provider.getNotifications("b1")).map((n) => n.id), ["n1"]);
  await assert.rejects(rt.provider.getNotifications("other"), (e) => e.code === "CAPABILITY_DISABLED" && /authenticated user/.test(e.message));
  await assert.rejects(rt.provider.getUnreadCount("other"), /authenticated user/);
  await assert.rejects(rt.provider.markAllAsRead("other"), /authenticated user/);
  const sets = () => api.calls.filter((c) => c.method === "Set").length;
  await assert.rejects(rt.provider.markAsRead("n2"), /not found for this user/);
  assert.equal(sets(), 0);
  assert.equal(await rt.provider.getUnreadCount("b1"), 1);
  assert.equal(await rt.provider.findByIdempotencyKey("k-n2"), null, "foreign idempotency lookup reveals nothing");
  assert.equal((await rt.provider.findByIdempotencyKey("k-n1")).id, "n1");
  await rt.provider.markAsRead("n1");
  assert.equal(sets(), 1);
});

test("native provider: audit history limited to owner, approvers and administrators", async () => {
  const booking = (requester) => ({ id: "s1", addInId: "x", details: { id: "bk1", deviceId: "d1", requesterUserId: requester, startAt: "2026-03-10T01:00:00.000Z", endAt: "2026-03-10T03:00:00.000Z", purpose: "p", status: "APPROVED", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 } });
  const own = await nativeWith([booking("b1")], "requester");
  await own.rt.provider.getAuditRecords("bk1");
  const foreign = await nativeWith([booking("someone")], "requester");
  await assert.rejects(foreign.rt.provider.getAuditRecords("bk1"), /limited to the booking owner/);
  const approver = await nativeWith([booking("someone")], "approver");
  await approver.rt.provider.getAuditRecords("bk1");
});
