/*───────────────────── Capability-Gated Native Provider ─────────────────────
 * Phase B. Wraps the existing AddInDataBookingDataProvider with explicit, per-method
 * capability checks. Two independent layers deny live operations:
 *   1. this provider checks the capability before delegating;
 *   2. the inner provider only receives a gated api (gatedApi.ts), so even a bypass of
 *      layer 1 cannot reach the raw MyGeotab api.
 *
 * Fail-closed rules:
 *  - Denied methods reject with CapabilityDeniedError. They never return empty "success" data.
 *  - There is NO fallback to localStorage, mock data, demo providers or any external service.
 *    This module must not import data/dataProvider, data/mockMyGeotab or any HTTP client
 *    (enforced by test/runtimeArchitecture.test.mjs).
 *  - deleteBooking (AddInData Remove) is never permitted by the native runtime in Phase B.
 *  - resetDemoData is never permitted: it is an offline-simulation operation.
 *  - Booking status changes to APPROVED / REJECTED / ASSIGNED additionally require
 *    APPROVAL_ACTIONS_ENABLED.
 *
 * Not tenant-validated: the inner provider's behaviour against a real MyGeotab tenant
 * remains unverified.
 */
import type {
  BookingDataProvider,
  NotificationDataProvider,
  MyGeotabGroup,
  MyGeotabStatusData,
  MyGeotabLogRecord,
  ResolvedAsset,
  ResolvedBooking,
  ResolvedUser,
  OpexNotification,
  OpexBookingAudit,
  NotificationType,
} from "../data/types.ts";
import { AddInDataBookingDataProvider } from "../data/addinDataProvider.ts";
import { isValidAddInId } from "../config/addinId.ts";
import type { CapabilityDecision, CapabilityName } from "./capabilities.ts";
import { CapabilityDeniedError } from "./capabilities.ts";
import { createGatedApi, firstDenial } from "./gatedApi.ts";
import { evaluateTransition } from "../booking/stateMachine.ts";
import type { OpexRole } from "../authz/roles.ts";
import type { GateContext, RawGeotabApi } from "./gatedApi.ts";

type Denial = Extract<CapabilityDecision, { allowed: false }>;

export const APPROVAL_STATUSES: readonly string[] = ["APPROVED", "REJECTED", "ASSIGNED"];

export interface NativeProviderOptions {
  api: RawGeotabApi | null;
  addInId: string | null;
  ctx: GateContext;
  /** True only after identity resolved to a single verified MyGeotab principal. */
  identityAuthenticated: boolean;
  /** OPEX role permissions (client-side policy). Required: there is no permissive default. */
  roleAllows: { write: boolean; approve: boolean };
  /** Verified actor (MyGeotab user id) and mapped OPEX role, used by the state machine. */
  actor: { id: string; role: OpexRole | null };
}

export type NativeProvider = BookingDataProvider & NotificationDataProvider;

const READ: readonly CapabilityName[] = ["MYGEOTAB_STORAGE_ENABLED", "LIVE_BOOKING_READ_ENABLED"];
const WRITE: readonly CapabilityName[] = ["MYGEOTAB_STORAGE_ENABLED", "LIVE_BOOKING_READ_ENABLED", "LIVE_BOOKING_WRITE_ENABLED"];
const APPROVE: readonly CapabilityName[] = [...WRITE, "APPROVAL_ACTIONS_ENABLED"];

function deny(capability: string, code: Denial["code"], reason: string): CapabilityDeniedError {
  return new CapabilityDeniedError({ allowed: false, capability, code, reason });
}

