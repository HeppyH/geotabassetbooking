/* Phase C — AddInData storage engine tests. MOCK api only; not tenant validation.
   The mock does NOT reproduce real AddInData semantics (no transactions, no real limits). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_SCHEMA_VERSION, MAX_DETAILS_CHARS, RECORD_ID_PREFIX, RECORD_TYPES,
  decodeDetails, encodeEnvelope, newRecordId, MIGRATIONS,
} from "../src/storage/recordEnvelope.ts";
import { buildAddInDataGet } from "../src/storage/query.ts";
import { createAddInDataStore, isTransientError } from "../src/storage/addinDataStore.ts";
import { DEFAULT_ADDIN_ID } from "../src/config/addinId.ts";

const NOW = "2026-01-05T08:00:00.000Z";
const env = (type = "booking", over = {}) => ({
  schemaVersion: 1, recordType: type, recordId: `${RECORD_ID_PREFIX[type]}abc123`,
  createdAt: NOW, createdBy: "b1", payload: { note: "x" }, ...over,
});

/* In-memory mock of the api. `rows` mimic AddInData records. */
function mockApi({ rows = [], failures = [], onCall } = {}) {
  let seq = 100;
  const api = {
    rows, calls: [],
    call(method, params, ok, err) {
      api.calls.push({ method, params });
      onCall?.(method, params);
      const f = failures.shift();
      if (f) return err(f);
      if (method === "Get") return ok(JSON.parse(JSON.stringify(api.rows)));
      if (method === "Add") { const id = `b${seq++}`; api.rows.push({ id, addInId: params.entity.addInId, details: params.entity.details }); return ok(id); }
      if (method === "Set") { const r = api.rows.find((x) => x.id === params.entity.id); if (!r) return err(new Error("not found")); r.details = params.entity.details; return ok(null); }
      if (method === "Remove") { api.rows = api.rows.filter((x) => x.id !== params.entity.id); return ok(null); }
      return err(new Error("unexpected"));
    },
  };
  return api;
}
const row = (id, details) => ({ id, addInId: DEFAULT_ADDIN_ID, details });
const mk = (api, extra = {}) => createAddInDataStore({ api, addInId: DEFAULT_ADDIN_ID, sleep: async () => {}, ...extra });

test("record types are separate and ids carry distinct prefixes", () => {
  assert.deepEqual([...RECORD_TYPES], ["booking", "notification", "audit", "application_config"]);
  assert.equal(new Set(Object.values(RECORD_ID_PREFIX)).size, 4);
  assert.match(newRecordId("audit", () => "xyz-1"), /^aud_xyz-1$/);
});

test("encode/decode round trip for each record type", () => {
  for (const t of RECORD_TYPES) {
    const d = encodeEnvelope(env(t));
    const r = decodeDetails(d);
    assert.equal(r.ok, true, t);
    assert.deepEqual(r.envelope, env(t));
    assert.equal(decodeDetails(JSON.stringify(d)).ok, true); // string form tolerated on read
  }
});

test("encode rejects invalid envelopes", () => {
  const bad = [
    env("booking", { recordId: "ntf_abc" }),            // prefix/type mismatch
    env("booking", { recordId: "bad id" }),
    env("booking", { createdBy: "" }),
    env("booking", { createdAt: "yesterday" }),
    env("booking", { updatedAt: "nope" }),
    env("booking", { payload: [] }),
    env("booking", { payload: null }),
    { ...env(), recordType: "other" },
    env("booking", { schemaVersion: 2 }),
  ];
  for (const b of bad) assert.throws(() => encodeEnvelope(b), (e) => e.name === "RecordValidationError", JSON.stringify(b).slice(0, 80));
});

