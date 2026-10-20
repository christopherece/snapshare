# SnapShare

Guests scan a QR code, shoot with an in-app camera, and photos stream live to the host's gallery and a projector slideshow.

```
apps/
  backend/         Bun + Hono API, WebSockets, Drizzle/Postgres, S3 presigned uploads, worker-thread media pipeline
  mobile/          Expo (SDK 54) guest app — camera, offline upload queue, live feed
  web-slideshow/   Full-screen live slideshow for TVs/projectors (Bun HTML bundler, no framework)
  web-host/        Host dashboard (React): events, QR flyer, moderation, ZIP download
packages/
  shared/          DTO + WebSocket message types shared by all apps
```

## Quick start

Requires [Bun](https://bun.sh) ≥ 1.2 and Docker.

```bash
bun install
docker compose up -d                       # Postgres :5433, RustFS S3 :9000 (console :9001)
cp apps/backend/.env.example apps/backend/.env
bun run db:migrate                         # create tables (migrations in apps/backend/drizzle)

bun run dev:backend      # http://localhost:3000
bun run dev:host         # http://localhost:5174 — host dashboard
bun run dev:slideshow    # http://localhost:5173/?event=<id>&key=<displayKey>
bun run dev:mobile       # Expo dev server (SDK 57 — matches the store build of Expo Go)
```

Testing on a phone: set `EXPO_PUBLIC_API_URL` (apps/mobile/.env) and `S3_ENDPOINT` / `S3_PUBLIC_URL` / `SLIDESHOW_URL`
(apps/backend/.env) to your machine's LAN IP — `localhost` on a phone is the phone. Presigned upload URLs embed the
`S3_ENDPOINT` host, so it must be reachable from the phone too.

## Deploying

See **[DEPLOY.md](DEPLOY.md)**: one `docker compose -f docker-compose.prod.yml up -d --build` on a VPS behind nginx
(config in `deploy/nginx/`). The production image serves the API plus the built dashboard (`/host`) and slideshow
(`/slideshow`) from one origin.

## How a photo flows

```
 Guest app                         Backend (Bun)                       S3 / R2
 ─────────                         ─────────────                       ───────
 shutter → compress (≤2560px JPEG)
 → persist to documents + queue
 GET /api/events/:id/upload-url ─► reserve photos row (idempotent on clientId)
                                ◄─ presigned PUT URL
 PUT original ───────────────────────────────────────────────────────► originals/{event}/{photo}
 POST /api/photos/:id/complete ──► verify object + size → enqueue
                                   worker thread: sharp → WebP ──────► public/{event}/{photo}/thumb.webp
                                                                       public/{event}/{photo}/display.webp
                                   status=ready → WS publish
 feed / slideshow ◄──────────────── photo.added
```

- **Offline-first:** queue entries live in AsyncStorage and files in the app's document dir; the queue drains on reconnect /
  app foreground with exponential backoff. Upload calls are idempotent via a client-generated `clientId`.
- **Crash-safe processing:** `photos.status` is the source of truth; on boot the backend re-enqueues anything stuck in
  `uploaded`/`processing`. Abandoned `pending_upload` rows are purged after 24h.
- **Privacy:** client re-encode drops EXIF; server renditions are metadata-free; only whitelisted EXIF (no GPS) is stored.
- **Moderation:** `requireApproval` events create photos as `pending` (host-only WS topic) until approved.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | — | Host account → JWT |
| GET/POST | `/api/host/events` | Host | List / create events |
| PATCH | `/api/host/events/:id` | Host | Update name, dates, passcode, approval mode, close uploads |
| GET | `/api/host/events/:id/qr.svg` · `/flyer` | Host | QR code / printable A5 flyer |
| PATCH/DELETE | `/api/host/photos/:id` | Host | Approve / hide / favorite / delete |
| POST | `/api/host/guests/:id/block` | Host | Block a guest device |
| GET | `/api/host/events/:id/originals` | Host | Signed download links for all originals |
| POST | `/api/host/events/:id/download-link?filter=all\|favorites` | Host | 5-min signed link → streamed ZIP of originals |
| GET | `/api/downloads/:token` | signed link | Streams the ZIP (hidden photos excluded) |
| GET | `/api/e/:slug` | — | Public event preview (join screen) |
| POST | `/api/e/:slug/join` | — | Anonymous guest session (`X-Guest-Token`) |
| GET | `/api/events/:id/upload-url` | Guest | Presigned PUT (rate limited per device) |
| POST | `/api/photos/:id/complete` | Guest | Confirm upload → processing |
| GET | `/api/events/:id/photos` | Guest / Host / `?key=` | Keyset-paginated feed |
| GET | `/api/events/:id/display` | `?key=` | Slideshow bootstrap (event + QR) |
| PUT/DELETE | `/api/photos/:id/like` | Guest | Like / unlike |
| GET/POST | `/api/photos/:id/comments` | Guest | Comments |
| WS | `/ws?eventId=&token=\|key=\|auth=` | any | `photo.added/updated/removed/liked`, `comment.added` |

## Scaling notes

Single-instance by design for now. When you need more than one backend replica:
- Rate limiter → Redis token bucket (`lib/rate-limit.ts`)
- WebSocket fan-out → Redis pub/sub or Postgres `LISTEN/NOTIFY` bridge (`realtime/hub.ts`)
- Media queue → BullMQ (`media/queue.ts` — same `enqueue()` interface)

## Not built yet

- Guest PWA fallback (the feed + upload endpoints are already browser-friendly with CORS)
- Event cover images, guest blocking UI (API exists: `POST /api/host/guests/:id/block`)
