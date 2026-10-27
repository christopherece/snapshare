import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { toPhotoDTO } from "../lib/dto.ts";
import { setRenditionVisibility } from "../lib/storage.ts";
import { realtime } from "../realtime/hub.ts";
import type { MediaJob, MediaJobResult } from "./types.ts";

const MAX_ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 60_000;

interface Slot {
  worker: Worker;
  job: MediaJob | null;
  timer: Timer | null;
}

/**
 * Small in-process job queue backed by Bun worker threads.
 * Postgres `photos.status` is the source of truth, so on restart any
 * photo stuck in "uploaded"/"processing" is simply re-enqueued.
 *
 * Swap for BullMQ when you need multiple backend instances.
 */
class MediaQueue {
  private slots: Slot[] = [];
  private pending: string[] = [];
  private queued = new Set<string>();

  start(concurrency = env.MEDIA_WORKERS) {
    for (let i = 0; i < concurrency; i++) this.slots.push(this.spawn());
  }

  enqueue(photoId: string) {
    if (this.queued.has(photoId)) return;
    this.queued.add(photoId);
    this.pending.push(photoId);
    this.pump();
  }

  /** Re-enqueue work interrupted by a crash/restart. */
  async recover() {
    const stuck = await db
      .select({ id: schema.photos.id })
      .from(schema.photos)
      .where(inArray(schema.photos.status, ["uploaded", "processing"]));
    for (const { id } of stuck) this.enqueue(id);
    if (stuck.length) console.log(`[media] recovered ${stuck.length} job(s)`);
  }

  private spawn(): Slot {
    const worker = new Worker(new URL("./media.worker.ts", import.meta.url).href);
    const slot: Slot = { worker, job: null, timer: null };
    worker.onmessage = (e: MessageEvent<MediaJobResult>) => this.onResult(slot, e.data);
    worker.onerror = (e) => {
      console.error("[media] worker crashed:", e.message);
      this.replace(slot, "worker crashed");
    };
    return slot;
  }

  private replace(slot: Slot, reason: string) {
    const job = slot.job;
    if (slot.timer) clearTimeout(slot.timer);
    slot.worker.terminate();
    const idx = this.slots.indexOf(slot);
    if (idx !== -1) this.slots[idx] = this.spawn();
    if (job) void this.fail(job.photoId, reason);
    this.pump();
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.job) continue;
      const photoId = this.pending.shift();
      if (!photoId) return;
      void this.dispatch(slot, photoId);
    }
  }

  private async dispatch(slot: Slot, photoId: string) {
    // Reserve the slot synchronously so pump() doesn't double-book it.
    slot.job = { jobId: crypto.randomUUID(), photoId, eventId: "", originalKey: "", visible: false };
    try {
      const [photo] = await db
        .update(schema.photos)
        .set({ status: "processing", processingAttempts: sql`${schema.photos.processingAttempts} + 1` })
        .where(and(eq(schema.photos.id, photoId), inArray(schema.photos.status, ["uploaded", "processing", "failed"])))
        .returning();
      if (!photo) {
        this.finish(slot, photoId);
        return;
      }
      slot.job = {
        ...slot.job,
        eventId: photo.eventId,
        originalKey: photo.originalKey,
        visible: photo.moderation === "approved",
      };
      slot.timer = setTimeout(() => this.replace(slot, "timed out"), JOB_TIMEOUT_MS);
      slot.worker.postMessage(slot.job);
    } catch (err) {
      console.error("[media] dispatch failed:", err);
      this.finish(slot, photoId);
    }
  }

  private finish(slot: Slot, photoId: string) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.job = null;
    slot.timer = null;
    this.queued.delete(photoId);
    this.pump();
  }

  private async onResult(slot: Slot, result: MediaJobResult) {
    const job = slot.job;
    if (!job || job.jobId !== result.jobId) return;
    this.finish(slot, job.photoId);

    if (!result.ok) {
      await this.fail(job.photoId, result.error);
      return;
    }

    const [photo] = await db
      .update(schema.photos)
      .set({
        status: "ready",
        thumbKey: result.thumbKey,
        displayKey: result.displayKey,
        width: result.width,
        height: result.height,
        takenAt: result.takenAt ? new Date(result.takenAt) : null,
        exif: result.exif,
        processingError: null,
      })
      .where(eq(schema.photos.id, job.photoId))
      .returning();
    if (!photo) return;

    // The host may have approved/hidden the photo while it was being processed.
    const visible = photo.moderation === "approved";
    if (visible !== job.visible) {
      await setRenditionVisibility([photo.thumbKey, photo.displayKey], visible).catch((err) =>
        console.error(`[media] ${photo.id}: could not move renditions`, err),
      );
    }

    const guest = photo.guestId
      ? await db.query.guests.findFirst({ where: eq(schema.guests.id, photo.guestId), columns: { displayName: true } })
      : null;
    realtime.photoReady(toPhotoDTO(photo, guest?.displayName ?? null));
  }

  private async fail(photoId: string, error: string) {
    this.queued.delete(photoId);
    const [photo] = await db
      .update(schema.photos)
      .set({ status: "failed", processingError: error.slice(0, 500) })
      .where(eq(schema.photos.id, photoId))
      .returning({ attempts: schema.photos.processingAttempts });
    console.warn(`[media] ${photoId} failed (attempt ${photo?.attempts}): ${error}`);
    if (photo && photo.attempts < MAX_ATTEMPTS) {
      setTimeout(() => this.enqueue(photoId), 2 ** photo.attempts * 1000);
    }
  }
}

export const mediaQueue = new MediaQueue();

/**
 * Renditions of pending/hidden photos processed before private/ existed still sit in public/.
 * Move them on startup (idempotent — photos already in place are skipped).
 */
export async function hideUnapprovedRenditions() {
  const rows = await db
    .select({ id: schema.photos.id, thumbKey: schema.photos.thumbKey, displayKey: schema.photos.displayKey })
    .from(schema.photos)
    .where(and(eq(schema.photos.status, "ready"), ne(schema.photos.moderation, "approved")));
  for (const r of rows) {
    await setRenditionVisibility([r.thumbKey, r.displayKey], false).catch((err) =>
      console.error(`[media] ${r.id}: could not hide renditions`, err),
    );
  }
}

/** Remove rows whose upload was never completed (app killed, URL expired…). */
export function scheduleAbandonedUploadCleanup() {
  const run = () =>
    db
      .delete(schema.photos)
      .where(and(eq(schema.photos.status, "pending_upload"), lt(schema.photos.createdAt, sql`now() - interval '24 hours'`)))
      .catch((err) => console.error("[cleanup]", err));
  setInterval(run, 60 * 60_000).unref();
}
