/* Phase E — booking workflow domain tests (state machine, schedule, availability, model, search)
   plus native-provider enforcement. MOCKS only; not tenant validation.
   Overlap/reconciliation tests demonstrate DETECTION; they do not prove double-booking prevention. */
import test from "node:test";
import assert from "node:assert/strict";
import { BLOCKING_STATUSES, BOOKING_STATUSES, TERMINAL_STATUSES, TRANSITIONS, canEditBooking, evaluateTransition } from "../src/booking/stateMachine.ts";
import { buildSchedule, checkLimits, formatLocal, isValidTimeZone, localToUtc } from "../src/booking/schedule.ts";
import { ADVISORY_NOTE, checkAfterWrite, findConflicts, findDuplicates, intervalsOverlap, reconcile } from "../src/booking/availability.ts";
import { parseBookingRecord } from "../src/booking/model.ts";
import { filterBookings, visibleBookings } from "../src/booking/search.ts";
import { createNativeRuntime } from "../src/runtime/nativeRuntime.ts";
import { createCapabilityGate } from "../src/runtime/capabilities.ts";
import { createMockApi, ALL_TRUE, MOCK_ALLOWLIST, roleMap } from "./helpers/mockGeotab.mjs";

const T = (from, to, o = {}) => evaluateTransition({ from, to, requesterId: "req", actorId: "app", role: "approver", reason: "ok", ...o });

/*────────── state machine ──────────*/
test("every status has a transition entry; terminal statuses have none", () => {
  for (const s of BOOKING_STATUSES) assert.ok(s in TRANSITIONS, s);
  for (const s of TERMINAL_STATUSES) assert.deepEqual(TRANSITIONS[s], [], s);
  for (const s of BLOCKING_STATUSES) assert.ok(BOOKING_STATUSES.includes(s));
  assert.equal(BLOCKING_STATUSES.includes("REJECTED") || BLOCKING_STATUSES.includes("CANCELLED"), false);
});

test("valid happy paths", () => {
  assert.equal(T("PENDING_APPROVAL", "APPROVED").ok, true);
  assert.equal(T("PENDING_APPROVAL", "APPROVED").effects.approverId, "app");
  assert.equal(T("APPROVED", "ASSIGNED").ok, true);
  assert.equal(T("ASSIGNED", "COMPLETED").ok, true);
  const rej = T("PENDING_APPROVAL", "REJECTED", { reason: "  no vehicle  " });
  assert.equal(rej.ok, true); assert.equal(rej.effects.rejectionReason, "no vehicle");
});

test("invalid transitions are rejected (permission passes, edge does not exist)", () => {
  for (const [f, t] of [["PENDING_APPROVAL", "COMPLETED"], ["APPROVED", "COMPLETED"], ["ASSIGNED", "APPROVED"], ["DRAFT", "APPROVED"], ["PENDING_APPROVAL", "ASSIGNED"], ["APPROVED", "REJECTED"]]) {
    const r = T(f, t, { role: "administrator" });
    assert.equal(r.ok, false, `${f}->${t}`); assert.equal(r.code, "INVALID_TRANSITION", `${f}->${t}`);
  }
  const back = T("APPROVED", "PENDING_APPROVAL", { actorId: "req", role: "requester" });
  assert.equal(back.code, "INVALID_TRANSITION");
  assert.equal(T("APPROVED", "PENDING_APPROVAL", { role: "administrator" }).code, "PERMISSION_DENIED", "non-owner cannot resubmit");
  assert.equal(evaluateTransition({ from: "X", to: "APPROVED", actorId: "a", role: "approver", requesterId: "r" }).code, "UNKNOWN_STATUS");
  assert.equal(evaluateTransition({ from: "APPROVED", to: undefined, actorId: "a", role: "approver", requesterId: "r" }).code, "UNKNOWN_STATUS");
});

test("terminal bookings cannot change (completed cannot be reopened)", () => {
  for (const s of TERMINAL_STATUSES) for (const to of ["APPROVED", "CANCELLED", "ASSIGNED"]) {
    if (s === to) continue;
    const r = T(s, to, { role: "administrator" });
    assert.equal(r.ok, false, `${s}->${to}`); assert.equal(r.code, "TERMINAL_STATUS", `${s}->${to}`);
  }
});

