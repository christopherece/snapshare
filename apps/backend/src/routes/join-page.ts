import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";

/**
 * GET /join/:slug — what the QR code points at.
 *
 * A plain https/http URL is the only thing every phone camera can open. This page
 * then hands off to the app via APP_LINK_TEMPLATE:
 *   dev (Expo Go):  exp://<LAN-IP>:8081/--/join/{slug}
 *   production:     snapshare://join/{slug}  (or a universal link)
 * and always shows the event code as a manual fallback.
 */
export const joinPage = new Hono().get("/:slug", async (c) => {
  const slug = c.req.param("slug").toLowerCase();
  const event = await db.query.events.findFirst({ where: eq(schema.events.slug, slug) });
  if (!event) return c.html(page("Event not found", `<p class="muted">Check the code on the card and try again.</p>`), 404);

  const appLink = env.APP_LINK_TEMPLATE.replace("{slug}", encodeURIComponent(slug));
  const when = event.startsAt?.toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" });

  return c.html(
    page(
      event.name,
      `
      <p class="kicker">You're invited to share photos</p>
      <h1>${esc(event.name)}</h1>
      ${when || event.location ? `<p class="muted">${esc([when, event.location].filter(Boolean).join(" · "))}</p>` : ""}
      <a class="btn" id="open" href="${esc(appLink)}">Open SnapShare</a>
      <p class="muted small">Or open the app and enter this code:</p>
      <p class="code">${esc(slug.toUpperCase())}</p>
      <script>
        // Try to hand off to the app straight away; the button remains as a fallback.
        setTimeout(function () { location.href = ${JSON.stringify(appLink)}; }, 300);
      </script>`,
    ),
  );
});

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · SnapShare</title>
<style>
  :root { --bg:#f7f5f1; --text:#1b1a18; --muted:#77716a; --accent:#b08d5b; --btn:#1b1a18; --btn-text:#faf8f5; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121110; --text:#f1ede7; --muted:#9d968d; --accent:#c8a97e; --btn:#f1ede7; --btn-text:#1b1a18; } }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
         font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; text-align:center; padding:24px; box-sizing:border-box; }
  main { max-width:360px; width:100%; }
  .kicker { font-size:11px; font-weight:600; letter-spacing:.25em; text-transform:uppercase; color:var(--accent); margin:0 0 8px; }
  h1 { font:400 32px/1.2 Georgia,serif; margin:0 0 8px; }
  .muted { color:var(--muted); margin:4px 0; } .small { font-size:14px; margin-top:28px; }
  .btn { display:block; margin:32px 0 0; padding:16px; border-radius:999px; background:var(--btn); color:var(--btn-text);
         text-decoration:none; font-weight:600; font-size:17px; }
  .code { font:600 28px ui-monospace,monospace; letter-spacing:.25em; margin:8px 0 0; }
</style></head>
<body><main>${body}</main></body></html>`;
}