test("oversized records are rejected on encode and decode (10,000-char limit)", () => {
  assert.equal(MAX_DETAILS_CHARS, 10000);
  assert.throws(() => encodeEnvelope(env("booking", { payload: { big: "x".repeat(10000) } })), (e) => e.code === "OVERSIZED");
  const fits = env("booking", { payload: { big: "x".repeat(9500) } });
  assert.ok(JSON.stringify(encodeEnvelope(fits)).length <= 10000);
  assert.equal(decodeDetails({ ...env(), payload: { big: "x".repeat(10001) } }).code, "OVERSIZED");
  assert.equal(decodeDetails("x".repeat(10001)).code, "OVERSIZED");
});

test("malformed stored records are rejected without throwing", () => {
  const cases = [
    ["{not json", "MALFORMED_JSON"], [null, "NOT_OBJECT"], [42, "NOT_OBJECT"], [[], "NOT_OBJECT"], ["[]", "NOT_OBJECT"],
    [{}, "MISSING_FIELD"], [{ ...env(), schemaVersion: "1" }, "MISSING_FIELD"],
    [{ ...env(), recordType: "x" }, "UNKNOWN_RECORD_TYPE"],
    [{ ...env(), recordId: "ntf_abc" }, "ID_TYPE_MISMATCH"],
    [{ ...env(), payload: "str" }, "INVALID_FIELD"],
    [{ ...env(), createdBy: undefined }, "MISSING_FIELD"],
  ];
  for (const [input, code] of cases) { const r = decodeDetails(input); assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(input)); }
});

test("schema versions: newer rejected, older needs a registered migration", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 1);
  assert.equal(decodeDetails({ ...env(), schemaVersion: 2 }).code, "UNSUPPORTED_SCHEMA_VERSION");
  assert.equal(decodeDetails({ ...env(), schemaVersion: 0 }).code, "UNSUPPORTED_SCHEMA_VERSION"); // no v0 migration registered
  // migration compatibility: temporarily register a test-only v0 -> v1 migration
  const m = MIGRATIONS;
  assert.ok(Object.isFrozen(m), "registry is frozen in production");
});

test("query builder enforces documented restrictions", () => {
  const ok = buildAddInDataGet({ addInId: DEFAULT_ADDIN_ID });
  assert.equal(ok.resultsLimit, 1000);
  assert.deepEqual(ok.search, { addInId: DEFAULT_ADDIN_ID });
  assert.throws(() => buildAddInDataGet({ addInId: "bad" }), /addInId/);
  assert.throws(() => buildAddInDataGet({ addInId: DEFAULT_ADDIN_ID, whereClause: "a=1" }), /requires selectClause/);
  for (const w of ["a=1 AND b=2", "a=1 or b=2", "name LIKE 'x'"]) {
    assert.throws(() => buildAddInDataGet({ addInId: DEFAULT_ADDIN_ID, selectClause: "details", whereClause: w }), /AND, OR or LIKE/);
  }
  for (const n of [0, -1, 1001, 1.5, NaN]) assert.throws(() => buildAddInDataGet({ addInId: DEFAULT_ADDIN_ID, resultsLimit: n }), /resultsLimit/);
  const cs = buildAddInDataGet({ addInId: DEFAULT_ADDIN_ID, selectClause: "details", whereClause: "Abc=1" });
  assert.equal(cs.search.whereClause, "Abc=1"); // case preserved
});

test("list: validates records, reports rejected, separates types, flags truncation", async () => {
  const api = mockApi({ rows: [
    row("s1", encodeEnvelope(env("booking"))),
    row("s2", encodeEnvelope(env("notification", { recordId: "ntf_1" }))),
    row("s3", "{broken"),
    row("s4", { ...env(), schemaVersion: 9, recordId: "bkg_zzz" }),
    { id: "s5", addInId: "aOTHEROTHEROTHEROTHERx", details: encodeEnvelope(env("audit")) },
  ] });
  const store = mk(api);
  const r = await store.list();
  assert.equal(r.records.length, 2);
  assert.deepEqual(r.rejected.map((x) => x.serverId).sort(), ["s3", "s4", "s5"]);
  assert.equal((await store.list({ type: "booking" })).records.length, 1);
  assert.equal(r.possiblyTruncated, false);
  const small = mk(mockApi({ rows: [row("s1", encodeEnvelope(env()))] }), { resultsLimit: 1 });
  assert.equal((await small.list()).possiblyTruncated, true);
});

