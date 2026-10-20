import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { db } from "./db/client.ts";
import { env } from "./env.ts";
import { mediaQueue, scheduleAbandonedUploadCleanup } from "./media/queue.ts";
import { type WsData, attachServer, handleUpgrade, websocketHandlers } from "./realtime/hub.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes, ensureAdmin } from "./routes/auth.ts";
import { downloadRoutes } from "./routes/downloads.ts";
import { guestRoutes } from "./routes/guest.ts";
import { hostRoutes } from "./routes/host.ts";
import { joinPage } from "./routes/join-page.ts";

const app = new Hono()
  .use(logger())
  .use(secureHeaders({ crossOriginResourcePolicy: false }))
  .use("/api/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Guest-Token"] }))
  .get("/health", (c) => c.json({ ok: true }))
  .route("/open", joinPage)
  .route("/api/auth", authRoutes)
  .route("/api/host", hostRoutes)
  .route("/api/admin", adminRoutes)
  .route("/api/downloads", downloadRoutes)
  .route("/api", guestRoutes);

// Production: serve the built guest app (/join/<code> — what QR codes point at), host dashboard
// (/host) and slideshow (/slideshow) from this same origin.
if (env.STATIC_DIR) {
  const dir = env.STATIC_DIR;
  app.get("/", (c) => c.redirect("/host/"));
  for (const name of ["join", "host", "slideshow"]) {
    app.get(`/${name}`, (c) => c.redirect(`/${name}/${new URL(c.req.url).search}`));
    app.use(`/${name}/*`, serveStatic({ root: dir }));
    // Unknown paths fall back to the app shell (the dashboard uses hash routing).
    app.get(`/${name}/*`, serveStatic({ root: dir, rewriteRequestPath: () => `/${name}/index.html` }));
  }
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.res ?? c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

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

console.log(`SnapShare API listening on ${server.url}`);

export type AppType = typeof app;
