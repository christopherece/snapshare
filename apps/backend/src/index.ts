import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env.ts";
import { mediaQueue, scheduleAbandonedUploadCleanup } from "./media/queue.ts";
import { type WsData, attachServer, handleUpgrade, websocketHandlers } from "./realtime/hub.ts";
import { authRoutes } from "./routes/auth.ts";
import { downloadRoutes } from "./routes/downloads.ts";
import { guestRoutes } from "./routes/guest.ts";
import { hostRoutes } from "./routes/host.ts";
import { joinPage } from "./routes/join-page.ts";

const app = new Hono()
  .use(logger())
  .use(secureHeaders({ crossOriginResourcePolicy: false }))
  .use("/api/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type", "X-Guest-Token"] }))
  .get("/health", (c) => c.json({ ok: true }))
  .route("/join", joinPage)
  .route("/api/auth", authRoutes)
  .route("/api/host", hostRoutes)
  .route("/api/downloads", downloadRoutes)
  .route("/api", guestRoutes);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.res ?? c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

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
