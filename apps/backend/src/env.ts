import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_APP_URL: z.string().url(),
  /** What the QR code encodes: the guest web app. Must be http(s) so any phone camera can open it. */
  GUEST_JOIN_URL: z.string().default("http://localhost:5175/join/{slug}"),
  /** Store listings of the native app. When set, guests on that platform are offered the app instead of the web install. */
  APP_STORE_URL: z.string().url().optional(),
  PLAY_STORE_URL: z.string().url().optional(),
  /** Where the "open in app" page (/open/:slug) sends guests: the native app (or Expo Go in dev). */
  APP_LINK_TEMPLATE: z.string().default("snapshare://join/{slug}"),
  /**
   * Lets https://<this domain>/join/<code> open the native app directly when it's installed (iOS universal
   * links / Android app links). Leave unset until the app is published; the links then just open the web app.
   *   IOS_APP_ID                "<Apple Team ID>.<bundle identifier>", e.g. ABCDE12345.com.snapshare.app
   *   ANDROID_APP_PACKAGE       the application id (default com.snapshare.app)
   *   ANDROID_APP_FINGERPRINTS  SHA-256 signing-certificate fingerprints, comma-separated (`eas credentials`
   *                             for the upload key, Play Console → App integrity for the Play signing key)
   */
  // An empty value (e.g. `IOS_APP_ID=` copied from the example) means "not set", not an invalid ID.
  IOS_APP_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/).optional()),
  ANDROID_APP_PACKAGE: z.string().default("com.snapshare.app"),
  ANDROID_APP_FINGERPRINTS: z.string().optional(),
  SLIDESHOW_URL: z.string().url(),

  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),

  /** Shown on the Guest terms / Privacy notice pages (/terms, /privacy). */
  OPERATOR_NAME: z.string().default("TopITSolutions"),
  /** Where guests and hosts can ask about their photos or request removal. Shown on the legal pages. */
  CONTACT_EMAIL: z.string().email().default("chris.ancheta@topitsolutions.co.nz"),
  /** A photo reported by this many different guests is hidden until the host reviews it (0 = never). */
  REPORTS_TO_AUTO_HIDE: z.coerce.number().int().min(0).default(3),

  /** "invite" (default): new host accounts need an invite link from an admin. "open": anyone can sign up. */
  REGISTRATION: z.enum(["invite", "open"]).default("invite"),
  /** This host account is made admin on startup (comma-separate several). */
  ADMIN_EMAIL: z.string().optional(),
  /** How many events a (non-admin) host account may create. Admins are unlimited. */
  HOST_EVENT_LIMIT: z.coerce.number().int().min(1).default(1),

  S3_ENDPOINT: z.string().url().optional(),
  /** Public endpoint used only to sign upload/download URLs (defaults to S3_ENDPOINT).
   *  In Docker: S3_ENDPOINT=http://s3:9000 (internal), this=https://media.example.com. */
  S3_PRESIGN_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_PUBLIC_URL: z.string().url(),

  /** Header the reverse proxy sets to the real client IP (rate limiting). Behind Cloudflare: cf-connecting-ip. */
  CLIENT_IP_HEADER: z
    .string()
    .default("x-real-ip")
    .transform((s) => s.toLowerCase()),

  MAX_UPLOAD_BYTES:z.coerce.number().default(15 * 1024 * 1024),
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
