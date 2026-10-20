import type { CommentDTO, JoinEventResponse, PageResponse, PhotoDTO, UploadUrlResponse } from "@snapshare/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import QRCode from "qrcode";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import type { Event, Guest } from "../db/schema.ts";
import { env } from "../env.ts";
import { type AppEnv, hashToken, randomToken, requireGuest, resolveViewer } from "../lib/auth.ts";
import { cursor, toEventPublicDTO, toPhotoDTO } from "../lib/dto.ts";
import { body, notFound, parse } from "../lib/http.ts";
import { TokenBucket, clientIp, rateLimit } from "../lib/rate-limit.ts";
import { UPLOAD_URL_TTL_SECONDS, keys, presignUpload, s3 } from "../lib/storage.ts";
import { mediaQueue } from "../media/queue.ts";
import { realtime } from "../realtime/hub.ts";

const { photos, guests, photoLikes, photoComments } = schema;

const joinLimiter = new TokenBucket(20, 20 / 60);
const uploadLimiter = new TokenBucket(env.UPLOADS_PER_MINUTE, env.UPLOADS_PER_MINUTE / 60);
const socialLimiter = new TokenBucket(30, 0.5);

const byDevice = (c: { get(k: "guest"): Guest }) => c.get("guest").deviceId;

const ALLOWED_TYPES = ["image/jpeg", "image/heic", "image/heif", "image/png", "image/webp"] as const;

async function eventById(id: string) {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, id) });
  if (!event) notFound("Event");
  return event;
}

function assertGuestInEvent(guest: Guest, eventId: string) {
  if (guest.eventId !== eventId) throw new HTTPException(403, { message: "Not a guest of this event" });
}

function assertAcceptingUploads(event: Event) {
  const graceMs = 12 * 60 * 60 * 1000;
  const ended = event.endsAt && Date.now() > event.endsAt.getTime() + graceMs;
  if (!event.uploadsOpen || ended) throw new HTTPException(403, { message: "Uploads are closed for this event" });
}

/** Load a photo a guest is allowed to interact with (same event, public). */
async function guestVisiblePhoto(guest: Guest, photoId: string) {
  const photo = await db.query.photos.findFirst({
    where: and(eq(photos.id, photoId), eq(photos.status, "ready"), eq(photos.moderation, "approved")),
  });
  if (!photo || photo.eventId !== guest.eventId) notFound("Photo");
  return photo;
}

