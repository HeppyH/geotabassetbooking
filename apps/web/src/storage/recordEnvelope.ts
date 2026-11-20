/*───────────────────── AddInData Record Envelope (Phase C) ─────────────────────
 * Every OPEX record stored in AddInData is wrapped in one versioned envelope:
 *   { schemaVersion, recordType, recordId, createdAt, updatedAt?, createdBy, payload }
 * Record types are separate (booking | notification | audit | application_config) and their
 * ids carry a type prefix, so a booking id can never be mistaken for a notification/audit id
 * (Phase A finding F-04).
 *
 * Contract notes (see docs/mygeotab-native/phase-c/):
 *  - AddInData `details` limit: 10,000 serialized characters (documented). Enforced on encode.
 *  - Whether `details` is best stored as an object or a JSON string is UNVERIFIED against a
 *    tenant. The writer emits an object (as the existing provider does); the reader accepts an
 *    object or a JSON string.
 *  - Pure module: no MyGeotab access, no storage, no imports.
 */

export const RECORD_TYPES = ["booking", "notification", "audit", "application_config"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_DETAILS_CHARS = 10000;

export const RECORD_ID_PREFIX: Readonly<Record<RecordType, string>> = Object.freeze({
  booking: "bkg_",
  notification: "ntf_",
  audit: "aud_",
  application_config: "cfg_",
});

const RECORD_ID_PATTERN = /^[a-z]{3}_[A-Za-z0-9_-]{1,60}$/;

export interface RecordEnvelope {
  schemaVersion: number;
  recordType: RecordType;
  recordId: string;
  createdAt: string;
  updatedAt?: string;
  createdBy: string;
  payload: Record<string, unknown>;
}

export type DecodeFailureCode =
  | "MALFORMED_JSON"
  | "NOT_OBJECT"
  | "MISSING_FIELD"
  | "INVALID_FIELD"
  | "UNKNOWN_RECORD_TYPE"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "ID_TYPE_MISMATCH"
  | "OVERSIZED";

export type DecodeResult =
  | { ok: true; envelope: RecordEnvelope; migrated: boolean }
  | { ok: false; code: DecodeFailureCode; reason: string };

export class RecordValidationError extends Error {
  readonly code: DecodeFailureCode;
  constructor(code: DecodeFailureCode, reason: string) {
    super(`${code}: ${reason}`);
    this.name = "RecordValidationError";
    this.code = code;
  }
}

/** Migration from schema version N to N+1. Keyed by the *source* version. */
export type Migration = (envelope: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isIsoTimestamp(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 20 || v.length > 30) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

export function isRecordType(v: unknown): v is RecordType {
  return typeof v === "string" && (RECORD_TYPES as readonly string[]).includes(v);
}

export function newRecordId(type: RecordType, random: () => string): string {
  const suffix = random().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return `${RECORD_ID_PREFIX[type]}${suffix}`;
}

/** Validate an already-parsed envelope (current schema). Returns a failure or null. */
function validateCurrent(e: Record<string, unknown>): { code: DecodeFailureCode; reason: string } | null {
  for (const f of ["schemaVersion", "recordType", "recordId", "createdAt", "createdBy", "payload"]) {
    if (!(f in e) || e[f] === undefined || e[f] === null) return { code: "MISSING_FIELD", reason: `Missing field "${f}".` };
  }
  if (!isRecordType(e.recordType)) return { code: "UNKNOWN_RECORD_TYPE", reason: "Unknown recordType." };
  if (typeof e.recordId !== "string" || !RECORD_ID_PATTERN.test(e.recordId)) {
    return { code: "INVALID_FIELD", reason: "recordId has an invalid format." };
  }
  if (!e.recordId.startsWith(RECORD_ID_PREFIX[e.recordType])) {
    return { code: "ID_TYPE_MISMATCH", reason: "recordId prefix does not match recordType." };
  }
  if (typeof e.createdBy !== "string" || e.createdBy.trim() === "" || e.createdBy.length > 100) {
    return { code: "INVALID_FIELD", reason: "createdBy must be a non-empty user id." };
  }
  if (!isIsoTimestamp(e.createdAt)) return { code: "INVALID_FIELD", reason: "createdAt must be an ISO-8601 UTC timestamp." };
  if (e.updatedAt !== undefined && !isIsoTimestamp(e.updatedAt)) {
    return { code: "INVALID_FIELD", reason: "updatedAt must be an ISO-8601 UTC timestamp." };
  }
  if (!isPlainObject(e.payload)) return { code: "INVALID_FIELD", reason: "payload must be a plain object." };
  return null;
}

/** Decode AddInData `details` (object or JSON string) into a validated envelope. Never throws. */
export function decodeDetails(details: unknown): DecodeResult {
  let value: unknown = details;
  if (typeof details === "string") {
    if (details.length > MAX_DETAILS_CHARS) return { ok: false, code: "OVERSIZED", reason: "Stored details exceed the size limit." };
    try {
      value = JSON.parse(details);
    } catch {
      return { ok: false, code: "MALFORMED_JSON", reason: "details is not valid JSON." };
    }
  }
  if (!isPlainObject(value)) return { ok: false, code: "NOT_OBJECT", reason: "details is not an object." };

  let size: number;
  try {
    size = JSON.stringify(value).length;
  } catch {
    return { ok: false, code: "MALFORMED_JSON", reason: "details is not serializable." };
  }
  if (size > MAX_DETAILS_CHARS) return { ok: false, code: "OVERSIZED", reason: "Stored details exceed the size limit." };

  let candidate: Record<string, unknown> = value;
  const version = candidate.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return { ok: false, code: "MISSING_FIELD", reason: 'Missing or invalid "schemaVersion".' };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, code: "UNSUPPORTED_SCHEMA_VERSION", reason: `Schema version ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}.` };
  }
  let migrated = false;
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, code: "UNSUPPORTED_SCHEMA_VERSION", reason: `No migration from schema version ${v}.` };
    try {
      candidate = { ...step(candidate), schemaVersion: v + 1 };
    } catch {
      return { ok: false, code: "INVALID_FIELD", reason: `Migration from schema version ${v} failed.` };
    }
    migrated = true;
  }
  const failure = validateCurrent(candidate);
  if (failure) return { ok: false, ...failure };
  return { ok: true, envelope: candidate as unknown as RecordEnvelope, migrated };
}

/** Validate and encode an envelope for writing. Throws RecordValidationError. */
export function encodeEnvelope(envelope: RecordEnvelope): Record<string, unknown> {
  if (!isPlainObject(envelope)) throw new RecordValidationError("NOT_OBJECT", "Envelope must be an object.");
  const plain = envelope as unknown as Record<string, unknown>;
  if (plain.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new RecordValidationError("UNSUPPORTED_SCHEMA_VERSION", `Writers must use schema version ${CURRENT_SCHEMA_VERSION}.`);
  }
  const failure = validateCurrent(plain);
  if (failure) throw new RecordValidationError(failure.code, failure.reason);
  let json: string;
  try {
    json = JSON.stringify(plain);
  } catch {
    throw new RecordValidationError("MALFORMED_JSON", "Envelope is not serializable.");
  }
  if (json.length > MAX_DETAILS_CHARS) {
    throw new RecordValidationError("OVERSIZED", `Record is ${json.length} characters (max ${MAX_DETAILS_CHARS}).`);
  }
  // Round trip so the written value is exactly JSON data (drops undefined, rejects odd types).
  return JSON.parse(json) as Record<string, unknown>;
}
