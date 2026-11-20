/*───────────────────── Persisted notifications (Phase F) ─────────────────────
 * Notification records live in AddInData (Phase C envelope, recordType "notification").
 *  - EVERY query is scoped to one recipient (the authenticated actor) — in the repository, after
 *    decoding, and again before returning. Another user's notifications are never returned.
 *  - Pagination is applied AFTER filtering and sorting (fixes F-06: `offset ?? 0 + limit`).
 *  - Persisting a notification is not delivering it. In-app notifications use deliveryStatus
 *    "not_applicable"; "delivered" can only be set with explicit delivery confirmation (F-09).
 *  - Idempotent creation by idempotencyKey (a retry never makes a second record).
 * Client-side scoping: a user with AddInData Get clearance can still read all records through
 * the raw API (documented limitation; see phase-f/security-considerations.md).
 */
import type { AddInDataStore, StoredRecord } from "../storage/addinDataStore.ts";
import { StorageError } from "../storage/addinDataStore.ts";
import { newRecordId } from "../storage/recordEnvelope.ts";
import type { RecordEnvelope } from "../storage/recordEnvelope.ts";

export const NOTIFICATION_TYPES = [
  "booking_created", "booking_approved", "booking_rejected", "booking_cancelled",
  "booking_updated", "booking_reminder", "vehicle_assigned",
] as const;
export type NotificationKind = (typeof NOTIFICATION_TYPES)[number];

export type DeliveryStatus = "not_applicable" | "pending" | "delivered" | "failed";
export const DELIVERY_STATUSES: readonly DeliveryStatus[] = ["not_applicable", "pending", "delivered", "failed"];

export interface Notification {
  recordId: string;
  serverId: string;
  eventId: string;
  idempotencyKey: string;
  type: NotificationKind;
  recipientUserId: string;
  bookingId: string | null;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  deliveryStatus: DeliveryStatus;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface NewNotification {
  eventId: string; idempotencyKey: string; type: NotificationKind; recipientUserId: string;
  bookingId: string | null; title: string; message: string;
}

export type ReadFilter = "all" | "unread" | "read";
export interface NotificationQuery { filter?: ReadFilter; type?: NotificationKind; limit?: number; offset?: number }
export interface NotificationPage { items: Notification[]; total: number; hasMore: boolean }

const txt = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null);

export function toNotification(rec: StoredRecord): Notification | null {
  if (rec.envelope.recordType !== "notification") return null;
  const p = rec.envelope.payload;
  if (p.kind !== "notification") return null;
  const type = p.type;
  if (typeof type !== "string" || !(NOTIFICATION_TYPES as readonly string[]).includes(type)) return null;
  const recipient = txt(p.recipientUserId, 100);
  const eventId = txt(p.eventId, 200);
  const key = txt(p.idempotencyKey, 300);
  const title = txt(p.title, 200);
  const message = txt(p.message, 1000);
  if (!recipient || !eventId || !key || !title || !message || typeof p.isRead !== "boolean") return null;
  const delivery = typeof p.deliveryStatus === "string" && (DELIVERY_STATUSES as readonly string[]).includes(p.deliveryStatus) ? (p.deliveryStatus as DeliveryStatus) : null;
  if (!delivery) return null;
  const booking = p.bookingId === null || p.bookingId === undefined ? null : txt(p.bookingId, 100);
  if (p.bookingId !== null && p.bookingId !== undefined && booking === null) return null;
  return {
    recordId: rec.envelope.recordId, serverId: rec.serverId, eventId, idempotencyKey: key, type: type as NotificationKind,
    recipientUserId: recipient, bookingId: booking, title, message, isRead: p.isRead,
    readAt: typeof p.readAt === "string" ? p.readAt : null, deliveryStatus: delivery,
    deliveredAt: typeof p.deliveredAt === "string" ? p.deliveredAt : null,
    createdAt: rec.envelope.createdAt, updatedAt: rec.envelope.updatedAt ?? null,
  };
}

/** Pure: filter to one recipient, apply read/type filters, sort newest first, THEN paginate. */
export function queryNotifications(all: readonly Notification[], recipientUserId: string, q: NotificationQuery = {}): NotificationPage {
  const limit = q.limit === undefined ? Infinity : Math.max(0, Math.floor(q.limit));
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const mine = all
    .filter((n) => n.recipientUserId === recipientUserId)
    .filter((n) => (q.filter === "unread" ? !n.isRead : q.filter === "read" ? n.isRead : true))
    .filter((n) => (q.type ? n.type === q.type : true))
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.recordId < b.recordId ? 1 : -1) : Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  const items = mine.slice(offset, limit === Infinity ? undefined : offset + limit);
  return { items, total: mine.length, hasMore: offset + items.length < mine.length };
}

export interface RepoDeps { store: Pick<AddInDataStore, "list" | "add" | "update">; actorId: string; now?: () => Date; random?: () => string }