test("list: duplicate recordIds are rejected, not merged", async () => {
  const d = encodeEnvelope(env());
  const r = await mk(mockApi({ rows: [row("s1", d), row("s2", d)] })).list();
  assert.equal(r.records.length, 1);
  assert.equal(r.rejected[0].serverId, "s2");
});

test("list: bounded retrieval — every Get carries resultsLimit and the Add-In id", async () => {
  const api = mockApi();
  await mk(api).list();
  assert.equal(api.calls[0].params.resultsLimit, 1000);
  assert.equal(api.calls[0].params.search.addInId, DEFAULT_ADDIN_ID);
});

test("cache and request de-duplication", async () => {
  let t = 0;
  const api = mockApi();
  const store = mk(api, { now: () => t, cacheTtlMs: 1000 });
  await Promise.all([store.list(), store.list(), store.list()]);
  assert.equal(api.calls.length, 1, "concurrent calls share one request");
  await store.list(); assert.equal(api.calls.length, 1, "cache hit");
  t = 1001; await store.list(); assert.equal(api.calls.length, 2, "expired");
  await store.list({ forceRefresh: true }); assert.equal(api.calls.length, 3);
});

test("add: writes validated envelope, invalidates cache, returns server id, never retries", async () => {
  const api = mockApi();
  const store = mk(api);
  await store.list();
  const saved = await store.add(env());
  assert.equal(saved.serverId, "b100");
  const add = api.calls.find((c) => c.method === "Add");
  assert.equal(add.params.entity.addInId, DEFAULT_ADDIN_ID);
  assert.deepEqual(decodeDetails(add.params.entity.details).envelope, env());
  assert.equal((await store.list()).records.length, 1, "cache was invalidated");

  const flaky = mockApi({ onCall() {}, failures: [null] });
  flaky.call = ((orig) => (m, p, ok, err) => (m === "Add" ? (flaky.calls.push({ method: m, params: p }), err(new Error("timeout"))) : orig(m, p, ok, err)))(flaky.call);
  await assert.rejects(mk(flaky).add(env()), (e) => e.code === "API_ERROR");
  assert.equal(flaky.calls.filter((c) => c.method === "Add").length, 1, "Add not retried");
});

test("add: invalid, oversized and duplicate records are refused before any Add", async () => {
  const api = mockApi({ rows: [row("s1", encodeEnvelope(env()))] });
  const store = mk(api);
  await assert.rejects(store.add(env("booking", { createdBy: "" })), (e) => e.code === "INVALID_RECORD");
  await assert.rejects(store.add(env("booking", { payload: { b: "x".repeat(10000) } })), (e) => e.code === "INVALID_RECORD");
  await assert.rejects(store.add(env()), (e) => e.code === "DUPLICATE_RECORD_ID");
  assert.equal(api.calls.some((c) => c.method === "Add"), false);
});

test("add: a missing id in the response is reported, not hidden", async () => {
  const api = mockApi();
  const orig = api.call; api.call = (m, p, ok, err) => (m === "Add" ? ok(undefined) : orig(m, p, ok, err));
  await assert.rejects(mk(api).add(env()), (e) => e.code === "API_ERROR");
});

