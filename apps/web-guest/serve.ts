// Dev server reachable from phones on the LAN. In production the backend serves the built app at /join/*.
import index from "./index.html";

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 5175),
  routes: { "/": index, "/join/*": index },
  development: true,
});

console.log(`Guest web app on http://localhost:${server.port}/join/<event-code> (and your LAN IP)`);
