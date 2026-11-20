/*───────────────────── Booking state machine (Phase E) ─────────────────────
 * Single place that defines valid status transitions and who may perform them. Existing
 * statuses are preserved (see data/types.ts). New bookings start at PENDING_APPROVAL, as in the
 * existing workflow.
 *
 * Rules enforced here (CLIENT-SIDE policy, see authz/roles.ts for the limitation):
 *  - only listed transitions are valid; terminal statuses never change;
 *  - approve/reject need an approver or administrator who is NOT the requester;
 *  - reject needs a non-empty reason (<= 500 chars);
 *  - cancel: the owner, or an administrator;
 *  - repeating the current status is a safe no-op (duplicate click / retry), after the
 *    permission check, and produces no write.
 */
import { ROLE_ACTIONS, can } from "../authz/roles.ts";
import type { OpexRole } from "../authz/roles.ts";

export const BOOKING_STATUSES = [
  "DRAFT", "SUBMITTED", "PENDING_APPROVAL", "APPROVED", "ASSIGNED", "CHECKED_OUT",
  "OVERDUE", "RETURNED", "CLOSED", "COMPLETED", "REJECTED", "CANCELLED", "EXPIRED",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const TERMINAL_STATUSES: readonly BookingStatus[] = ["CLOSED", "COMPLETED", "REJECTED", "CANCELLED", "EXPIRED"];

/** Statuses that occupy the vehicle for availability purposes. */
export const BLOCKING_STATUSES: readonly BookingStatus[] = ["SUBMITTED", "PENDING_APPROVAL", "APPROVED", "ASSIGNED", "CHECKED_OUT", "OVERDUE"];

export const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = Object.freeze({
  DRAFT: ["SUBMITTED", "PENDING_APPROVAL", "CANCELLED"],
  SUBMITTED: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"],
  APPROVED: ["ASSIGNED", "CANCELLED", "EXPIRED"],
  ASSIGNED: ["COMPLETED", "CANCELLED", "CHECKED_OUT"],
  CHECKED_OUT: ["RETURNED", "OVERDUE"],
  OVERDUE: ["RETURNED"],
  RETURNED: ["CLOSED", "COMPLETED"],
  CLOSED: [], COMPLETED: [], REJECTED: [], CANCELLED: [], EXPIRED: [],
});

export const MAX_REASON_CHARS = 500;

export type TransitionFailureCode = "UNKNOWN_STATUS" | "INVALID_TRANSITION" | "TERMINAL_STATUS" | "PERMISSION_DENIED" | "REASON_REQUIRED";

export type TransitionResult =
  | { ok: true; noop: boolean; effects: { approverId?: string; rejectionReason?: string } }
  | { ok: false; code: TransitionFailureCode; reason: string };

export interface TransitionInput {
  from: unknown;
  to: unknown;
  requesterId: string | null | undefined;
  actorId: string | null | undefined;
  role: OpexRole | null | undefined;
  reason?: string | null;
}

export function isBookingStatus(v: unknown): v is BookingStatus {
  return typeof v === "string" && (BOOKING_STATUSES as readonly string[]).includes(v);
}

export function isBlockingStatus(v: unknown): boolean {
  return isBookingStatus(v) && BLOCKING_STATUSES.includes(v);
}

const deny = (code: TransitionFailureCode, reason: string): TransitionResult => ({ ok: false, code, reason });

function permitted(to: BookingStatus, i: TransitionInput): { allowed: true } | { allowed: false; reason: string } {
  const role = i.role;
  const actorId = i.actorId;
  const requesterId = i.requesterId;
  switch (to) {
    case "APPROVED": return can(role, "booking.approve", { actorId, requesterId });
    case "REJECTED": return can(role, "booking.reject", { actorId, requesterId });
    case "CANCELLED": {
      const own = can(role, "booking.cancel_own", { actorId, requesterId });
      return own.allowed ? own : can(role, "booking.cancel_any", { actorId });
    }
    case "SUBMITTED":
    case "PENDING_APPROVAL":
      return can(role, "booking.edit_own", { actorId, requesterId });
    case "COMPLETED": {
      const own = can(role, "booking.edit_own", { actorId, requesterId });
      if (own.allowed) return own;
      return role && ROLE_ACTIONS[role].includes("booking.approve") && actorId ? { allowed: true } : { allowed: false, reason: "Not permitted to complete this booking." };
    }
    case "EXPIRED": return can(role, "booking.cancel_any", { actorId });
    default: // ASSIGNED, CHECKED_OUT, OVERDUE, RETURNED, CLOSED, DRAFT: approver/administrator only
      return role && ROLE_ACTIONS[role].includes("booking.approve") && actorId ? { allowed: true } : { allowed: false, reason: "Approver or administrator required." };
  }
}

export function evaluateTransition(i: TransitionInput): TransitionResult {
  if (!isBookingStatus(i.from) || !isBookingStatus(i.to)) return deny("UNKNOWN_STATUS", "Unknown booking status.");
  const from = i.from;
  const to = i.to;
  const perm = permitted(to, i);
  if (!perm.allowed) return deny("PERMISSION_DENIED", perm.reason);

  const reason = typeof i.reason === "string" ? i.reason.trim() : "";
  if (reason.length > MAX_REASON_CHARS) return deny("REASON_REQUIRED", `Reason is longer than ${MAX_REASON_CHARS} characters.`);

  if (from === to) {
    // Duplicate action: no write, no new audit/notification.
    return { ok: true, noop: true, effects: {} };
  }
  if (TERMINAL_STATUSES.includes(from)) return deny("TERMINAL_STATUS", `${from} bookings cannot change.`);
  if (!TRANSITIONS[from].includes(to)) return deny("INVALID_TRANSITION", `${from} → ${to} is not allowed.`);
  if (to === "REJECTED" && reason === "") return deny("REASON_REQUIRED", "A rejection reason is required.");

  const effects: { approverId?: string; rejectionReason?: string } = {};
  if (to === "APPROVED" && i.actorId) effects.approverId = i.actorId;
  if (to === "REJECTED") { effects.rejectionReason = reason; if (i.actorId) effects.approverId = i.actorId; }
  return { ok: true, noop: false, effects };
}

/** Booking fields may be edited only by the owner while no approval decision exists. */
export function canEditBooking(status: unknown, ownerId: string | null | undefined, actorId: string | null | undefined, role: OpexRole | null | undefined): boolean {
  if (status !== "DRAFT" && status !== "PENDING_APPROVAL") return false;
  return can(role, "booking.edit_own", { actorId, requesterId: ownerId }).allowed;
}