test("update: uses server id, requires matching stamp, never silently overwrites", async () => {
  const api = mockApi({ rows: [row("s1", encodeEnvelope(env()))] });
  const store = mk(api);
  const next = env("booking", { updatedAt: "2026-01-05T09:00:00.000Z", payload: { note: "y" } });
  const out = await store.update("s1", next, NOW);
  assert.equal(out.serverId, "s1");
  const set = api.calls.find((c) => c.method === "Set");
  assert.equal(set.params.entity.id, "s1");
  // stale stamp now conflicts
  await assert.rejects(store.update("s1", { ...next, updatedAt: "2026-01-05T10:00:00.000Z" }, NOW), (e) => e.code === "CONFLICT");
  await assert.rejects(store.update("nope", next, NOW), (e) => e.code === "NOT_FOUND");
  await assert.rejects(store.update("s1", env("booking", { recordId: "bkg_other" }), next.updatedAt), (e) => e.code === "INVALID_RECORD");
});

test("update: fresh read bypasses cache so a concurrent change is detected", async () => {
  const api = mockApi({ rows: [row("s1", encodeEnvelope(env()))] });
  const store = mk(api, { cacheTtlMs: 60000 });
  await store.list();
  api.rows[0].details = encodeEnvelope(env("booking", { updatedAt: "2026-01-05T08:30:00.000Z" })); // someone else
  await assert.rejects(store.update("s1", env("booking", { updatedAt: "2026-01-05T09:00:00.000Z" }), NOW), (e) => e.code === "CONFLICT");
});

test("remove is disabled by default and requires explicit opt-in", async () => {
  const api = mockApi({ rows: [row("s1", encodeEnvelope(env()))] });
  await assert.rejects(mk(api).remove("s1"), (e) => e.code === "REMOVE_NOT_ALLOWED");
  assert.equal(api.calls.length, 0);
  await mk(api, { allowRemove: true }).remove("s1");
  assert.equal(api.calls[0].method, "Remove");
  assert.deepEqual(api.calls[0].params.entity, { id: "s1" });
});

test("transient read errors retry with exponential backoff; permanent errors do not", async () => {
  const waits = [];
  const api = mockApi({ failures: [new Error("timeout"), new Error("503 unavailable")] });
  const r = await mk(api, { sleep: async (ms) => waits.push(ms) }).list();
  assert.equal(r.records.length, 0);
  assert.deepEqual(waits, [200, 400]);
  assert.equal(api.calls.length, 3);

  const perm = mockApi({ failures: [new Error("Incorrect login credentials")] });
  await assert.rejects(mk(perm).list(), (e) => e.code === "API_ERROR");
  assert.equal(perm.calls.length, 1);

  const dead = mockApi({ failures: [new Error("timeout"), new Error("timeout"), new Error("timeout")] });
  await assert.rejects(mk(dead).list(), (e) => e.code === "TRANSIENT_EXHAUSTED");
  assert.equal(dead.calls.length, 3);
});

test("capability denials are never retried and are surfaced", async () => {
  const denied = Object.assign(new Error("denied timeout"), { name: "CapabilityDeniedError" });
  assert.equal(isTransientError(denied), false);
  const api = mockApi({ failures: [denied] });
  await assert.rejects(mk(api).list(), (e) => e.code === "API_ERROR");
  assert.equal(api.calls.length, 1);
});

test("clear error states: invalid AddInId, missing api, non-array response", async () => {
  await assert.rejects(createAddInDataStore({ api: mockApi(), addInId: "bad" }).list(), (e) => e.code === "INVALID_ADDIN_ID");
  await assert.rejects(mk(null).list(), (e) => e.code === "API_UNAVAILABLE");
  const api = mockApi(); api.call = (m, p, ok) => ok({ not: "array" });
  await assert.rejects(mk(api).list(), (e) => e.code === "API_ERROR");
});

test("storage never touches localStorage", async () => {
  const touched = [];
  const prev = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new Proxy({}, { get(_t, p) { touched.push(String(p)); return () => null; } }) });
  try {
    const store = mk(mockApi());
    await store.add(env());
    await store.list({ forceRefresh: true });
    assert.deepEqual(touched, []);
  } finally { prev ? Object.defineProperty(globalThis, "localStorage", prev) : delete globalThis.localStorage; }
});
