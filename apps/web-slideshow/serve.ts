// Dev server reachable from TVs/projectors on the LAN (the `bun ./index.html` CLI binds localhost only).
import { brandRoutes } from "@snapshare/brand/dev-routes";
import index from "./index.html";

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 5173),
  routes: { ...brandRoutes, "/": index },
  development: true,
});

console.log(`Slideshow on http://localhost:${server.port} (and your LAN IP)`);