test("requester cannot approve or reject own booking; others need approver role", () => {
  for (const to of ["APPROVED", "REJECTED"]) {
    assert.equal(T("PENDING_APPROVAL", to, { actorId: "req" }).code, "PERMISSION_DENIED", "self");
    assert.equal(T("PENDING_APPROVAL", to, { actorId: "req", role: "administrator" }).code, "PERMISSION_DENIED", "self admin");
    assert.equal(T("PENDING_APPROVAL", to, { actorId: "x", role: "requester" }).code, "PERMISSION_DENIED", "requester role");
    assert.equal(T("PENDING_APPROVAL", to, { role: null }).code, "PERMISSION_DENIED", "no role");
    assert.equal(T("PENDING_APPROVAL", to, { actorId: null }).code, "PERMISSION_DENIED", "no actor");
  }
});

test("rejection requires a reason within the limit", () => {
  for (const reason of [undefined, null, "", "   "]) assert.equal(T("PENDING_APPROVAL", "REJECTED", { reason }).code, "REASON_REQUIRED");
  assert.equal(T("PENDING_APPROVAL", "REJECTED", { reason: "x".repeat(501) }).code, "REASON_REQUIRED");
  assert.equal(T("PENDING_APPROVAL", "REJECTED", { reason: "x".repeat(500) }).ok, true);
});

test("cancel: owner or administrator only", () => {
  assert.equal(T("PENDING_APPROVAL", "CANCELLED", { actorId: "req", role: "requester" }).ok, true);
  assert.equal(T("APPROVED", "CANCELLED", { actorId: "req", role: "requester" }).ok, true);
  assert.equal(T("APPROVED", "CANCELLED", { actorId: "other", role: "requester" }).code, "PERMISSION_DENIED");
  assert.equal(T("APPROVED", "CANCELLED", { actorId: "other", role: "approver" }).code, "PERMISSION_DENIED");
  assert.equal(T("APPROVED", "CANCELLED", { actorId: "adm", role: "administrator" }).ok, true);
});

test("duplicate actions are safe no-ops after permission checks", () => {
  const r = T("APPROVED", "APPROVED");
  assert.deepEqual([r.ok, r.noop], [true, true]);
  assert.equal(T("REJECTED", "REJECTED", { reason: "x" }).noop, true);
  assert.equal(T("APPROVED", "APPROVED", { actorId: "req" }).code, "PERMISSION_DENIED", "unauthorized duplicate still denied");
  assert.equal(T("PENDING_APPROVAL", "APPROVED").noop, false);
});

test("editing is limited to the owner before a decision", () => {
  assert.equal(canEditBooking("PENDING_APPROVAL", "u1", "u1", "requester"), true);
  assert.equal(canEditBooking("DRAFT", "u1", "u1", "requester"), true);
  for (const s of ["APPROVED", "ASSIGNED", "COMPLETED", "REJECTED", "CANCELLED"]) assert.equal(canEditBooking(s, "u1", "u1", "administrator"), false, s);
  assert.equal(canEditBooking("PENDING_APPROVAL", "u1", "u2", "approver"), false);
  assert.equal(canEditBooking("PENDING_APPROVAL", "u1", "u1", null), false);
});

/*────────── schedule / time zones ──────────*/
test("default time zone Asia/Jakarta (UTC+7): local → UTC and back", () => {
  const r = localToUtc("2026-03-10", "08:30");
  assert.deepEqual(r, { ok: true, utc: "2026-03-10T01:30:00.000Z" });
  assert.equal(formatLocal("2026-03-10T01:30:00.000Z"), "2026-03-10 08:30");
});

