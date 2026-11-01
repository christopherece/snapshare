import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { db } from "./db/client.ts";
import { env } from "./env.ts";
import { hideUnapprovedRenditions, mediaQueue, scheduleAbandonedUploadCleanup } from "./media/queue.ts";
import { type WsData, attachServer, handleUpgrade, websocketHandlers } from "./realtime/hub.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes, ensureAdmin } from "./routes/auth.ts";
import { downloadRoutes } from "./routes/downloads.ts";
import { guestRoutes } from "./routes/guest.ts";
import { hostRoutes } from "./routes/host.ts";
import { joinPage } from "./routes/join-page.ts";
import { legalRoutes } from "./routes/legal.ts";
import { guestManifest } from "./lib/guest-manifest.ts";

const app = new Hono()
  .use(logger())
  .use(secureHeaders({ crossOriginResourcePolicy: false }))
  .use("/api/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Guest-Token"] }))
  .get("/health", (c) => c.json({ ok: true }))
  // Public settings for the guest app: native app store links (absent until the app is published).
  .get("/api/config", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json({ appStoreUrl: env.APP_STORE_URL ?? null, playStoreUrl: env.PLAY_STORE_URL ?? null });
  })
  .route("/open", joinPage)
  .route("/", legalRoutes)
  .route("/api/auth", authRoutes)
  .route("/api/host", hostRoutes)
  .route("/api/admin", adminRoutes)
  .route("/api/downloads", downloadRoutes)
  .route("/api", guestRoutes);

// Production: serve the marketing page (/), guest app (/join/<code> — what QR codes point at),
// host dashboard (/host) and slideshow (/slideshow) from this same origin.
if (env.STATIC_DIR) {
  const dir = env.STATIC_DIR;
  // Bundled JS/CSS have content-hashed names, so browsers may keep them forever; the HTML shell
  // must always be revalidated so a new deploy is picked up immediately.
  // The guest app's service worker and manifest keep fixed names, so they must be revalidated too.
  const cacheHeaders = (path: string, c: { header: (k: string, v: string) => void }) =>
    c.header(
      "Cache-Control",
      /(\.html|\/sw\.js|\.webmanifest)$/.test(path) ? "no-cache" : "public, max-age=31536000, immutable",
    );

  // Landing page: link previews (og:image) need absolute URLs, so the public origin is filled in here.
  let landingHtml: string | null = null;
  app.get("/", async (c) => {
    landingHtml ??= (await Bun.file(`${dir}/landing/index.html`).text()).replaceAll(
      "%PUBLIC_URL%",
      env.PUBLIC_APP_URL.replace(/\/$/, ""),
    );
    c.header("Cache-Control", "no-cache");
    return c.html(landingHtml);
  });

  // Brand files (fonts, favicons, social image) have fixed names, so they're cached for a month, not forever.
  const brandCache = (path: string, c: { header: (k: string, v: string) => void }) =>
    c.header("Cache-Control", path.endsWith(".css") ? "public, max-age=86400" : "public, max-age=2592000");
  app.use("/brand/*", serveStatic({ root: dir, onFound: brandCache }));
  // Browsers and iOS request these from the site root by default.
  for (const file of ["favicon.ico", "apple-touch-icon.png"]) {
    app.get(`/${file}`, serveStatic({ root: dir, rewriteRequestPath: () => `/brand/${file}`, onFound: brandCache }));
  }
  // Only the marketing page belongs in search results; events, dashboards and displays are private.
  app.get("/robots.txt", (c) =>
    c.text(
      ["User-agent: *", "Allow: /$", "Allow: /terms", "Allow: /privacy", "Disallow: /join/", "Disallow: /host/", "Disallow: /slideshow/", "Disallow: /open/", "Disallow: /api/", ""].join(
        "\n",
      ),
    ),
  );
  // Per-event manifest, so an installed guest app opens straight into its event.
  app.get("/join/manifest.webmanifest", (c) => guestManifest(`${dir}/join/manifest.webmanifest`, c.req.query("slug")));
  app.use("/landing/*", serveStatic({ root: dir, onFound: cacheHeaders }));

  for (const name of ["join", "host", "slideshow"]) {
    app.get(`/${name}`, (c) => c.redirect(`/${name}/${new URL(c.req.url).search}`));
    app.use(`/${name}/*`, serveStatic({ root: dir, onFound: cacheHeaders }));
    // Unknown paths fall back to the app shell (the dashboard uses hash routing).
    app.get(
      `/${name}/*`,
      serveStatic({ root: dir, rewriteRequestPath: () => `/${name}/index.html`, onFound: cacheHeaders }),
    );
  }
}

// Dev: serve the brand files straight from the package (production copies them into STATIC_DIR/brand),
// so the legal pages and 404 page look the same locally.
if (!env.STATIC_DIR) {
  app.get("/brand/*", serveStatic({ root: `${import.meta.dir}/../../../packages/brand/public`, rewriteRequestPath: (p) => p.replace(/^\/brand/, "") }));
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.res ?? c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

// API clients get JSON; people who mistype a URL get a friendly page.
app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || !c.req.header("accept")?.includes("text/html")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.html(notFoundPage, 404);
});

const notFoundPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · SnapShare</title><meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<style>@import url("/brand/fonts.css");
:root{--bg:#f7f5f1;--text:#1b1a18;--muted:#6f6962;--gold:#9a7647}
@media (prefers-color-scheme:dark){:root{--bg:#121110;--text:#f1ede7;--muted:#a39c93;--gold:#c8a97e}}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;text-align:center;
background:radial-gradient(900px 420px at 50% -10%,rgb(200 169 126/.22),transparent 70%),var(--bg);color:var(--text);
font:16px/1.55 "Inter Variable",system-ui,sans-serif}
main{max-width:420px}img{width:56px;height:56px;border-radius:22%;box-shadow:0 8px 24px -10px rgb(0 0 0/.4)}
p.k{margin:28px 0 8px;font-size:12px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
h1{margin:0;font:400 46px/1.05 "Instrument Serif",Georgia,serif}p{color:var(--muted);margin:14px 0 28px}
a.b{display:inline-flex;padding:13px 24px;border-radius:999px;background:var(--text);color:var(--bg);text-decoration:none;font-weight:600}</style></head>
<body><main><img src="/brand/favicon.svg" alt=""><p class="k">404</p><h1>This page wandered off</h1>
<p>If you scanned a QR code, check the event code under it — or ask your host for the link.</p>
<a class="b" href="/">Go to SnapShare</a></main></body></html>`;

if (env.RUN_MIGRATIONS) {
  await migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });
  console.log("Database migrations applied");
}
await ensureAdmin();

const server = Bun.serve<WsData>({
  port: env.PORT,
  async fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws") return handleUpgrade(req, srv);
    return app.fetch(req, { server: srv });
  },
  websocket: websocketHandlers,
});

attachServer(server);
mediaQueue.start();
await mediaQueue.recover();
scheduleAbandonedUploadCleanup();
void hideUnapprovedRenditions().catch((err) => console.error("[media] hideUnapprovedRenditions", err));

console.log(`SnapShare API listening on ${server.url}`);

export type AppType = typeof app;
