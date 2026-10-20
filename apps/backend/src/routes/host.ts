import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import QRCode from "qrcode";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { type AppEnv, assertHostOwnsEvent, randomToken, requireHost } from "../lib/auth.ts";
import { toPhotoDTO } from "../lib/dto.ts";
import { body, notFound, randomSlug } from "../lib/http.ts";
import { presignDownload, s3 } from "../lib/storage.ts";
import { realtime } from "../realtime/hub.ts";
import { signDownloadPath } from "./downloads.ts";

const eventInput = z.object({
  name: z.string().min(1).max(160),
  location: z.string().max(255).nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  passcode: z.string().min(4).max(64).nullish(),
  requireApproval: z.boolean().optional(),
  uploadsOpen: z.boolean().optional(),
});

const joinUrl = (slug: string) => env.GUEST_JOIN_URL.replace("{slug}", slug);
const slideshowUrl = (e: { id: string; displayKey: string }) =>
  `${env.SLIDESHOW_URL}/?event=${e.id}&key=${encodeURIComponent(e.displayKey)}`;

async function hostEventView(e: typeof schema.events.$inferSelect) {
  const { passcodeHash, ...rest } = e;
  return { ...rest, hasPasscode: passcodeHash !== null, joinUrl: joinUrl(e.slug), slideshowUrl: slideshowUrl(e) };
}

export const hostRoutes = new Hono<AppEnv>()
  .use(requireHost)

  // ─── Events ─────────────────────────────────────────────────────────────

  .get("/events", async (c) => {
    const rows = await db.query.events.findMany({
      where: eq(schema.events.hostId, c.get("hostId")),
      orderBy: desc(schema.events.createdAt),
    });
    const counts = await photoCounts(c.get("hostId"));
    return c.json(await Promise.all(rows.map(async (e) => ({ ...(await hostEventView(e)), ...counts(e.id) }))));
  })

  .get("/events/:id", async (c) => {
    const event = await assertHostOwnsEvent(c.get("hostId"), c.req.param("id"));
    const counts = await photoCounts(c.get("hostId"), event.id);
    return c.json({ ...(await hostEventView(event)), ...counts(event.id) });
  })

  .post("/events", async (c) => {
    const input = await body(c, eventInput);
    const passcodeHash = input.passcode ? await Bun.password.hash(input.passcode) : null;

    // Retry on the (unlikely) slug collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const [event] = await db
        .insert(schema.events)
        .values({
          hostId: c.get("hostId"),
          slug: randomSlug(),
          name: input.name,
          location: input.location ?? null,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          passcodeHash,
          requireApproval: input.requireApproval ?? false,
          displayKey: randomToken(24),
        })
        .onConflictDoNothing({ target: schema.events.slug })
        .returning();
      if (event) return c.json(await hostEventView(event), 201);
    }
    throw new Error("Could not allocate event slug");
  })

  .patch("/events/:id", async (c) => {
    await assertHostOwnsEvent(c.get("hostId"), c.req.param("id"));
    const input = await body(c, eventInput.partial());
    const { passcode, ...rest } = input;
    const [event] = await db
      .update(schema.events)
      .set({
        ...rest,
        ...(passcode !== undefined && { passcodeHash: passcode ? await Bun.password.hash(passcode) : null }),
      })
      .where(eq(schema.events.id, c.req.param("id")))
      .returning();
    return c.json(await hostEventView(event!));
  })

  /** Rotate the slideshow key, e.g. if the display URL leaked. */
  .post("/events/:id/rotate-display-key", async (c) => {
    await assertHostOwnsEvent(c.get("hostId"), c.req.param("id"));
    const [event] = await db
      .update(schema.events)
      .set({ displayKey: randomToken(24) })
      .where(eq(schema.events.id, c.req.param("id")))
      .returning();
    return c.json(await hostEventView(event!));
  })

  // ─── QR code + printable flyer ──────────────────────────────────────────

  .get("/events/:id/qr.svg", async (c) => {
    const event = await assertHostOwnsEvent(c.get("hostId"), c.req.param("id"));
    const svg = await QRCode.toString(joinUrl(event.slug), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml" });
  })

  .get("/events/:id/flyer", async (c) => {
    const event = await assertHostOwnsEvent(c.get("hostId"), c.req.param("id"));
    const svg = await QRCode.toString(joinUrl(event.slug), { type: "svg", margin: 0, errorCorrectionLevel: "M" });
    return c.html(renderFlyer(event.name, event.slug, svg));
  })

  // ─── Moderation ─────────────────────────────────────────────────────────

  .patch("/photos/:id", async (c) => {
    const input = await body(
      c,
      z.object({ moderation: z.enum(["pending", "approved", "hidden"]).optional(), isFavorite: z.boolean().optional() }),
    );
    const photo = await findHostPhoto(c.get("hostId"), c.req.param("id"));
    const [updated] = await db.update(schema.photos).set(input).where(eq(schema.photos.id, photo.id)).returning();
    if (updated!.status === "ready") {
      realtime.photoModerated(toPhotoDTO(updated!, photo.guestName), photo.moderation);
    }
    return c.json(toPhotoDTO(updated!, photo.guestName));
  })

  .delete("/photos/:id", async (c) => {
    const photo = await findHostPhoto(c.get("hostId"), c.req.param("id"));
    await db.delete(schema.photos).where(eq(schema.photos.id, photo.id));
    await Promise.allSettled(
      [photo.originalKey, photo.thumbKey, photo.displayKey].filter(Boolean).map((k) => s3.delete(k!)),
    );
    realtime.photoRemoved(photo.eventId, photo.id);
    return c.body(null, 204);
  })

  .post("/guests/:id/block", async (c) => {
    const guest = await db.query.guests.findFirst({ where: eq(schema.guests.id, c.req.param("id")) });
    if (!guest) notFound("Guest");
    await assertHostOwnsEvent(c.get("hostId"), guest.eventId);
    await db.update(schema.guests).set({ isBlocked: true }).where(eq(schema.guests.id, guest.id));
    return c.body(null, 204);
  })

  // ─── Export ─────────────────────────────────────────────────────────────

  /** Issue a 5-minute signed link that streams the event's originals as a ZIP. */
  .post("/events/:id/download-link", async (c) => {
    const event = await assertHostOwnsEvent(c.get("hostId"), c.req.param("id"));
    const filter = c.req.query("filter") === "favorites" ? "favorites" : "all";
    return c.json({ path: await signDownloadPath(c.get("hostId"), event.id, filter) });
  })

  /**
   * Manifest of signed links to every original. A streamed ZIP endpoint
   * (or an async "export ready" email for large events) can build on this.
   */
  .get("/events/:id/originals", async (c) => {
    const event = await assertHostOwnsEvent(c.get("hostId"), c.req.param("id"));
    const rows = await db
      .select({ id: schema.photos.id, originalKey: schema.photos.originalKey, createdAt: schema.photos.createdAt })
      .from(schema.photos)
      .where(and(eq(schema.photos.eventId, event.id), eq(schema.photos.status, "ready")))
      .orderBy(schema.photos.createdAt);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        filename: `${event.slug}-${r.createdAt.toISOString().replace(/[:.]/g, "-")}.jpg`,
        url: presignDownload(r.originalKey),
      })),
    );
  });

