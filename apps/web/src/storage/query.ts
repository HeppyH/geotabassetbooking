/*───────────────────── AddInData query builder (Phase C) ─────────────────────
 * Builds `Get` parameters for AddInData with the documented restrictions:
 *   - whereClause requires selectClause
 *   - no AND / OR / LIKE
 *   - values are case-sensitive (never lowercased here)
 *   - retrieval is always bounded by resultsLimit
 * No pagination is claimed: the AddInData Get contract documents none, so callers treat a
 * result that reaches the limit as "possibly truncated".
 * The exact selectClause/whereClause grammar is UNVERIFIED against a tenant; this builder only
 * accepts a conservative character set and the repository does not use server-side filtering
 * by default (it filters client-side after bounded retrieval).
 */
import { isValidAddInId } from "../config/addinId.ts";

export const DEFAULT_RESULTS_LIMIT = 1000;
export const MAX_RESULTS_LIMIT = 1000;

export class QueryBuildError extends Error {
  constructor(message: string) {
    super(`INVALID_ADDIN_QUERY: ${message}`);
    this.name = "QueryBuildError";
  }
}

export interface AddInDataQueryInput {
  addInId: string;
  selectClause?: string;
  whereClause?: string;
  resultsLimit?: number;
}

const CLAUSE_PATTERN = /^[A-Za-z0-9_.\[\]=<>!' -]{1,200}$/;
const FORBIDDEN_TOKEN = /\b(and|or|like)\b/i;

export function buildAddInDataGet(input: AddInDataQueryInput): Record<string, unknown> {
  if (!isValidAddInId(input.addInId)) throw new QueryBuildError("addInId is invalid.");
  const limit = input.resultsLimit ?? DEFAULT_RESULTS_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS_LIMIT) {
    throw new QueryBuildError(`resultsLimit must be an integer between 1 and ${MAX_RESULTS_LIMIT}.`);
  }
  const search: Record<string, unknown> = { addInId: input.addInId };
  if (input.whereClause !== undefined && input.selectClause === undefined) {
    throw new QueryBuildError("whereClause requires selectClause.");
  }
  for (const [name, value] of [["selectClause", input.selectClause], ["whereClause", input.whereClause]] as const) {
    if (value === undefined) continue;
    if (typeof value !== "string" || !CLAUSE_PATTERN.test(value)) throw new QueryBuildError(`${name} contains unsupported characters.`);
    if (name === "whereClause" && FORBIDDEN_TOKEN.test(value)) throw new QueryBuildError("whereClause must not use AND, OR or LIKE.");
    search[name] = value;
  }
  return { typeName: "AddInData", search, resultsLimit: limit };
}