test("cross-midnight and multi-day bookings with different start/end dates and times", () => {
  const a = buildSchedule({ startDate: "2026-03-10", startTime: "22:00", endDate: "2026-03-11", endTime: "06:00" });
  assert.equal(a.ok, true); assert.equal(a.startUtc, "2026-03-10T15:00:00.000Z"); assert.equal(a.endUtc, "2026-03-10T23:00:00.000Z");
  const b = buildSchedule({ startDate: "2026-12-30", startTime: "09:00", endDate: "2027-01-02", endTime: "17:45" });
  assert.equal(b.ok, true); assert.equal(b.timeZone, "Asia/Jakarta"); assert.equal(b.endLocal, "2027-01-02 17:45");
});

test("other time zones are configurable; offsets differ", () => {
  assert.equal(localToUtc("2026-03-10", "08:30", "UTC").utc, "2026-03-10T08:30:00.000Z");
  assert.equal(localToUtc("2026-01-15", "09:00", "America/New_York").utc, "2026-01-15T14:00:00.000Z");
  assert.equal(localToUtc("2026-07-15", "09:00", "America/New_York").utc, "2026-07-15T13:00:00.000Z");
  assert.equal(localToUtc("2026-03-10", "08:30", "Asia/Kolkata").utc, "2026-03-10T03:00:00.000Z");
});

test("ambiguous and non-existent daylight-saving local times are rejected, not guessed", () => {
  assert.equal(localToUtc("2026-03-08", "02:30", "America/New_York").code, "NONEXISTENT_LOCAL_TIME");
  assert.equal(localToUtc("2026-11-01", "01:30", "America/New_York").code, "AMBIGUOUS_LOCAL_TIME");
  assert.equal(localToUtc("2026-11-01", "03:30", "America/New_York").ok, true);
});

test("invalid dates, times, zones and ordering are rejected", () => {
  const cases = [["2026-02-30", "10:00", undefined, "INVALID_DATE"], ["2026-13-01", "10:00", undefined, "INVALID_DATE"], ["10/03/2026", "10:00", undefined, "INVALID_DATE"],
    ["2026-03-10", "24:00", undefined, "INVALID_TIME"], ["2026-03-10", "9:00", undefined, "INVALID_TIME"], ["2026-03-10", "10:60", undefined, "INVALID_TIME"],
    ["2026-03-10", "10:00", "Mars/Base", "INVALID_TIME_ZONE"], ["2026-03-10", "10:00", "", "INVALID_TIME_ZONE"]];
  for (const [d, t, z, code] of cases) assert.equal(localToUtc(d, t, z).code, code, `${d} ${t} ${z}`);
  assert.equal(localToUtc(null, "10:00").ok, false);
  assert.equal(isValidTimeZone("Asia/Jakarta"), true); assert.equal(isValidTimeZone(5), false);
  assert.equal(buildSchedule({ startDate: "2026-03-10", startTime: "10:00", endDate: "2026-03-10", endTime: "10:00" }).code, "END_NOT_AFTER_START");
  assert.equal(buildSchedule({ startDate: "2026-03-10", startTime: "10:00", endDate: "2026-03-09", endTime: "11:00" }).code, "END_NOT_AFTER_START");
  const bad = buildSchedule({ startDate: "2026-03-10", startTime: "10:00", endDate: "bad", endTime: "11:00" });
  assert.equal(bad.ok, false); assert.equal(bad.field, "end");
});

test("duration and advance-window limits", () => {
  const s = "2026-03-10T00:00:00.000Z"; const e = "2026-03-10T02:00:00.000Z";
  assert.equal(checkLimits(s, e, { minDurationMinutes: 30, maxDurationMinutes: 180 }).ok, true);
  assert.equal(checkLimits(s, e, { minDurationMinutes: 180 }).ok, false);
  assert.equal(checkLimits(s, e, { maxDurationMinutes: 60 }).ok, false);
  assert.equal(checkLimits(s, e, { maxAdvanceDays: 7, now: Date.parse("2026-02-01T00:00:00Z") }).ok, false);
  assert.equal(checkLimits(s, e, { maxAdvanceDays: 60, now: Date.parse("2026-02-01T00:00:00Z") }).ok, true);
});

/*────────── availability ──────────*/
const B = (id, start, end, over = {}) => ({ id, vehicleId: "v1", startUtc: start, endUtc: end, status: "APPROVED", requesterId: "u1", createdAt: "2026-01-01T00:00:00.000Z", purpose: "trip", ...over });
const H = (h) => `2026-03-10T${String(h).padStart(2, "0")}:00:00.000Z`;

