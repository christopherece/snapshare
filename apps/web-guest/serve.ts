// Dev server reachable from phones on the LAN. In production the backend serves the built app at /join/*.
import index from "./index.html";
import { guestManifest } from "../backend/src/lib/guest-manifest.ts";

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 5175),
  routes: {
    "/": index,
    // public/ is served as-is (production copies it into the built /join/ folder).
    "/join/manifest.webmanifest": (req) =>
      guestManifest(`${import.meta.dir}/public/manifest.webmanifest`, new URL(req.url).searchParams.get("slug")),
    "/join/sw.js": () => new Response(Bun.file(`${import.meta.dir}/public/sw.js`), { headers: { "Content-Type": "text/javascript" } }),
    "/join/icons/:name": (req) => new Response(Bun.file(`${import.meta.dir}/public/icons/${req.params.name}`)),
    "/join/*": index,
  },
  development: true,
});

console.log(`Guest web app on http://localhost:${server.port}/join/<event-code> (and your LAN IP)`);
