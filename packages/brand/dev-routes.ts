/**
 * Dev-server route that serves the brand's static files (fonts, favicons, social image) at /brand/*,
 * matching what the backend serves in production. Spread into each app's Bun.serve routes:
 *
 *   routes: { ...brandRoutes, "/": index }
 */
import { resolve, sep } from "node:path";

const publicDir = resolve(import.meta.dir, "public");

export const brandRoutes = {
  "/brand/*": (req: Request) => {
    const rel = decodeURIComponent(new URL(req.url).pathname.slice("/brand/".length));
    const file = resolve(publicDir, rel);
    if (!file.startsWith(publicDir + sep)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(file), { headers: { "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" } });
  },
};
