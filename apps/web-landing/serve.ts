// Dev server for the marketing page. In production the backend serves the built page at /.
import index from "./index.html";

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 5176),
  routes: { "/": index },
  development: true,
});

console.log(`Landing page on http://localhost:${server.port} (and your LAN IP)`);
