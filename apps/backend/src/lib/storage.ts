import { S3Client } from "bun";
import { env } from "../env.ts";

/**
 * Bun's native S3 client — works with AWS S3, Cloudflare R2, DO Spaces and MinIO.
 *
 * Key layout:
 *   originals/{eventId}/{photoId}             private, full-resolution upload
 *   public/{eventId}/{photoId}/thumb.webp     world-readable (CDN), ~480px
 *   public/{eventId}/{photoId}/display.webp   world-readable (CDN), ~2048px
 */
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

export const keys = {
  original: (eventId: string, photoId: string) => `originals/${eventId}/${photoId}`,
  thumb: (eventId: string, photoId: string) => `public/${eventId}/${photoId}/thumb.webp`,
  display: (eventId: string, photoId: string) => `public/${eventId}/${photoId}/display.webp`,
};

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

export function presignUpload(key: string, contentType: string) {
  return s3.presign(key, {
    method: "PUT",
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    type: contentType,
  });
}

/** Short-lived signed GET for original files (host downloads). */
export function presignDownload(key: string, expiresIn = 3600) {
  return s3.presign(key, { method: "GET", expiresIn });
}

export function publicUrl(key: string) {
  return `${env.S3_PUBLIC_URL}/${key}`;
}