export function createNotificationRepo(deps: RepoDeps) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? (() => Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
  if (typeof deps.actorId !== "string" || !deps.actorId.trim()) throw new Error("NOTIFICATION_REPO_NO_ACTOR");
  const actor = deps.actorId;

  async function loadAll(force = false): Promise<Notification[]> {
    const { records } = await deps.store.list({ type: "notification", forceRefresh: force });
    return records.map(toNotification).filter((n): n is Notification => n !== null);
  }

  async function writeBack(n: Notification, patch: Record<string, unknown>): Promise<void> {
    const { records } = await deps.store.list({ type: "notification", forceRefresh: true });
    const rec = records.find((r) => r.serverId === n.serverId);
    if (!rec) throw new StorageError("NOT_FOUND", "Notification no longer exists.");
    const stamp = rec.envelope.updatedAt ?? rec.envelope.createdAt;
    const next: RecordEnvelope = { ...rec.envelope, updatedAt: now().toISOString(), payload: { ...rec.envelope.payload, ...patch } };
    await deps.store.update(n.serverId, next, stamp);
  }

  return {
    /** Only the actor's own notifications; recipient is enforced twice. */
    async list(q: NotificationQuery = {}): Promise<NotificationPage> {
      const page = queryNotifications(await loadAll(), actor, q);
      return { ...page, items: page.items.filter((n) => n.recipientUserId === actor) };
    },
    async unreadCount(): Promise<number> {
      return queryNotifications(await loadAll(), actor, { filter: "unread" }).total;
    },
    async create(input: NewNotification): Promise<Notification> {
      const existing = (await loadAll(true)).find((n) => n.idempotencyKey === input.idempotencyKey);
      if (existing) return existing; // retry-safe; never a second record
      const created = now().toISOString();
      const env: RecordEnvelope = {
        schemaVersion: 1, recordType: "notification", recordId: newRecordId("notification", random), createdAt: created, createdBy: actor,
        payload: { kind: "notification", eventId: input.eventId, idempotencyKey: input.idempotencyKey, type: input.type,
          recipientUserId: input.recipientUserId, bookingId: input.bookingId, title: input.title, message: input.message,
          isRead: false, readAt: null, deliveryStatus: "not_applicable", deliveredAt: null },
      };
      const saved = await deps.store.add(env);
      const n = toNotification(saved);
      if (!n) throw new StorageError("INVALID_RECORD", "Notification failed validation.");
      return n;
    },
    /** Marks one of the ACTOR's notifications read. Foreign or unknown ids are rejected. */
    async markRead(recordId: string): Promise<void> {
      const n = (await loadAll(true)).find((x) => x.recordId === recordId);
      if (!n || n.recipientUserId !== actor) throw new StorageError("NOT_FOUND", "Notification not found.");
      if (n.isRead) return;
      await writeBack(n, { isRead: true, readAt: now().toISOString() });
    },
    async markAllRead(): Promise<number> {
      const unread = queryNotifications(await loadAll(true), actor, { filter: "unread" }).items;
      let done = 0;
      for (const n of unread) { await writeBack(n, { isRead: true, readAt: now().toISOString() }); done++; }
      return done;
    },
    /** "delivered" requires evidence of actual delivery; persistence alone never counts. */
    async setDeliveryStatus(recordId: string, status: DeliveryStatus, confirmation?: { channel: string; confirmedAt: string }): Promise<void> {
      if (!(DELIVERY_STATUSES as readonly string[]).includes(status)) throw new StorageError("INVALID_RECORD", "Unknown delivery status.");
      if (status === "delivered" && (!confirmation || !confirmation.channel || Number.isNaN(Date.parse(confirmation.confirmedAt)))) {
        throw new StorageError("INVALID_RECORD", "Delivery confirmation is required to mark a notification delivered.");
      }
      const n = (await loadAll(true)).find((x) => x.recordId === recordId);
      if (!n || n.recipientUserId !== actor) throw new StorageError("NOT_FOUND", "Notification not found.");
      await writeBack(n, { deliveryStatus: status, deliveredAt: status === "delivered" ? confirmation!.confirmedAt : null });
    },
  };
}

export type NotificationRepo = ReturnType<typeof createNotificationRepo>;

/** Standard titles/messages for the booking events (no personal data beyond booking id). */
export function buildNotificationText(type: NotificationKind, bookingLabel: string, reason?: string | null): { title: string; message: string } {
  const label = bookingLabel.slice(0, 60);
  switch (type) {
    case "booking_created": return { title: "Booking submitted", message: `Booking ${label} was submitted and is waiting for approval.` };
    case "booking_approved": return { title: "Booking approved", message: `Booking ${label} was approved.` };
    case "booking_rejected": return { title: "Booking rejected", message: `Booking ${label} was rejected${reason ? `: ${reason.slice(0, 300)}` : "."}` };
    case "booking_cancelled": return { title: "Booking cancelled", message: `Booking ${label} was cancelled.` };
    case "booking_updated": return { title: "Booking updated", message: `Booking ${label} was updated.` };
    case "booking_reminder": return { title: "Booking reminder", message: `Reminder: booking ${label} is coming up.` };
    case "vehicle_assigned": return { title: "Vehicle assigned", message: `A vehicle was assigned for booking ${label}.` };
  }
}