test("interval overlap is half-open: touching intervals do not conflict", () => {
  assert.equal(intervalsOverlap(H(8), H(10), H(9), H(11)), true);
  assert.equal(intervalsOverlap(H(8), H(10), H(10), H(12)), false);
  assert.equal(intervalsOverlap(H(10), H(12), H(8), H(10)), false);
  assert.equal(intervalsOverlap(H(8), H(12), H(9), H(10)), true, "contained");
  assert.equal(intervalsOverlap(H(9), H(10), H(8), H(12)), true, "containing");
  assert.equal(intervalsOverlap("bad", H(10), H(9), H(11)), false);
});

test("conflicts consider only blocking statuses and the same vehicle", () => {
  const existing = [B("a", H(8), H(10)), B("b", H(8), H(10), { status: "REJECTED" }), B("c", H(8), H(10), { status: "CANCELLED" }),
    B("d", H(8), H(10), { vehicleId: "v2" }), B("e", H(8), H(10), { status: "PENDING_APPROVAL" }), B("f", H(8), H(10), { status: "COMPLETED" })];
  assert.deepEqual(findConflicts({ vehicleId: "v1", startUtc: H(9), endUtc: H(11) }, existing).map((x) => x.id), ["a", "e"]);
  assert.deepEqual(findConflicts({ vehicleId: "v1", startUtc: H(9), endUtc: H(11) }, existing, { excludeId: "a" }).map((x) => x.id), ["e"]);
  assert.deepEqual(findConflicts({ vehicleId: null, startUtc: H(9), endUtc: H(11) }, existing), []);
  assert.deepEqual(findConflicts({ vehicleId: "v1", startUtc: H(10), endUtc: H(12) }, existing), []);
});

test("optional buffers widen the blocked interval", () => {
  const existing = [B("a", H(8), H(10), { bufferAfterMinutes: 30 })];
  assert.equal(findConflicts({ vehicleId: "v1", startUtc: H(10), endUtc: H(12) }, existing).length, 0);
  assert.equal(findConflicts({ vehicleId: "v1", startUtc: H(10), endUtc: H(12) }, existing, { useBuffers: true }).length, 1);
});

test("duplicate detection (double submit) ignores closed bookings", () => {
  const c = { vehicleId: "v1", startUtc: H(8), endUtc: H(10), requesterId: "u1", purpose: " Trip " };
  assert.equal(findDuplicates(c, [B("a", H(8), H(10))]).length, 1);
  assert.equal(findDuplicates(c, [B("a", H(8), H(10), { status: "CANCELLED" })]).length, 0);
  assert.equal(findDuplicates(c, [B("a", H(8), H(10), { requesterId: "u2" })]).length, 0);
  assert.equal(findDuplicates(c, [B("a", H(8), H(11))]).length, 0);
});

test("reconciliation after a simulated race: earlier booking wins deterministically", () => {
  // Two clients both passed the pre-check; both Adds succeeded.
  const first = B("bkg_a", H(8), H(10), { createdAt: "2026-01-01T00:00:00.000Z" });
  const second = B("bkg_b", H(9), H(11), { createdAt: "2026-01-01T00:00:01.000Z" });
  const fresh = [second, first];
  const pairs = reconcile(fresh);
  assert.equal(pairs.length, 1); assert.equal(pairs[0].winner.id, "bkg_a"); assert.equal(pairs[0].loser.id, "bkg_b");
  assert.deepEqual(checkAfterWrite("bkg_a", fresh), { status: "ok" });
  const lost = checkAfterWrite("bkg_b", fresh);
  assert.equal(lost.status, "conflict"); assert.equal(lost.with[0].id, "bkg_a");
  assert.equal(checkAfterWrite("bkg_zzz", fresh).status, "missing", "not visible yet: never assume success");
  // identical timestamps: tie broken by id
  const t1 = B("bkg_x", H(8), H(10)); const t2 = B("bkg_y", H(8), H(10));
  assert.equal(reconcile([t2, t1])[0].winner.id, "bkg_x");
  // terminal bookings do not conflict
  assert.equal(reconcile([first, B("c", H(9), H(11), { status: "CANCELLED" })]).length, 0);
  assert.match(ADVISORY_NOTE, /no atomic reservation/);
});

