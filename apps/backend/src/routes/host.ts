import { and, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import QRCode from "qrcode";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import type { Host } from "../db/schema.ts";
import { env } from "../env.ts";
import { type AppEnv, assertCanManageEvent, randomToken, requireHost } from "../lib/auth.ts";
import { toPhotoDTO } from "../lib/dto.ts";
import { eventInput, hostEventView, joinUrl, photoCounts, updateEvent } from "../lib/events.ts";
import { body, notFound, randomSlug } from "../lib/http.ts";
import { presignDownload, renditionLocations, s3, setRenditionVisibility } from "../lib/storage.ts";
import { realtime } from "../realtime/hub.ts";
import { signDownloadPath } from "./downloads.ts";

/** Event limit for a host account (null = unlimited, for admins). */
export const eventLimitFor = (host: Host) => (host.role === "admin" ? null : env.HOST_EVENT_LIMIT);

export const hostRoutes = new Hono<AppEnv>()
  .use(requireHost)

  // ─── Events ─────────────────────────────────────────────────────────────

  /** The signed-in host's own events (admins see everyone's on the Admin page). */
  .get("/events", async (c) => {
    const rows = await db.query.events.findMany({
      where: eq(schema.events.hostId, c.get("hostId")),
      orderBy: desc(schema.events.createdAt),
    });
    const counts = await photoCounts(rows.map((e) => e.id));
    return c.json(rows.map((e) => ({ ...hostEventView(e), ...counts(e.id) })));
  })

  .get("/events/:id", async (c) => {
    const event = await assertCanManageEvent(c.get("host"), c.req.param("id"));
    const counts = await photoCounts([event.id]);
    const owner = await db.query.hosts.findFirst({
      where: eq(schema.hosts.id, event.hostId),
      columns: { id: true, name: true, email: true },
    });
    return c.json({ ...hostEventView(event), ...counts(event.id), owner });
  })

  .post("/events", async (c) => {
    const host = c.get("host");
    const limit = eventLimitFor(host);
    if (limit !== null) {
      const [{ n }] = (await db.select({ n: count() }).from(schema.events).where(eq(schema.events.hostId, host.id))) as [
        { n: number },
      ];
      if (n >= limit) {
        throw new HTTPException(403, {
          message: `Your account includes ${limit} event${limit === 1 ? "" : "s"}. Contact the organiser for another.`,
        });
      }
    }

    const input = await body(c, eventInput);
    const passcodeHash = input.passcode ? await Bun.password.hash(input.passcode) : null;

    // Retry on the (unlikely) slug collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const [event] = await db
        .insert(schema.events)
        .values({
          hostId: host.id,
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
      if (event) return c.json(hostEventView(event), 201);
    }
    throw new Error("Could not allocate event slug");
  })

  .patch("/events/:id", async (c) => {
    const event = await assertCanManageEvent(c.get("host"), c.req.param("id"));
    const input = await body(c, eventInput.partial());
    return c.json(hostEventView((await updateEvent(event.id, input))!));
  })

  /** Rotate the slideshow key, e.g. if the display URL leaked. */
  .post("/events/:id/rotate-display-key", async (c) => {
    const event = await assertCanManageEvent(c.get("host"), c.req.param("id"));
    const [updated] = await db
      .update(schema.events)
      .set({ displayKey: randomToken(24) })
      .where(eq(schema.events.id, event.id))
      .returning();
    return c.json(hostEventView(updated!));
  })

  // ─── QR code + printable flyer ──────────────────────────────────────────

  .get("/events/:id/qr.svg", async (c) => {
    const event = await assertCanManageEvent(c.get("host"), c.req.param("id"));
    const svg = await QRCode.toString(joinUrl(event.slug), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml" });
  })

  .get("/events/:id/flyer", async (c) => {
    const event = await assertCanManageEvent(c.get("host"), c.req.param("id"));
    const svg = await QRCode.toString(joinUrl(event.slug), { type: "svg", margin: 0, errorCorrectionLevel: "M" });
    return c.html(renderFlyer(event.name, event.slug, svg));
  })

  // ─── Moderation ─────────────────────────────────────────────────────────

  .patch("/photos/:id", async (c) => {
    const input = await body(
      c,
      z.object({ moderation: z.enum(["pending", "approved", "hidden"]).optional(), isFavorite: z.boolean().optional() }),
    );
    const photo = await findManagedPhoto(c.get("host"), c.req.param("id"));
    // Move the renditions before saving, so a hidden photo is never left on the public CDN.
    // (Still-processing photos are handled when the media queue finishes them.)
    if (input.moderation && photo.status === "ready") {
      await setRenditionVisibility([photo.thumbKey, photo.displayKey], input.moderation === "approved");
    }
    const [updated] = await db.update(schema.photos).set(input).where(eq(schema.photos.id, photo.id)).returning();
    if (updated!.status === "ready") {
      realtime.photoModerated(toPhotoDTO(updated!, photo.guestName), photo.moderation);
    }
    return c.json(toPhotoDTO(updated!, photo.guestName));
  })

  .delete("/photos/:id", async (c) => {
    const photo = await findManagedPhoto(c.get("host"), c.req.param("id"));
    await db.delete(schema.photos).where(eq(schema.photos.id, photo.id));
    await Promise.allSettled(
      [photo.originalKey, ...[photo.thumbKey, photo.displayKey].filter(Boolean).flatMap((k) => renditionLocations(k!))].map(
        (k) => s3.delete(k),
      ),
    );
    realtime.photoRemoved(photo.eventId, photo.id);
    return c.body(null, 204);
  })

  .post("/guests/:id/block", async (c) => {
    const guest = await db.query.guests.findFirst({ where: eq(schema.guests.id, c.req.param("id")) });
    if (!guest) notFound("Guest");
    await assertCanManageEvent(c.get("host"), guest.eventId);
    await db.update(schema.guests).set({ isBlocked: true }).where(eq(schema.guests.id, guest.id));
    return c.body(null, 204);
  })

  // ─── Export ─────────────────────────────────────────────────────────────

  /** Issue a 5-minute signed link that streams the event's originals as a ZIP. */
  .post("/events/:id/download-link", async (c) => {
    const event = await assertCanManageEvent(c.get("host"), c.req.param("id"));
    const filter = c.req.query("filter") === "favorites" ? "favorites" : "all";
    return c.json({ path: await signDownloadPath(c.get("hostId"), event.id, filter) });
  })

  /** Manifest of signed links to every original. */
  .get("/events/:id/originals", async (c) => {
    const event = await assertCanManageEvent(c.get("host"), c.req.param("id"));
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

async function findManagedPhoto(host: Host, photoId: string) {
  const [row] = await db
    .select({ photo: schema.photos, guestName: schema.guests.displayName })
    .from(schema.photos)
    .leftJoin(schema.guests, eq(schema.guests.id, schema.photos.guestId))
    .where(eq(schema.photos.id, photoId));
  if (!row) notFound("Photo");
  await assertCanManageEvent(host, row.photo.eventId);
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
