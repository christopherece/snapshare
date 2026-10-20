import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_APP_URL: z.string().url(),
  /** What the QR code encodes: the guest web app. Must be http(s) so any phone camera can open it. */
  GUEST_JOIN_URL: z.string().default("http://localhost:5175/join/{slug}"),
  /** Where the "open in app" page (/open/:slug) sends guests: the native app (or Expo Go in dev). */
  APP_LINK_TEMPLATE: z.string().default("snapshare://join/{slug}"),
  SLIDESHOW_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),

  S3_ENDPOINT: z.string().url().optional(),
  /** Public endpoint used only to sign upload/download URLs (defaults to S3_ENDPOINT).
   *  In Docker: S3_ENDPOINT=http://s3:9000 (internal), this=https://media.example.com. */
  S3_PRESIGN_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_PUBLIC_URL: z.string().url(),

  MAX_UPLOAD_BYTES: z.coerce.number().default(15 * 1024 * 1024),
  UPLOADS_PER_MINUTE: z.coerce.number().default(30),
  MEDIA_WORKERS: z.coerce.number().int().min(1).default(2),

  /** Production: directory holding the built web apps (host/, slideshow/) to serve. */
  STATIC_DIR: z.string().optional(),
  /** Production: apply pending DB migrations on startup. */
  RUN_MIGRATIONS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