/*────────── record model ──────────*/
const good = () => ({
  vehicleId: "b9", vehicleNameSnapshot: "Truck 1", requesterUserId: "u1", requesterNameSnapshot: "Rina",
  driverUserId: null, driverNameSnapshot: null, startDate: "2026-03-10", startTime: "08:00", endDate: "2026-03-11", endTime: "06:00",
  startUtc: "2026-03-10T01:00:00.000Z", endUtc: "2026-03-10T23:00:00.000Z", timeZone: "Asia/Jakarta", purpose: "Site visit",
  destination: null, status: "PENDING_APPROVAL", approverId: null, approvedAt: null, rejectionReason: null,
  createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z",
});

test("booking model accepts a valid record and keeps optional driver/destination empty", () => {
  const r = parseBookingRecord(good());
  assert.equal(r.ok, true); assert.equal(r.booking.driverUserId, null); assert.equal(r.booking.destination, null);
  assert.equal(parseBookingRecord({ ...good(), driverUserId: "d1", driverNameSnapshot: "Dina" }).ok, true);
  assert.equal(parseBookingRecord({ ...good(), timeZone: undefined }).booking.timeZone, "Asia/Jakarta");
});

test("booking model rejects malformed records", () => {
  const cases = [["vehicleId", ""], ["vehicleNameSnapshot", undefined], ["requesterUserId", null], ["purpose", "  "], ["purpose", "x".repeat(501)],
    ["status", "DONE"], ["startUtc", "2026-03-10"], ["endUtc", "2026-03-10T00:00:00.000Z"], ["timeZone", "Mars/Base"], ["startTime", "8:00"],
    ["driverUserId", "d1"], ["driverNameSnapshot", "Dina"], ["destination", 5], ["approvedAt", "yesterday"]];
  for (const [k, v] of cases) assert.equal(parseBookingRecord({ ...good(), [k]: v }).ok, false, `${k}=${v}`);
  for (const bad of [null, [], "x", 5]) assert.equal(parseBookingRecord(bad).ok, false);
});

test("booking model enforces status-dependent fields and rules", () => {
  assert.equal(parseBookingRecord({ ...good(), status: "REJECTED" }).ok, false, "rejection needs reason");
  assert.equal(parseBookingRecord({ ...good(), status: "REJECTED", rejectionReason: "no" }).ok, true);
  assert.equal(parseBookingRecord({ ...good(), status: "APPROVED" }).ok, false, "approval needs approver");
  assert.equal(parseBookingRecord({ ...good(), status: "APPROVED", approverId: "a1", approvedAt: "2026-03-02T00:00:00.000Z" }).ok, true);
  assert.equal(parseBookingRecord({ ...good(), status: "APPROVED", approverId: "u1", approvedAt: "2026-03-02T00:00:00.000Z" }).ok, false, "self-approved record");
  assert.equal(parseBookingRecord(good(), { destinationRequired: true }).ok, false);
  assert.equal(parseBookingRecord({ ...good(), destination: "Site A" }, { destinationRequired: true }).ok, true);
});

/*────────── search / visibility ──────────*/
test("filter, search and visibility", () => {
  const mk = (id, over) => ({ id, status: "APPROVED", vehicleId: "v1", vehicleNameSnapshot: "Toyota Fortuner", requesterUserId: "u1", requesterNameSnapshot: "Rina", purpose: "Client visit", destination: "Bandung", startUtc: H(8), endUtc: H(10), ...over });
  const items = [mk("1"), mk("2", { status: "REJECTED", requesterUserId: "u2", requesterNameSnapshot: "Budi", destination: null }), mk("3", { vehicleId: "v2", startUtc: H(12), endUtc: H(14), purpose: "Delivery" })];
  assert.deepEqual(filterBookings(items, { statuses: ["REJECTED"] }).map((x) => x.id), ["2"]);
  assert.deepEqual(filterBookings(items, { vehicleId: "v2" }).map((x) => x.id), ["3"]);
  assert.deepEqual(filterBookings(items, { text: "BANDUNG" }).map((x) => x.id), ["1", "3"]);
  assert.deepEqual(filterBookings(items, { text: "budi" }).map((x) => x.id), ["2"]);
  assert.deepEqual(filterBookings(items, { fromUtc: H(10), toUtc: H(13) }).map((x) => x.id), ["3"]);
  assert.deepEqual(filterBookings(items, {}).length, 3);
  assert.deepEqual(visibleBookings(items, "u2", false).map((x) => x.id), ["2"]);
  assert.equal(visibleBookings(items, "u2", true).length, 3);
  assert.equal(visibleBookings(items, null, true).length, 0);
});

