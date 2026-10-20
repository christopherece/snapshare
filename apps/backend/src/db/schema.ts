import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// precision: 3 (ms) so timestamps round-trip exactly through JS Date — required by the feed's keyset cursor.
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─── Hosts ──────────────────────────────────────────────────────────────────

export const hostRole = pgEnum("host_role", ["admin", "host"]);

export const hosts = pgTable("hosts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  /** Admins manage host accounts and invites. */
  role: hostRole("role").notNull().default("host"),
  /** Disabled accounts can't sign in; existing sessions stop working immediately. */
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  ...timestamps,
});

/** Single-use links that let someone create a host account when registration is invite-only. */
export const hostInvites = pgTable("host_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** SHA-256 of the invite token; the raw token is only shown once, to the admin who created it. */
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  /** Who it's for — a reminder for the admin, e.g. "Sarah (wedding)". */
  note: varchar("note", { length: 120 }),
  createdBy: uuid("created_by").references(() => hosts.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: uuid("used_by").references(() => hosts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Events ─────────────────────────────────────────────────────────────────

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id, { onDelete: "cascade" }),
    /** Short, URL-safe code embedded in the QR code (e.g. "k7m2xq"). */
    slug: varchar("slug", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 160 }).notNull(),
    location: varchar("location", { length: 255 }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Optional guest passcode (hashed with Bun.password). */
    passcodeHash: text("passcode_hash"),
    /** When true, photos stay "pending" until the host approves them. */
    requireApproval: boolean("require_approval").notNull().default(false),
    /** Host can close uploads after the event without deleting it. */
    uploadsOpen: boolean("uploads_open").notNull().default(true),
    /** Secret for the read-only slideshow display (TV/projector). */
    displayKey: varchar("display_key", { length: 64 }).notNull(),
    coverKey: text("cover_key"),
    ...timestamps,
  },
  (t) => [index("events_host_idx").on(t.hostId)],
);

// ─── Guests (anonymous, per-device sessions) ────────────────────────────────

export const guests = pgTable(
  "guests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Stable, client-generated install ID — used for rate limiting & re-joins. */
    deviceId: varchar("device_id", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 60 }),
    /** SHA-256 of the bearer token; the raw token is only ever sent to the device. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    isBlocked: boolean("is_blocked").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("guests_event_device_uq").on(t.eventId, t.deviceId)],
);

// ─── Photos ─────────────────────────────────────────────────────────────────

export const photoStatus = pgEnum("photo_status", [
  "pending_upload", // row created, presigned URL issued
  "uploaded", // client confirmed upload, waiting for processing
  "processing",
  "ready",
  "failed",
]);

export const moderationStatus = pgEnum("moderation_status", ["pending", "approved", "hidden"]);

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
    /** Client-generated ID so retries from the offline queue are idempotent. */
    clientId: varchar("client_id", { length: 64 }).notNull(),

    status: photoStatus("status").notNull().default("pending_upload"),
    moderation: moderationStatus("moderation").notNull().default("approved"),
    isFavorite: boolean("is_favorite").notNull().default(false),

    originalKey: text("original_key").notNull(),
    thumbKey: text("thumb_key"),
    displayKey: text("display_key"),
    mimeType: varchar("mime_type", { length: 64 }).notNull().default("image/jpeg"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    /** Whitelisted EXIF fields only — GPS is never stored. */
    exif: jsonb("exif").$type<Record<string, unknown>>(),

    likeCount: integer("like_count").notNull().default(0),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    processingError: text("processing_error"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("photos_guest_client_uq").on(t.guestId, t.clientId),
    // Feed query: newest ready photos for an event.
    index("photos_event_feed_idx")
      .on(t.eventId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'ready'`),
    index("photos_status_idx").on(t.status),
  ],
);

// ─── Social ─────────────────────────────────────────────────────────────────

export const photoLikes = pgTable(
  "photo_likes",
  {
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => guests.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.guestId] })],
);

export const photoComments = pgTable(
  "photo_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
    body: varchar("body", { length: 280 }).notNull(),
    isHidden: boolean("is_hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("photo_comments_photo_idx").on(t.photoId, t.createdAt)],
);

export type Host = typeof hosts.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Guest = typeof guests.$inferSelect;
export type Photo = typeof photos.$inferSelect;
