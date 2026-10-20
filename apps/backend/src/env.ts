import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_APP_URL: z.string().url(),
  /** What the QR code encodes — must be http(s) so any phone camera can open it. */
  GUEST_JOIN_URL: z.string().default("http://localhost:3000/join/{slug}"),
  /** Where the join page sends guests: the native app (or Expo Go in dev). */
  APP_LINK_TEMPLATE: z.string().default("snapshare://join/{slug}"),
  SLIDESHOW_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_PUBLIC_URL: z.string().url(),

  MAX_UPLOAD_BYTES: z.coerce.number().default(15 * 1024 * 1024),
  UPLOADS_PER_MINUTE: z.coerce.number().default(30),
  MEDIA_WORKERS: z.coerce.number().int().min(1).default(2),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
