/*───────────────────── AddInData Store (Phase C) ─────────────────────
 * The only persistence mechanism for OPEX application data. Wraps a (gated) MyGeotab api.
 *
 *   list()    bounded Get; request de-duplication; TTL cache; malformed records are rejected
 *             individually and reported, never silently dropped or returned as data.
 *   add()     validates + size-checks, then Add. NEVER auto-retried (a retry could duplicate).
 *   update()  fresh Get, compares `updatedAt` with the caller's expected value, then Set.
 *             Advisory only: AddInData has no documented transaction/CAS, so a window between
 *             the check and the Set remains (see booking-concurrency-limitations.md).
 *   remove()  disabled unless the store is created with allowRemove: true.
 *
 * Retries (with exponential backoff) apply only to reads and Set, only for transient errors.
 * Errors are surfaced as StorageError with a code; nothing is hidden or replaced by fallbacks.
 * No localStorage, no external service, no pagination claims.
 */
import { isValidAddInId } from "../config/addinId.ts";
import { buildAddInDataGet, DEFAULT_RESULTS_LIMIT } from "./query.ts";
import { decodeDetails, encodeEnvelope } from "./recordEnvelope.ts";
import type { DecodeFailureCode, RecordEnvelope, RecordType } from "./recordEnvelope.ts";

export type StorageErrorCode =
  | "INVALID_ADDIN_ID"
  | "API_UNAVAILABLE"
  | "API_ERROR"
  | "TRANSIENT_EXHAUSTED"
  | "INVALID_RECORD"
  | "CONFLICT"
  | "NOT_FOUND"
  | "DUPLICATE_RECORD_ID"
  | "REMOVE_NOT_ALLOWED";

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly cause?: unknown;
  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(`${code}: ${message}`);
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
  }
}

export type StoreApi = {
  call?: (method: string, params: Record<string, unknown>, success: (result: unknown) => void, error?: (error: unknown) => void) => void;
};

export interface StoredRecord {
  /** AddInData server record id (needed for Set/Remove). Not the application record id. */
  serverId: string;
  envelope: RecordEnvelope;
}

export interface RejectedRecord {
  serverId: string | null;
  code: DecodeFailureCode;
  reason: string;
  /** Present for duplicate-id rejections so callers can treat the id as ambiguous. */
  recordId?: string;
}

export interface ListResult {
  records: StoredRecord[];
  rejected: RejectedRecord[];
  /** True when the raw result reached resultsLimit: more records may exist (no pagination available). */
  possiblyTruncated: boolean;
  fetchedAt: number;
}

