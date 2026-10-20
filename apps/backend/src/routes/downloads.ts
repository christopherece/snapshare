import { downloadZip } from "client-zip";
import { and, asc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "hono/jwt";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { assertCanManageEvent } from "../lib/auth.ts";
import { s3 } from "../lib/storage.ts";

const { photos, guests } = schema;
const TOKEN_TTL_SECONDS = 5 * 60;

export type DownloadFilter = "all" | "favorites";

/**
 * Browsers can't attach an Authorization header to a plain file download, so the
 * dashboard first asks for a short-lived signed link (see host routes), then
 * navigates to it. The link is scoped to one event and expires in 5 minutes.
 */
export async function signDownloadPath(hostId: string, eventId: string, filter: DownloadFilter) {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    { sub: hostId, evt: eventId, filter, scope: "download", iat: now, exp: now + TOKEN_TTL_SECONDS },
    env.JWT_SECRET,
    "HS256",
  );
  return `/api/downloads/${token}`;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/png": "png",
  "image/webp": "webp",
};

const safe = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);

export const downloadRoutes = new Hono().get("/:token", async (c) => {
  const payload = await verify(c.req.param("token"), env.JWT_SECRET, "HS256").catch(() => null);
  if (!payload || payload.scope !== "download" || typeof payload.evt !== "string") {
    throw new HTTPException(401, { message: "Download link is invalid or has expired" });
  }

  // Re-check at download time: the account may have been disabled or the event suspended since.
  const host = await db.query.hosts.findFirst({ where: eq(schema.hosts.id, String(payload.sub)) });
  if (!host || host.disabledAt) throw new HTTPException(401, { message: "Download link is invalid or has expired" });
  const event = await assertCanManageEvent(host, payload.evt);

  const conds = [eq(photos.eventId, event.id), eq(photos.status, "ready"), ne(photos.moderation, "hidden")];
  if (payload.filter === "favorites") conds.push(eq(photos.isFavorite, true));

  const rows = await db
    .select({
      originalKey: photos.originalKey,
      mimeType: photos.mimeType,
      sizeBytes: photos.sizeBytes,
      takenAt: photos.takenAt,
      createdAt: photos.createdAt,
      guestName: guests.displayName,
    })
    .from(photos)
    .leftJoin(guests, eq(guests.id, photos.guestId))
    .where(and(...conds))
    .orderBy(asc(photos.createdAt));

  if (!rows.length) throw new HTTPException(404, { message: "No photos to download yet" });

  // Chronological, numbered, with the photographer's name when known: "0042-Sarah.jpg"
  const files = rows.map((r, i) => ({
    name: `${String(i + 1).padStart(4, "0")}${r.guestName ? `-${safe(r.guestName)}` : ""}.${EXT[r.mimeType] ?? "jpg"}`,
    lastModified: r.takenAt ?? r.createdAt,
    size: r.sizeBytes ?? undefined,
    key: r.originalKey,
  }));

  // Lazily open one storage stream at a time while the ZIP is being written.
  async function* entries() {
    for (const f of files) {
      yield { name: f.name, lastModified: f.lastModified, input: s3.file(f.key).stream() };
    }
  }

  // With every size known, client-zip computes the exact Content-Length (for browser progress bars).
  // NOTE: Bun 1.4 currently sends this S3-backed stream chunked and drops the header; harmless.
  const allSized = files.every((f) => f.size !== undefined);
  const zip = downloadZip(entries(), allSized ? { metadata: files.map((f) => ({ name: f.name, size: f.size! })) } : {});

  const base = safe(event.name) || event.slug;
  const filename = `${base}${payload.filter === "favorites" ? "-favorites" : ""}.zip`;
  const headers = new Headers(zip.headers);
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "no-store");
  return new Response(zip.body, { status: 200, headers });
});