export function createNativeProvider(options: NativeProviderOptions): NativeProvider {
  const { ctx } = options;
  const gatedApi = createGatedApi(options.api, ctx);
  let inner: AddInDataBookingDataProvider | null = null;

  function authorize(names: readonly CapabilityName[]): void {
    if (!options.identityAuthenticated) {
      throw deny("MYGEOTAB_IDENTITY_ENABLED", "CAPABILITY_DISABLED", "Authenticated MyGeotab identity is not verified.");
    }
    const denial = firstDenial(ctx, names);
    if (denial) throw new CapabilityDeniedError(denial);
    if (names.includes("LIVE_BOOKING_WRITE_ENABLED") && !options.roleAllows.write) {
      throw deny("OPEX_ROLE", "CAPABILITY_DISABLED", "OPEX role does not permit writing bookings.");
    }
    if (names.includes("APPROVAL_ACTIONS_ENABLED") && !options.roleAllows.approve) {
      throw deny("OPEX_ROLE", "CAPABILITY_DISABLED", "OPEX role does not permit approval actions.");
    }
    if (!isValidAddInId(options.addInId)) {
      throw deny("MYGEOTAB_STORAGE_ENABLED", "CAPABILITY_DISABLED", "Configured AddInId is invalid.");
    }
  }

  /** Authorize first, then build the inner provider lazily. */
  function target(names: readonly CapabilityName[]): AddInDataBookingDataProvider {
    authorize(names);
    if (!inner) inner = new AddInDataBookingDataProvider(gatedApi, options.addInId);
    return inner;
  }

  function assertOwn(userId: string): void {
    if (userId !== options.actor.id) throw deny("OPEX_RECIPIENT", "CAPABILITY_DISABLED", "Notifications are limited to the authenticated user.");
  }

  async function guarded<T>(names: readonly CapabilityName[], run: (p: AddInDataBookingDataProvider) => Promise<T>): Promise<T> {
    const p = target(names);
    return run(p);
  }

  return {
    isLive: () => true,

    /* reads */
    getAssets: () => guarded(READ, (p) => p.getAssets()) as Promise<ResolvedAsset[]>,
    getUsers: () => guarded(READ, (p) => p.getUsers()) as Promise<ResolvedUser[]>,
    getGroups: () => guarded(READ, (p) => p.getGroups()) as Promise<MyGeotabGroup[]>,
    getStatusData: () => guarded(READ, (p) => p.getStatusData()) as Promise<MyGeotabStatusData[]>,
    getLogRecords: () => guarded(READ, (p) => p.getLogRecords()) as Promise<MyGeotabLogRecord[]>,
    getBookings: () => guarded(READ, (p) => p.getBookings()) as Promise<ResolvedBooking[]>,
    getApprovers: () => guarded(READ, (p) => p.getApprovers()) as Promise<ResolvedUser[]>,
    // Phase F: recipient scoping. A user can only read, count or change their own notifications.
    getNotifications: (userId: string, opts?: { limit?: number; offset?: number; unreadOnly?: boolean; type?: NotificationType }) =>
      guarded(READ, async (p) => {
        assertOwn(userId);
        return (await p.getNotifications(userId, opts)).filter((n) => n.recipient_user_id === options.actor.id);
      }) as Promise<OpexNotification[]>,
    getUnreadCount: (userId: string) => guarded(READ, async (p) => { assertOwn(userId); return p.getUnreadCount(userId); }),
    findByIdempotencyKey: (key: string) =>
      guarded(READ, async (p) => {
        const hit = await p.findByIdempotencyKey(key);
        return hit && hit.recipient_user_id === options.actor.id ? hit : null; // never reveal another user's notification
      }) as Promise<OpexNotification | null>,
    getAuditRecords: (bookingId: string) =>
      guarded(READ, async (p) => {
        // Booking history: approvers/administrators, or the booking's own requester.
        const role = options.actor.role;
        const privileged = role === "approver" || role === "administrator";
        if (!privileged) {
          const owned = (await p.getBookings()).find((b) => b.id === bookingId);
          if (!owned || owned.requester_id !== options.actor.id) {
            throw deny("OPEX_ROLE", "CAPABILITY_DISABLED", "Audit history is limited to the booking owner, approvers and administrators.");
          }
        }
        return p.getAuditRecords(bookingId);
      }) as Promise<OpexBookingAudit[]>,

    /* writes */
    createBooking: (input) => guarded(WRITE, (p) => p.createBooking(input)),
    updateBookingStatus: (id, status, approverId, approvalRemarks) =>
      guarded(APPROVAL_STATUSES.includes(status) ? APPROVE : WRITE, async (p) => {
        // Phase E: centralized state machine. Current state is read fresh; the actor is the
        // verified principal, never a caller-supplied id.
        if (approverId !== undefined && approverId !== options.actor.id) {
          throw deny("OPEX_ACTOR", "CAPABILITY_DISABLED", "Approver id must be the authenticated user.");
        }
        const current = (await p.getBookings()).find((b) => b.id === id);
        if (!current) throw new Error(`BOOKING_NOT_FOUND: ${id}`);
        const verdict = evaluateTransition({
          from: current.status, to: status, requesterId: current.requester_id,
          actorId: options.actor.id, role: options.actor.role, reason: approvalRemarks,
        });
        if (!verdict.ok) throw deny("BOOKING_TRANSITION", "CAPABILITY_DISABLED", `${verdict.code}: ${verdict.reason}`);
        if (verdict.noop) return; // duplicate action: no write
        await p.updateBookingStatus(id, status, approverId, approvalRemarks);
      }),
    createNotification: (input) => guarded(WRITE, (p) => p.createNotification(input)),
    markAsRead: (id) =>
      guarded(WRITE, async (p) => {
        const mine = await p.getNotifications(options.actor.id);
        if (!mine.some((n) => n.id === id)) throw deny("OPEX_RECIPIENT", "CAPABILITY_DISABLED", "Notification not found for this user.");
        await p.markAsRead(id);
      }),
    markAllAsRead: (userId) => guarded(WRITE, async (p) => { assertOwn(userId); await p.markAllAsRead(userId); }),
    markDeliveryStatus: (id, status) => guarded(WRITE, (p) => p.markDeliveryStatus(id, status)),
    createAuditRecord: (input) => guarded(WRITE, (p) => p.createAuditRecord(input)),

    /* never permitted in the native runtime (Phase B) */
    deleteBooking: () =>
      Promise.reject(deny("LIVE_BOOKING_WRITE_ENABLED", "CAPABILITY_DISABLED", "Deleting AddInData records is not permitted by the native runtime.")),
    resetDemoData: () =>
      Promise.reject(deny("OFFLINE_SIMULATION_ONLY", "CAPABILITY_DISABLED", "Demo reset is an offline-simulation operation and is not available in the native runtime.")),
  };
}

/**
 * Provider used when the native runtime is blocked (gates off, tenant denied, identity
 * unresolved, API missing). Every data method rejects. It does not hold any API object.
 */
export function createDeniedProvider(reason: string): NativeProvider {
  const reject = <T>(): Promise<T> => Promise.reject(deny("NATIVE_RUNTIME_BLOCKED", "CAPABILITY_DISABLED", reason));
  return {
    isLive: () => true,
    getAssets: reject,
    getUsers: reject,
    getGroups: reject,
    getStatusData: reject,
    getLogRecords: reject,
    getBookings: reject,
    getApprovers: reject,
    getNotifications: reject,
    getUnreadCount: reject,
    findByIdempotencyKey: reject,
    getAuditRecords: reject,
    createBooking: reject,
    updateBookingStatus: reject,
    createNotification: reject,
    markAsRead: reject,
    markAllAsRead: reject,
    markDeliveryStatus: reject,
    createAuditRecord: reject,
    deleteBooking: reject,
    resetDemoData: reject,
  };
}
