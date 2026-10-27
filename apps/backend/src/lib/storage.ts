import { S3Client } from "bun";
import { env } from "../env.ts";

/**
 * Bun's native S3 client — works with AWS S3, Cloudflare R2, DO Spaces and MinIO.
 *
 * Key layout:
 *   originals/{eventId}/{photoId}             private, full-resolution upload
 *   public/{eventId}/{photoId}/thumb.webp     world-readable (CDN), ~480px
 *   public/{eventId}/{photoId}/display.webp   world-readable (CDN), ~2048px
 *   private/{eventId}/{photoId}/…             the same renditions while a photo is pending or hidden
 *
 * The DB always stores the public/ key; a photo's renditions sit there only while it's approved,
 * so hiding a photo also kills any URL to it that was already shared.
 */
const credentials = {
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
};

/** Used by the server itself (may be an internal address, e.g. http://s3:9000 in Docker). */
export const s3 = new S3Client({ ...credentials, endpoint: env.S3_ENDPOINT });

/** Signs URLs that phones/browsers will call — the signature covers the host, so it must be public. */
const signer = env.S3_PRESIGN_ENDPOINT ? new S3Client({ ...credentials, endpoint: env.S3_PRESIGN_ENDPOINT }) : s3;

export const keys = {
  original: (eventId: string, photoId: string) => `originals/${eventId}/${photoId}`,
  thumb: (eventId: string, photoId: string) => `public/${eventId}/${photoId}/thumb.webp`,
  display: (eventId: string, photoId: string) => `public/${eventId}/${photoId}/display.webp`,
};

/** Where a rendition (stored by its public/ key) lives while the photo isn't approved. */
export const hiddenKey = (publicKey: string) => publicKey.replace(/^public\//, "private/");

/** Both locations a rendition may occupy — for deletes. */
export const renditionLocations = (publicKey: string) => [publicKey, hiddenKey(publicKey)];

/**
 * Move a photo's renditions to public/ (visible) or private/ (not). Idempotent: a rendition
 * already in place is left alone, so repeating a failed approve/hide fixes things up.
 */
export async function setRenditionVisibility(publicKeys: (string | null)[], visible: boolean) {
  for (const key of publicKeys) {
    if (!key) continue;
    const [from, to] = visible ? [hiddenKey(key), key] : [key, hiddenKey(key)];
    const src = s3.file(from);
    if (!(await src.exists())) continue;
    await s3.write(to, await src.arrayBuffer(), { type: "image/webp" });
    await src.delete();
  }
}

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export function presignUpload(key: string, contentType: string) {
  return signer.presign(key, {
    method: "PUT",
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    type: contentType,
  });
}

/** Short-lived signed GET for original files (host downloads). */
export function presignDownload(key: string, expiresIn = 3600) {
  return signer.presign(key, { method: "GET", expiresIn });
}

export function publicUrl(key: string) {
  return `${env.S3_PUBLIC_URL}/${key}`;
}
