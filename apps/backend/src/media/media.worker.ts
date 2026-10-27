/// <reference lib="webworker" />
/**
 * Runs in a Bun worker thread: downloads the original, auto-orients it,
 * writes WebP thumbnail + display renditions, and extracts safe EXIF fields.
 * Sharp strips all metadata (including GPS) from outputs by default.
 */
import exifr from "exifr";
import sharp from "sharp";
import { hiddenKey, keys, s3 } from "../lib/storage.ts";
import type { MediaJob, MediaJobResult } from "./types.ts";

declare const self: Worker;

const THUMB_SIZE = 480;
const DISPLAY_SIZE = 2048;
/** Refuse decompression bombs: sharp's default (~268 MP) can need ~1 GB of RAM per worker. 100 MP covers any phone camera. */
const MAX_INPUT_PIXELS = 100_000_000;

const EXIF_FIELDS = [
  "Make",
  "Model",
  "LensModel",
  "DateTimeOriginal",
  "ExposureTime",
  "FNumber",
  "ISO",
  "FocalLength",
] as const;

async function process(job: MediaJob): Promise<MediaJobResult> {
  const original = Buffer.from(await s3.file(job.originalKey).arrayBuffer());

  const exif = await exifr.parse(original, { pick: [...EXIF_FIELDS] }).catch(() => null);
  const takenAt = exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.toISOString() : null;

  // .rotate() with no args applies EXIF orientation, so outputs are upright.
  const base = sharp(original, { failOn: "truncated", limitInputPixels: MAX_INPUT_PIXELS }).rotate();

  const [display, thumb] = await Promise.all([
    base
      .clone()
      .resize(DISPLAY_SIZE, DISPLAY_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }),
    base
      .clone()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer(),
  ]);

  const thumbKey = keys.thumb(job.eventId, job.photoId);
  const displayKey = keys.display(job.eventId, job.photoId);
  // Renditions are immutable per key — configure long Cache-Control on the CDN for public/*.
  const at = (key: string) => (job.visible ? key : hiddenKey(key));
  await Promise.all([
    s3.write(at(thumbKey), thumb, { type: "image/webp" }),
    s3.write(at(displayKey), display.data, { type: "image/webp" }),
  ]);

  return {
    jobId: job.jobId,
    ok: true,
    thumbKey,
    displayKey,
    width: display.info.width,
    height: display.info.height,
    takenAt,
    exif: exif ? Object.fromEntries(Object.entries(exif).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) : null,
  };
}

self.onmessage = async (e: MessageEvent<MediaJob>) => {
  let result: MediaJobResult;
  try {
    result = await process(e.data);
  } catch (err) {
    result = { jobId: e.data.jobId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(result);
};
