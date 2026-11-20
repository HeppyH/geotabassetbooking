/* Test helper: isolated MOCK of the MyGeotab Add-In `api` object.
   MOCK ONLY. Nothing here talks to MyGeotab. Responses are invented fixtures and are not
   evidence of real MyGeotab behaviour. */

export const VALID_DATABASE = "mock_tenant_a";

export function createMockApi(options = {}) {
  const {
    session = { userName: "tester@example.test", database: VALID_DATABASE, server: "my.example.test" },
    sessions = null, // optional list returned successively by getSession
    users = [{ id: "b1", name: "tester@example.test", firstName: "Test", lastName: "User" }],
    devices = [],
    groups = [],
    addInData = [],
    failCalls = false,
  } = options;

  const api = {
    calls: [],
    sessionCalls: 0,
    call(method, params, success, error) {
      api.calls.push({ method, typeName: params?.typeName, params });
      if (failCalls) {
        error?.(new Error("MOCK_API_FAILURE"));
        return;
      }
      if (method === "Get") {
        const t = params?.typeName;
        if (t === "User") return success(users);
        if (t === "Device") return success(devices);
        if (t === "Group") return success(groups);
        if (t === "AddInData") return success(addInData);
        return success([]);
      }
      if (method === "Add") return success("mockRecordId");
      return success(null);
    },
    getSession(callback) {
      const index = api.sessionCalls++;
      const value = sessions ? sessions[Math.min(index, sessions.length - 1)] : session;
      callback(value);
    },
  };
  return api;
}

export const ALL_TRUE = Object.freeze({
  MYGEOTAB_IDENTITY_ENABLED: true,
  MYGEOTAB_STORAGE_ENABLED: true,
  LIVE_BOOKING_READ_ENABLED: true,
  LIVE_BOOKING_WRITE_ENABLED: true,
  APPROVAL_ACTIONS_ENABLED: true,
  ADMIN_CONFIGURATION_ENABLED: true,
});

export const MOCK_ALLOWLIST = Object.freeze([{ database: VALID_DATABASE }]);

/** A storage spy that records ANY access. Used to prove native paths never touch localStorage. */
export function installStorageSpy() {
  const accessed = [];
  const handler = {
    get(_t, prop) {
      accessed.push(String(prop));
      return () => null;
    },
    set(_t, prop) {
      accessed.push(String(prop));
      return true;
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: new Proxy({}, handler), configurable: true, writable: true });
  return {
    accessed,
    restore() {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else delete globalThis.localStorage;
    },
  };
}

export function rejectsWithCode(promise, code) {
  return promise.then(
    () => {
      throw new Error("Expected rejection but promise resolved");
    },
    (e) => {
      if (e?.name !== "CapabilityDeniedError") throw new Error(`Expected CapabilityDeniedError, got ${e?.name}: ${e?.message}`);
      if (code && e.code !== code) throw new Error(`Expected code ${code}, got ${e.code}`);
      return e;
    },
  );
}

/** Mock OPEX role mappings keyed to the mock user id "b1". Fixtures only. */
export const roleMap = (role) => ({ updatedBy: "mock_admin", entries: [{ userId: "b1", role }] });
