import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import type { Event } from "../db/schema.ts";
import { env } from "../env.ts";
import { renditionLocations, s3 } from "./storage.ts";

/** Fields a host (or admin) can set on an event. */
export const eventInput = z.object({
  name: z.string().trim().min(1).max(160),
  location: z.string().max(255).nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  passcode: z.string().min(4).max(64).nullish(),
  requireApproval: z.boolean().optional(),
  uploadsOpen: z.boolean().optional(),
});
export type EventInput = z.infer<typeof eventInput>;

export const joinUrl = (slug: string) => env.GUEST_JOIN_URL.replace("{slug}", slug);
export const slideshowUrl = (e: { id: string; displayKey: string }) =>
  `${env.SLIDESHOW_URL}/?event=${e.id}&key=${encodeURIComponent(e.displayKey)}`;

/** What the dashboard sees for an event (never the passcode hash). */
export function hostEventView(e: Event) {
  const { passcodeHash, suspendedAt, ...rest } = e;
  return {
    ...rest,
    hasPasscode: passcodeHash !== null,
    suspended: suspendedAt !== null,
    suspendedAt,
    joinUrl: joinUrl(e.slug),
    slideshowUrl: slideshowUrl(e),
  };
}

/** Ready-photo counts per event. */
export async function photoCounts(eventIds: string[]) {
  const rows = eventIds.length
    ? await db
        .select({
          eventId: schema.photos.eventId,
          photoCount: sql<number>`count(*)::int`,
          pendingCount: sql<number>`(count(*) filter (where ${schema.photos.moderation} = 'pending'))::int`,
          favoriteCount: sql<number>`(count(*) filter (where ${schema.photos.isFavorite}))::int`,
          hiddenCount: sql<number>`(count(*) filter (where ${schema.photos.moderation} = 'hidden'))::int`,
        })
        .from(schema.photos)
        .where(and(eq(schema.photos.status, "ready"), inArray(schema.photos.eventId, eventIds)))
        .groupBy(schema.photos.eventId)
    : [];
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

export async function updateEvent(id: string, input: Partial<EventInput> & { suspended?: boolean }) {
  const { passcode, suspended, ...rest } = input;
  const [event] = await db
    .update(schema.events)
    .set({
      ...rest,
      ...(passcode !== undefined && { passcodeHash: passcode ? await Bun.password.hash(passcode) : null }),
      ...(suspended !== undefined && { suspendedAt: suspended ? new Date() : null }),
    })
    .where(eq(schema.events.id, id))
    .returning();
  return event;
}

/** Delete an event, its database rows (cascade) and every stored file of its photos. */
export async function deleteEventWithPhotos(eventId: string) {
  const files = await db
    .select({ a: schema.photos.originalKey, b: schema.photos.thumbKey, c: schema.photos.displayKey })
    .from(schema.photos)
    .where(eq(schema.photos.eventId, eventId));
  await db.delete(schema.events).where(eq(schema.events.id, eventId));

  const keys = files.flatMap((f) => [
    f.a,
    ...[f.b, f.c].filter((k): k is string => !!k).flatMap(renditionLocations),
  ]);
  // Delete in small batches so a big event doesn't open thousands of connections at once.
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.allSettled(keys.slice(i, i + 20).map((k) => s3.delete(k)));
  }
  return keys.length;
}