export const guestRoutes = new Hono<AppEnv>()
  // ─── Onboarding (QR code → join) ────────────────────────────────────────

  .get("/e/:slug", async (c) => {
    const event = await db.query.events.findFirst({ where: eq(schema.events.slug, c.req.param("slug").toLowerCase()) });
    if (!event) notFound("Event");
    return c.json(toEventPublicDTO(event));
  })

  .post("/e/:slug/join", rateLimit(joinLimiter, clientIp), async (c) => {
    const input = await body(
      c,
      z.object({
        deviceId: z.string().min(8).max(64),
        displayName: z.string().trim().max(60).nullish(),
        passcode: z.string().max(64).nullish(),
      }),
    );
    const event = await db.query.events.findFirst({ where: eq(schema.events.slug, c.req.param("slug").toLowerCase()) });
    if (!event) notFound("Event");

    if (event.passcodeHash) {
      const ok = input.passcode ? await Bun.password.verify(input.passcode, event.passcodeHash) : false;
      if (!ok) throw new HTTPException(401, { message: "Incorrect passcode" });
    }

    // Re-joining from the same device rotates the token but keeps the guest identity.
    const token = randomToken();
    const [guest] = await db
      .insert(guests)
      .values({
        eventId: event.id,
        deviceId: input.deviceId,
        displayName: input.displayName || null,
        tokenHash: hashToken(token),
      })
      .onConflictDoUpdate({
        target: [guests.eventId, guests.deviceId],
        set: { tokenHash: hashToken(token), displayName: input.displayName || null, lastSeenAt: new Date() },
      })
      .returning();
    if (guest!.isBlocked) throw new HTTPException(403, { message: "You have been removed from this event" });

    return c.json({ event: toEventPublicDTO(event), guestToken: token, guestId: guest!.id } satisfies JoinEventResponse);
  })

  // ─── Direct-to-S3 uploads ───────────────────────────────────────────────

  /**
   * Step 1: reserve a photo row and get a presigned PUT URL.
   * `clientId` makes this idempotent, so the offline queue can retry safely.
   */
  .get("/events/:id/upload-url", requireGuest, rateLimit(uploadLimiter, byDevice), async (c) => {
    const guest = c.get("guest");
    const eventId = c.req.param("id");
    assertGuestInEvent(guest, eventId);
    const q = parse(
      z.object({ clientId: z.string().min(8).max(64), contentType: z.enum(ALLOWED_TYPES).default("image/jpeg") }),
      c.req.query(),
    );
    const event = await eventById(eventId);
    assertAcceptingUploads(event);

    const id = crypto.randomUUID();
    const [created] = await db
      .insert(photos)
      .values({
        id,
        eventId,
        guestId: guest.id,
        clientId: q.clientId,
        originalKey: keys.original(eventId, id),
        mimeType: q.contentType,
        moderation: event.requireApproval ? "pending" : "approved",
      })
      .onConflictDoNothing({ target: [photos.guestId, photos.clientId] })
      .returning();

    const photo =
      created ??
      (await db.query.photos.findFirst({ where: and(eq(photos.guestId, guest.id), eq(photos.clientId, q.clientId)) }));
    if (!photo) throw new HTTPException(500, { message: "Could not reserve upload" });
    if (photo.status !== "pending_upload") {
      return c.json({ photoId: photo.id, status: photo.status, alreadyUploaded: true }, 409);
    }

    return c.json({
      photoId: photo.id,
      uploadUrl: presignUpload(photo.originalKey, photo.mimeType),
      headers: { "Content-Type": photo.mimeType },
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    } satisfies UploadUrlResponse);
  })

  /** Step 2: client confirms the PUT succeeded → verify object and enqueue processing. */
  .post("/photos/:id/complete", requireGuest, async (c) => {
    const guest = c.get("guest");
    const photo = await db.query.photos.findFirst({
      where: and(eq(photos.id, c.req.param("id")), eq(photos.guestId, guest.id)),
    });
    if (!photo) notFound("Photo");
    if (photo.status !== "pending_upload") return c.json({ photoId: photo.id, status: photo.status });

    const file = s3.file(photo.originalKey);
    const stat = await file.stat().catch(() => null);
    if (!stat) throw new HTTPException(409, { message: "Upload not found in storage — retry the PUT" });
    if (stat.size > env.MAX_UPLOAD_BYTES) {
      await Promise.allSettled([file.delete(), db.delete(photos).where(eq(photos.id, photo.id))]);
      throw new HTTPException(413, { message: "Photo exceeds maximum size" });
    }

    await db.update(photos).set({ status: "uploaded", sizeBytes: stat.size }).where(eq(photos.id, photo.id));
    await db.update(guests).set({ lastSeenAt: new Date() }).where(eq(guests.id, guest.id));
    mediaQueue.enqueue(photo.id);
    return c.json({ photoId: photo.id, status: "uploaded" }, 202);
  })

  // ─── Slideshow bootstrap ────────────────────────────────────────────────

  /** Event info + join QR for the TV/projector display (auth: ?key=<displayKey>). */
  .get("/events/:id/display", async (c) => {
    const event = await eventById(c.req.param("id"));
    const viewer = await resolveViewer(event, { displayKey: c.req.query("key") });
    if (!viewer) throw new HTTPException(401, { message: "Invalid display key" });
    const joinUrl = env.GUEST_JOIN_URL.replace("{slug}", event.slug);
    const qrSvg = await QRCode.toString(joinUrl, { type: "svg", margin: 0, color: { dark: "#ffffff", light: "#00000000" } });
    return c.json({ event: toEventPublicDTO(event), joinUrl, qrSvg });
  })

  // ─── Feed (guests, host, and slideshow displays) ────────────────────────

  .get("/events/:id/photos", async (c) => {
    const event = await eventById(c.req.param("id"));
    const auth = c.req.header("authorization");
    const viewer = await resolveViewer(event, {
      bearer: auth?.startsWith("Bearer ") ? auth.slice(7) : null,
      guestToken: c.req.header("x-guest-token"),
      displayKey: c.req.query("key"),
    });
    if (!viewer) throw new HTTPException(401, { message: "Unauthorized" });

    const q = parse(
      z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        filter: z.enum(["all", "pending", "hidden", "favorites"]).default("all"),
      }),
      c.req.query(),
    );

    const conds = [eq(photos.eventId, event.id), eq(photos.status, "ready")];
    if (viewer.role !== "host") conds.push(eq(photos.moderation, "approved"));
    else if (q.filter === "pending" || q.filter === "hidden") conds.push(eq(photos.moderation, q.filter));
    if (q.filter === "favorites") conds.push(eq(photos.isFavorite, true));

    const after = cursor.decode(q.cursor);
    if (after) conds.push(sql`(${photos.createdAt}, ${photos.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`);

    const guestId = viewer.role === "guest" ? viewer.guest.id : null;
    const rows = await db
      .select({
        photo: photos,
        guestName: guests.displayName,
        likedByMe: guestId
          ? sql<boolean>`exists(select 1 from ${photoLikes} where ${photoLikes.photoId} = ${photos.id} and ${photoLikes.guestId} = ${guestId})`
          : sql<boolean>`false`,
      })
      .from(photos)
      .leftJoin(guests, eq(guests.id, photos.guestId))
      .where(and(...conds))
      .orderBy(desc(photos.createdAt), desc(photos.id))
      .limit(q.limit + 1);

    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return c.json({
      items: page.map((r) => toPhotoDTO(r.photo, r.guestName, guestId ? r.likedByMe : undefined)),
      nextCursor: rows.length > q.limit && last ? cursor.encode(last.photo.createdAt, last.photo.id) : null,
    } satisfies PageResponse<PhotoDTO>);
  })

  // ─── Likes & comments ───────────────────────────────────────────────────

  .put("/photos/:id/like", requireGuest, rateLimit(socialLimiter, byDevice), async (c) => {
    const guest = c.get("guest");
    const photo = await guestVisiblePhoto(guest, c.req.param("id"));
    const likeCount = await db.transaction(async (tx) => {
      const inserted = await tx.insert(photoLikes).values({ photoId: photo.id, guestId: guest.id }).onConflictDoNothing().returning();
      if (!inserted.length) return photo.likeCount;
      const [p] = await tx
        .update(photos)
        .set({ likeCount: sql`${photos.likeCount} + 1` })
        .where(eq(photos.id, photo.id))
        .returning({ likeCount: photos.likeCount });
      return p!.likeCount;
    });
    realtime.photoLiked(photo.eventId, photo.id, likeCount);
    return c.json({ liked: true, likeCount });
  })

  .delete("/photos/:id/like", requireGuest, rateLimit(socialLimiter, byDevice), async (c) => {
    const guest = c.get("guest");
    const photo = await guestVisiblePhoto(guest, c.req.param("id"));
    const likeCount = await db.transaction(async (tx) => {
      const removed = await tx
        .delete(photoLikes)
        .where(and(eq(photoLikes.photoId, photo.id), eq(photoLikes.guestId, guest.id)))
        .returning();
      if (!removed.length) return photo.likeCount;
      const [p] = await tx
        .update(photos)
        .set({ likeCount: sql`greatest(${photos.likeCount} - 1, 0)` })
        .where(eq(photos.id, photo.id))
        .returning({ likeCount: photos.likeCount });
      return p!.likeCount;
    });
    realtime.photoLiked(photo.eventId, photo.id, likeCount);
    return c.json({ liked: false, likeCount });
  })

  .get("/photos/:id/comments", requireGuest, async (c) => {
    const photo = await guestVisiblePhoto(c.get("guest"), c.req.param("id"));
    const rows = await db
      .select({ comment: photoComments, guestName: guests.displayName })
      .from(photoComments)
      .leftJoin(guests, eq(guests.id, photoComments.guestId))
      .where(and(eq(photoComments.photoId, photo.id), eq(photoComments.isHidden, false)))
      .orderBy(photoComments.createdAt)
      .limit(200);
    return c.json(rows.map((r) => toCommentDTO(r.comment, r.guestName)));
  })

  .post("/photos/:id/comments", requireGuest, rateLimit(socialLimiter, byDevice), async (c) => {
    const guest = c.get("guest");
    const photo = await guestVisiblePhoto(guest, c.req.param("id"));
    const input = await body(c, z.object({ body: z.string().trim().min(1).max(280) }));
    const [comment] = await db.insert(photoComments).values({ photoId: photo.id, guestId: guest.id, body: input.body }).returning();
    const dto = toCommentDTO(comment!, guest.displayName);
    realtime.broadcastPublic(photo.eventId, { type: "comment.added", photoId: photo.id, comment: dto });
    return c.json(dto, 201);
  });

function toCommentDTO(c: typeof photoComments.$inferSelect, guestName: string | null): CommentDTO {
  return { id: c.id, photoId: c.photoId, guestName, body: c.body, createdAt: c.createdAt.toISOString() };
}
