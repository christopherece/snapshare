// Dev server reachable from other devices on the LAN (the `bun ./index.html` CLI binds localhost only).
import index from "./index.html";

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 5174),
  routes: { "/": index },
  development: true,
});

console.log(`Host dashboard on http://localhost:${server.port} (and your LAN IP)`);