/*────────── native provider enforcement (mock api) ──────────*/
function seeded(requesterId, status = "PENDING_APPROVAL") {
  const api = createMockApi({ addInData: [] });
  api.rows = [{ id: "s1", addInId: "x", details: {
    id: "bk1", deviceId: "d1", requesterUserId: requesterId, requestedClass: "X", startAt: H(8), endAt: H(10), bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
    purpose: "trip", destination: null, passengerCount: null, status, assignedDriverUserId: null, approverId: null, approvalRemarks: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 } }];
  const orig = api.call;
  api.call = (m, p, ok, err) => {
    if (m === "Get" && p.typeName === "AddInData") { api.calls.push({ method: m, typeName: "AddInData", params: p }); return ok(api.rows.map((r) => ({ ...r, addInId: p.search.addInId }))); }
    if (m === "Set") { api.calls.push({ method: m, typeName: "AddInData", params: p }); api.rows[0].details = p.entity.details; return ok(null); }
    return orig(m, p, ok, err);
  };
  return api;
}
const rt = (api, role) => createNativeRuntime({ api, gate: createCapabilityGate(ALL_TRUE), allowlist: MOCK_ALLOWLIST, roleMapping: roleMap(role) });
const sets = (api) => api.calls.filter((c) => c.method === "Set").length;

test("native provider: approver approves another user's booking once; duplicate is a no-op", async () => {
  const api = seeded("req1");
  const r = await rt(api, "approver");
  await r.provider.updateBookingStatus("bk1", "APPROVED", "b1");
  assert.equal(sets(api), 1);
  await r.provider.updateBookingStatus("bk1", "APPROVED", "b1");
  assert.equal(sets(api), 1, "duplicate approve produced no second write");
});

test("native provider: self-approval, invalid transition, missing reason and spoofed approver are denied before any Set", async () => {
  const own = seeded("b1"); const ro = await rt(own, "administrator");
  await assert.rejects(ro.provider.updateBookingStatus("bk1", "APPROVED", "b1"), /PERMISSION_DENIED/);
  const api = seeded("req1"); const r = await rt(api, "approver");
  await assert.rejects(r.provider.updateBookingStatus("bk1", "COMPLETED", "b1"), /INVALID_TRANSITION/);
  await assert.rejects(r.provider.updateBookingStatus("bk1", "REJECTED", "b1", ""), /REASON_REQUIRED/);
  await assert.rejects(r.provider.updateBookingStatus("bk1", "APPROVED", "someone-else"), /authenticated user/);
  const done = seeded("req1", "COMPLETED"); const rd = await rt(done, "administrator");
  await assert.rejects(rd.provider.updateBookingStatus("bk1", "APPROVED", "b1"), /TERMINAL_STATUS/);
  for (const a of [own, api, done]) assert.equal(sets(a), 0);
  await r.provider.updateBookingStatus("bk1", "REJECTED", "b1", "No vehicle available");
  assert.equal(sets(api), 1);
});

test("native provider: a requester role cannot approve (denied before any API call)", async () => {
  const api = seeded("req1"); const r = await rt(api, "requester");
  const before = api.calls.length;
  await assert.rejects(r.provider.updateBookingStatus("bk1", "APPROVED", "b1"), (e) => e.name === "CapabilityDeniedError");
  assert.equal(api.calls.length, before);
});
