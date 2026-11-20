# Implementation Details

## Record envelope (`storage/recordEnvelope.ts`)
`{ schemaVersion, recordType, recordId, createdAt, updatedAt?, createdBy, payload }`.
- Types: `booking`, `notification`, `audit`, `application_config`. Ids are prefixed `bkg_ ntf_ aud_ cfg_`; decode rejects a prefix/type mismatch (fixes F-04 collision risk).
- Encode validates id format, creator, ISO-8601 UTC timestamps, plain-object payload, schema version and size, then JSON round-trips the value.
- Decode never throws; it returns a coded failure: `MALFORMED_JSON`, `NOT_OBJECT`, `MISSING_FIELD`, `INVALID_FIELD`, `UNKNOWN_RECORD_TYPE`, `UNSUPPORTED_SCHEMA_VERSION`, `ID_TYPE_MISMATCH`, `OVERSIZED`.
- Schema versions: newer than supported → rejected; older → needs a registered migration (`MIGRATIONS`, empty today; the registry is the extension point).
- 10,000-character limit enforced on write and read. One record per entity; nothing is aggregated into a single large record.

## Query builder (`storage/query.ts`)
Always bounded (`resultsLimit` 1–1000, default 1000). `whereClause` requires `selectClause`; AND/OR/LIKE rejected; case preserved. No pagination is implemented or claimed; a result reaching the limit is reported as `possiblyTruncated`. The store does not use server-side filtering by default (clause grammar UNVERIFIED), it filters client-side after the bounded read.

## Store (`storage/addinDataStore.ts`)
- `list`: shared in-flight request, TTL cache (15 s default), per-record validation; invalid records go to `rejected` and are never returned as data; duplicate recordIds and foreign-AddInId rows are rejected.
- `add`: validate → fresh read to refuse duplicate recordId → `Add`. Never retried (could duplicate). Missing id in response is an error.
- `update`: fresh read (cache bypassed) → record must exist, keep type/id, and its stored `updatedAt ?? createdAt` must equal the caller's expected stamp, else `CONFLICT` → `Set` with the server id. Advisory only; not atomic.
- `remove`: rejected unless `allowRemove: true`.
- Retry/backoff (200 ms × 2^n, 3 attempts) for reads and `Set`, transient errors only (timeout, network, 429/502/503/504, rate limit). Capability denials are never retried.
- Errors are `StorageError` with codes; nothing is swallowed and there are no fallbacks.

## Changed files
New: `src/storage/{recordEnvelope,query,addinDataStore}.ts`, `test/storageEngine.test.mjs`; `test/runtimeArchitecture.test.mjs` extended.