/** Ready-photo counts per event for a host (optionally one event). */
async function photoCounts(hostId: string, eventId?: string) {
  const rows = await db
    .select({
      eventId: schema.photos.eventId,
      photoCount: sql<number>`count(*)::int`,
      pendingCount: sql<number>`(count(*) filter (where ${schema.photos.moderation} = 'pending'))::int`,
      favoriteCount: sql<number>`(count(*) filter (where ${schema.photos.isFavorite}))::int`,
      hiddenCount: sql<number>`(count(*) filter (where ${schema.photos.moderation} = 'hidden'))::int`,
    })
    .from(schema.photos)
    .innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
    .where(
      and(
        eq(schema.events.hostId, hostId),
        eq(schema.photos.status, "ready"),
        eventId ? eq(schema.photos.eventId, eventId) : undefined,
      ),
    )
    .groupBy(schema.photos.eventId);
  const byEvent = new Map(rows.map((r) => [r.eventId, r]));
  return (id: string) => {
    const r = byEvent.get(id);
    return {
      photoCount: r?.photoCount ?? 0,
      pendingCount: r?.pendingCount ?? 0,
      favoriteCount: r?.favoriteCount ?? 0,
      hiddenCount: r?.hiddenCount ?? 0,
    };
  };
}

async function findHostPhoto(hostId: string, photoId: string) {
  const [row] = await db
    .select({ photo: schema.photos, guestName: schema.guests.displayName })
    .from(schema.photos)
    .innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
    .leftJoin(schema.guests, eq(schema.guests.id, schema.photos.guestId))
    .where(and(eq(schema.photos.id, photoId), eq(schema.events.hostId, hostId)));
  if (!row) notFound("Photo");
  return { ...row.photo, guestName: row.guestName };
}

function renderFlyer(name: string, slug: string, qrSvg: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(name)} — SnapShare</title>
<style>
  @page { size: A5; margin: 0 }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; background: #fff }
  .card { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 8vh 10vw; box-sizing: border-box }
  .kicker { font: 600 12px/1 system-ui, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #8a7f72 }
  h1 { font-weight: 400; font-size: 34px; margin: 16px 0 28px }
  .qr { width: 56vmin; max-width: 300px }
  .qr svg { width: 100%; height: auto }
  p { font: 15px/1.5 system-ui, sans-serif; color: #555; max-width: 32ch }
  .code { font: 600 13px system-ui, sans-serif; letter-spacing: .2em; color: #8a7f72; margin-top: 8px }
</style></head>
<body onload="window.print()"><div class="card">
  <div class="kicker">Share your photos</div>
  <h1>${esc(name)}</h1>
  <div class="qr">${qrSvg}</div>
  <p>Scan with your phone camera, snap away, and watch your photos appear live on the big screen.</p>
  <div class="code">CODE: ${esc(slug.toUpperCase())}</div>
</div></body></html>`;
}