export interface StoreOptions {
  api: StoreApi | null | undefined;
  addInId: string;
  groupId?: string;
  resultsLimit?: number;
  cacheTtlMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  allowRemove?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_GROUP = "GroupCompanyId";
const TRANSIENT = /timeout|timed out|network|unavailable|temporar|rate.?limit|too many|\b(429|502|503|504)\b/i;

export function isTransientError(err: unknown): boolean {
  if (err && typeof err === "object" && (err as { name?: string }).name === "CapabilityDeniedError") return false;
  const text = err instanceof Error ? `${err.name} ${err.message}` : typeof err === "string" ? err : "";
  return TRANSIENT.test(text);
}

export function createAddInDataStore(options: StoreOptions) {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ttl = options.cacheTtlMs ?? 15000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const backoff = options.baseBackoffMs ?? 200;
  const limit = options.resultsLimit ?? DEFAULT_RESULTS_LIMIT;
  const groupId = options.groupId ?? DEFAULT_GROUP;
  const { addInId } = options;

  let cache: ListResult | null = null;
  let inflight: Promise<ListResult> | null = null;
  let generation = 0;

  function once(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const api = options.api;
      if (!api || typeof api.call !== "function") {
        reject(new StorageError("API_UNAVAILABLE", "MyGeotab API is not available."));
        return;
      }
      try {
        api.call(method, params, resolve, (e) => reject(e ?? new Error("GEOTAB_API_ERROR")));
      } catch (e) {
        reject(e);
      }
    });
  }

  async function call(method: string, params: Record<string, unknown>, retry: boolean): Promise<unknown> {
    if (!isValidAddInId(addInId)) throw new StorageError("INVALID_ADDIN_ID", "Configured AddInId is invalid.");
    const attempts = retry ? maxAttempts : 1;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await once(method, params);
      } catch (e) {
        if (e instanceof StorageError) throw e;
        last = e;
        if (!retry || !isTransientError(e)) {
          throw new StorageError("API_ERROR", e instanceof Error ? e.message : String(e), e);
        }
        if (i < attempts - 1) await sleep(backoff * 2 ** i);
      }
    }
    throw new StorageError("TRANSIENT_EXHAUSTED", `Gave up after ${attempts} attempts.`, last);
  }

  async function fetchAll(): Promise<ListResult> {
    if (!isValidAddInId(addInId)) throw new StorageError("INVALID_ADDIN_ID", "Configured AddInId is invalid.");
    const raw = await call("Get", buildAddInDataGet({ addInId, resultsLimit: limit }), true);
    if (!Array.isArray(raw)) throw new StorageError("API_ERROR", "AddInData Get did not return an array.");
    const records: StoredRecord[] = [];
    const rejected: RejectedRecord[] = [];
    const seenIds = new Set<string>();
    for (const item of raw as Array<Record<string, unknown>>) {
      const serverId = item && typeof item.id === "string" ? item.id : null;
      if (!item || typeof item !== "object" || item.addInId !== addInId) {
        rejected.push({ serverId, code: "NOT_OBJECT", reason: "Record does not belong to this Add-In." });
        continue;
      }
      const decoded = decodeDetails(item.details);
      if (!decoded.ok) {
        rejected.push({ serverId, code: decoded.code, reason: decoded.reason });
        continue;
      }
      if (serverId === null) {
        rejected.push({ serverId, code: "MISSING_FIELD", reason: "Record has no server id." });
        continue;
      }
      const key = `${decoded.envelope.recordType}:${decoded.envelope.recordId}`;
      if (seenIds.has(key)) {
        rejected.push({ serverId, code: "INVALID_FIELD", reason: "Duplicate recordId.", recordId: decoded.envelope.recordId });
        continue;
      }
      seenIds.add(key);
      records.push({ serverId, envelope: decoded.envelope });
    }
    return { records, rejected, possiblyTruncated: raw.length >= limit, fetchedAt: now() };
  }

  function loadFresh(): Promise<ListResult> {
    if (inflight) return inflight;
    const gen = generation;
    const p = fetchAll()
      .then((r) => {
        if (gen === generation) cache = r;
        return r;
      })
      .finally(() => {
        if (inflight === p) inflight = null;
      });
    inflight = p;
    return p;
  }

  function invalidate(): void {
    generation++;
    cache = null;
    inflight = null;
  }

  return {
    /** Cached (TTL) bounded read. Concurrent callers share one request. */
    async list(opts: { type?: RecordType; forceRefresh?: boolean } = {}): Promise<ListResult> {
      const fresh = cache && !opts.forceRefresh && now() - cache.fetchedAt < ttl;
      const result = fresh ? cache! : await loadFresh();
      if (!opts.type) return result;
      return { ...result, records: result.records.filter((r) => r.envelope.recordType === opts.type) };
    },

    async add(envelope: RecordEnvelope): Promise<StoredRecord> {
      let details: Record<string, unknown>;
      try {
        details = encodeEnvelope(envelope);
      } catch (e) {
        throw new StorageError("INVALID_RECORD", e instanceof Error ? e.message : String(e), e);
      }
      const existing = await loadFresh();
      if (existing.records.some((r) => r.envelope.recordType === envelope.recordType && r.envelope.recordId === envelope.recordId)) {
        throw new StorageError("DUPLICATE_RECORD_ID", `A ${envelope.recordType} record with this id already exists.`);
      }
      // Add is not idempotent: never retried automatically.
      const response = await call("Add", { typeName: "AddInData", entity: { addInId, details, groups: [{ id: groupId }] } }, false);
      invalidate();
      const serverId = typeof response === "string" ? response : (response as { id?: unknown } | null)?.id;
      if (typeof serverId !== "string" || !serverId) {
        throw new StorageError("API_ERROR", "AddInData Add did not return a record id; refresh before retrying.");
      }
      return { serverId, envelope: JSON.parse(JSON.stringify(details)) as RecordEnvelope };
    },

    /** Replace a record only if its stored updatedAt/createdAt still equals the caller's expectation. */
    async update(serverId: string, next: RecordEnvelope, expectedStamp: string): Promise<StoredRecord> {
      let details: Record<string, unknown>;
      try {
        details = encodeEnvelope(next);
      } catch (e) {
        throw new StorageError("INVALID_RECORD", e instanceof Error ? e.message : String(e), e);
      }
      invalidate();
      const current = await loadFresh();
      const found = current.records.find((r) => r.serverId === serverId);
      if (!found) throw new StorageError("NOT_FOUND", "Record no longer exists.");
      if (found.envelope.recordType !== next.recordType || found.envelope.recordId !== next.recordId) {
        throw new StorageError("INVALID_RECORD", "Update must keep recordType and recordId.");
      }
      const stamp = found.envelope.updatedAt ?? found.envelope.createdAt;
      if (stamp !== expectedStamp) {
        throw new StorageError("CONFLICT", "Record was changed by someone else; reload and retry.");
      }
      await call("Set", { typeName: "AddInData", entity: { addInId, id: serverId, details, groups: [{ id: groupId }] } }, true);
      invalidate();
      return { serverId, envelope: JSON.parse(JSON.stringify(details)) as RecordEnvelope };
    },

    async remove(serverId: string): Promise<void> {
      if (!options.allowRemove) throw new StorageError("REMOVE_NOT_ALLOWED", "Removing AddInData records is disabled.");
      await call("Remove", { typeName: "AddInData", entity: { id: serverId } }, false);
      invalidate();
    },

    invalidate,
  };
}

export type AddInDataStore = ReturnType<typeof createAddInDataStore>;
