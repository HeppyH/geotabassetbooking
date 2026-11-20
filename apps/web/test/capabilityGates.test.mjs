/* Phase B — central capability gate tests. UNIT tests with injected configurations.
   They prove gate logic only; they are not tenant validation. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_NAMES,
  CAPABILITY_PREREQUISITES,
  DEFAULT_CAPABILITIES,
  PRODUCTION_CAPABILITY_CONFIG,
  createCapabilityGate,
  getProductionCapabilityGate,
  CapabilityDeniedError,
} from "../src/runtime/capabilities.ts";
import { ALL_TRUE } from "./helpers/mockGeotab.mjs";

const SIX = [
  "MYGEOTAB_IDENTITY_ENABLED",
  "MYGEOTAB_STORAGE_ENABLED",
  "LIVE_BOOKING_READ_ENABLED",
  "LIVE_BOOKING_WRITE_ENABLED",
  "APPROVAL_ACTIONS_ENABLED",
  "ADMIN_CONFIGURATION_ENABLED",
];

test("the six required capabilities are exactly the defined gate names", () => {
  assert.deepEqual([...CAPABILITY_NAMES].sort(), [...SIX].sort());
});

test("all six capability defaults are false and frozen", () => {
  for (const name of SIX) assert.equal(DEFAULT_CAPABILITIES[name], false, name);
  assert.ok(Object.isFrozen(DEFAULT_CAPABILITIES));
});

test("production configuration has every capability false", () => {
  for (const name of SIX) assert.equal(PRODUCTION_CAPABILITY_CONFIG[name], false, name);
  assert.ok(Object.isFrozen(PRODUCTION_CAPABILITY_CONFIG));
});

test("production gate denies every capability, even with an approved tenant", () => {
  const gate = getProductionCapabilityGate();
  for (const name of SIX) {
    assert.equal(gate.isFlagEnabled(name), false, name);
    const decision = gate.evaluate(name, true);
    assert.equal(decision.allowed, false, name);
    assert.equal(decision.code, "CAPABILITY_DISABLED", name);
  }
});

test("missing capability configuration is denied", () => {
  for (const input of [undefined, null]) {
    const gate = createCapabilityGate(input);
    assert.deepEqual(gate.issues, [{ issue: "CONFIG_MISSING" }]);
    for (const name of SIX) assert.equal(gate.evaluate(name, true).allowed, false, name);
  }
});

test("malformed (non-object) capability configuration is denied", () => {
  for (const input of ["true", 1, true, [], [true, true]]) {
    const gate = createCapabilityGate(input);
    assert.deepEqual(gate.issues, [{ issue: "CONFIG_NOT_OBJECT" }]);
    for (const name of SIX) assert.equal(gate.evaluate(name, true).allowed, false, name);
  }
});

test("only the boolean literal true enables a capability", () => {
  for (const bad of ["true", "TRUE", "1", 1, "yes", {}, [], () => true, null, undefined, NaN]) {
    const gate = createCapabilityGate({ ...ALL_TRUE, MYGEOTAB_IDENTITY_ENABLED: bad });
    assert.equal(gate.isFlagEnabled("MYGEOTAB_IDENTITY_ENABLED"), false, String(bad));
    // dependants fail closed too
    assert.equal(gate.isFlagEnabled("MYGEOTAB_STORAGE_ENABLED"), false, String(bad));
  }
});

test("unknown configuration keys are ignored, recorded, and cannot enable anything", () => {
  const gate = createCapabilityGate({ SOMETHING_ELSE: true, ADMIN: true });
  assert.equal(gate.issues.filter((i) => i.issue === "UNKNOWN_KEY").length, 2);
  for (const name of SIX) assert.equal(gate.isFlagEnabled(name), false, name);
});

test("inherited (prototype) values cannot enable a capability", () => {
  const polluted = Object.create({ ...ALL_TRUE });
  const gate = createCapabilityGate(polluted);
  for (const name of SIX) assert.equal(gate.isFlagEnabled(name), false, name);
});

test("unknown capability names are denied", () => {
  const gate = createCapabilityGate(ALL_TRUE);
  for (const name of ["", "ADMIN", "constructor", "__proto__", undefined, null, 42]) {
    const decision = gate.evaluate(name, true);
    assert.equal(decision.allowed, false, String(name));
    assert.equal(decision.code, "CAPABILITY_UNKNOWN", String(name));
  }
});

test("each gate: disabled state is denied", () => {
  for (const name of SIX) {
    const gate = createCapabilityGate({ ...ALL_TRUE, [name]: false });
    const decision = gate.evaluate(name, true);
    assert.equal(decision.allowed, false, name);
    assert.equal(decision.code, "CAPABILITY_DISABLED", name);
  }
});

test("each gate: enabled with prerequisites and an approved tenant is allowed", () => {
  for (const name of SIX) {
    const cfg = { ...DEFAULT_CAPABILITIES, [name]: true };
    for (const p of CAPABILITY_PREREQUISITES[name]) cfg[p] = true;
    const gate = createCapabilityGate(cfg);
    const decision = gate.evaluate(name, true);
    assert.equal(decision.allowed, true, name);
  }
});

test("each gate: enabled but a prerequisite disabled is denied", () => {
  for (const name of SIX) {
    for (const prerequisite of CAPABILITY_PREREQUISITES[name]) {
      const cfg = { ...ALL_TRUE, [prerequisite]: false };
      const decision = createCapabilityGate(cfg).evaluate(name, true);
      assert.equal(decision.allowed, false, `${name} without ${prerequisite}`);
      assert.equal(decision.code, "CAPABILITY_PREREQUISITE_DISABLED", `${name} without ${prerequisite}`);
    }
  }
});

test("each gate: enabled but tenant not approved is denied", () => {
  const gate = createCapabilityGate(ALL_TRUE);
  for (const name of SIX) {
    for (const approved of [false, undefined, null, "true", 1]) {
      const decision = gate.evaluate(name, approved);
      assert.equal(decision.allowed, false, `${name} approved=${String(approved)}`);
      assert.equal(decision.code, "TENANT_NOT_APPROVED");
    }
  }
});

test("a gate configuration cannot be mutated after creation", () => {
  const input = { ...ALL_TRUE, LIVE_BOOKING_WRITE_ENABLED: false };
  const gate = createCapabilityGate(input);
  input.LIVE_BOOKING_WRITE_ENABLED = true; // caller mutates its own object
  assert.equal(gate.isFlagEnabled("LIVE_BOOKING_WRITE_ENABLED"), false);
  assert.throws(() => {
    "use strict";
    gate.snapshot().LIVE_BOOKING_WRITE_ENABLED = true;
  });
});

test("CapabilityDeniedError carries code and capability", () => {
  const decision = createCapabilityGate({}).evaluate("LIVE_BOOKING_WRITE_ENABLED", true);
  const err = new CapabilityDeniedError(decision);
  assert.equal(err.name, "CapabilityDeniedError");
  assert.equal(err.code, "CAPABILITY_DISABLED");
  assert.equal(err.capability, "LIVE_BOOKING_WRITE_ENABLED");
});

test("no environment, storage or URL value can enable a production capability", async () => {
  const saved = {};
  for (const name of SIX) {
    saved[name] = process.env[name];
    process.env[name] = "true";
    process.env[`VITE_${name}`] = "true";
  }
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: () => "true", setItem() {}, removeItem() {} },
    configurable: true,
    writable: true,
  });
  try {
    // Fresh module instance so no cached gate can mask an override.
    const fresh = await import(`../src/runtime/capabilities.ts?fresh=${Date.now()}`);
    const gate = fresh.getProductionCapabilityGate();
    for (const name of SIX) {
      assert.equal(gate.isFlagEnabled(name), false, name);
      assert.equal(fresh.PRODUCTION_CAPABILITY_CONFIG[name], false, name);
    }
  } finally {
    for (const name of SIX) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
      delete process.env[`VITE_${name}`];
    }
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  }
});
