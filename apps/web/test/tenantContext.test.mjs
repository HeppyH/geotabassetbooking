/* Phase B — tenant context validation tests (UNIT, mock inputs only). */
import test from "node:test";
import assert from "node:assert/strict";
import { APPROVED_TENANT_CONTEXTS, validateTenantContext } from "../src/runtime/tenantContext.ts";

const allow = [{ database: "mock_tenant_a" }, { database: "mock_tenant_b", server: "my.example.test" }];

test("the approved tenant allowlist is empty and frozen", () => {
  assert.equal(APPROVED_TENANT_CONTEXTS.length, 0);
  assert.ok(Object.isFrozen(APPROVED_TENANT_CONTEXTS));
  assert.throws(() => {
    "use strict";
    APPROVED_TENANT_CONTEXTS.push({ database: "x" });
  });
});

test("with the real (empty) allowlist, every well-formed tenant is denied", () => {
  for (const db of ["mock_tenant_a", "opex_trial", "demo_database"]) {
    const r = validateTenantContext({ database: db });
    assert.equal(r.ok, false, db);
    assert.equal(r.code, "TENANT_ALLOWLIST_EMPTY", db);
  }
});

test("missing tenant context is rejected", () => {
  for (const ctx of [undefined, null]) {
    const r = validateTenantContext(ctx, allow);
    assert.equal(r.ok, false);
    assert.equal(r.code, "TENANT_CONTEXT_MISSING");
  }
});

test("invalid tenant context is rejected", () => {
  const invalid = [
    "mock_tenant_a",
    42,
    [],
    {},
    { database: "" },
    { database: "   " },
    { database: 123 },
    { database: "has space" },
    { database: "a".repeat(101) },
    { database: "x;DROP TABLE" },
    { database: "../etc" },
    { database: "mock_tenant_a", server: 5 },
    { database: "mock_tenant_a", server: "bad host!" },
    { database: "mock_tenant_a", server: "-leading.example" },
  ];
  for (const ctx of invalid) {
    const r = validateTenantContext(ctx, allow);
    assert.equal(r.ok, false, JSON.stringify(ctx));
    assert.equal(r.code, "TENANT_CONTEXT_INVALID", JSON.stringify(ctx));
  }
});

test("unknown tenant is rejected", () => {
  const r = validateTenantContext({ database: "other_tenant" }, allow);
  assert.equal(r.ok, false);
  assert.equal(r.code, "TENANT_NOT_APPROVED");
});

test("matching is exact and case-sensitive", () => {
  for (const db of ["MOCK_TENANT_A", "Mock_Tenant_A", "mock_tenant_a "]) {
    const r = validateTenantContext({ database: db }, allow);
    assert.equal(r.ok, false, db);
  }
});

test("an approved tenant is accepted (mock allowlist)", () => {
  const r = validateTenantContext({ database: "mock_tenant_a", server: "anything.example.test" }, allow);
  assert.equal(r.ok, true);
  assert.equal(r.tenant.database, "mock_tenant_a");
});

test("an allowlist entry that names a server requires that server", () => {
  assert.equal(validateTenantContext({ database: "mock_tenant_b" }, allow).ok, false);
  assert.equal(validateTenantContext({ database: "mock_tenant_b", server: "other.example.test" }, allow).ok, false);
  assert.equal(validateTenantContext({ database: "mock_tenant_b", server: "my.example.test" }, allow).ok, true);
});

test("an unreadable allowlist denies everything", () => {
  for (const list of [null, undefined === 1, "mock_tenant_a", { database: "mock_tenant_a" }]) {
    const r = validateTenantContext({ database: "mock_tenant_a" }, list);
    assert.equal(r.ok, false);
    assert.equal(r.code, "TENANT_ALLOWLIST_INVALID");
  }
});

test("a malformed allowlist entry denies everything, even if another entry matches", () => {
  const r = validateTenantContext({ database: "mock_tenant_a" }, [{ database: "mock_tenant_a" }, { database: "bad entry!" }]);
  assert.equal(r.ok, false);
  assert.equal(r.code, "TENANT_ALLOWLIST_INVALID");
});
