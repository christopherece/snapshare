import { Hono } from "hono";
import { env } from "../env.ts";

/**
 * Plain-language Guest & Host terms (/terms) and Privacy notice (/privacy).
 *
 * These describe what the app actually does — keep them in step with the code. They're a starting
 * point, not legal advice: have them reviewed before relying on them commercially.
 */

const UPDATED = "1 November 2026";
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const operator = () => esc(env.OPERATOR_NAME);
const contact = () =>
  env.CONTACT_EMAIL
    ? `email <a href="mailto:${esc(env.CONTACT_EMAIL)}">${esc(env.CONTACT_EMAIL)}</a>`
    : "contact the host of your event, who can pass your request on to us";

function page(title: string, intro: string, body: string) {
  return `<!doctype html>
<html lang="en-NZ"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · SnapShare</title>
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<style>@import url("/brand/fonts.css");
:root{--bg:#f7f5f1;--surface:#fff;--text:#1b1a18;--muted:#6f6962;--border:#e4dfd7;--gold:#9a7647}
@media (prefers-color-scheme:dark){:root{--bg:#121110;--surface:#1b1a18;--text:#f1ede7;--muted:#a39c93;--border:#2f2c28;--gold:#c8a97e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 "Inter Variable",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto;padding:40px 22px 72px}
.top{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;font:400 24px/1 "Instrument Serif",Georgia,serif;margin-bottom:36px}
.top img{width:30px;height:30px;border-radius:22%}
.k{font-size:12px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin:0 0 10px}
h1{font:400 clamp(40px,8vw,56px)/1.05 "Instrument Serif",Georgia,serif;margin:0 0 14px;letter-spacing:-.01em}
h2{font:400 28px/1.2 "Instrument Serif",Georgia,serif;margin:40px 0 10px}
.lead{font-size:18px;color:var(--muted);margin:0 0 8px}.meta{font-size:13px;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:18px 22px;margin:26px 0}
ul{padding-left:20px}li{margin:6px 0}a{color:inherit;text-underline-offset:3px}
nav{display:flex;gap:18px;margin-top:48px;padding-top:20px;border-top:1px solid var(--border);font-size:14px;color:var(--muted)}</style></head>
<body><main>
<a class="top" href="/"><img src="/brand/favicon.svg" alt="">SnapShare</a>
<p class="k">SnapShare</p><h1>${title}</h1><p class="lead">${intro}</p><p class="meta">Last updated ${UPDATED}</p>
${body}
<nav><a href="/terms">Guest &amp; host terms</a><a href="/privacy">Privacy notice</a><a href="/">Home</a></nav>
</main></body></html>`;
}

const termsPage = () =>
  page(
    "Guest &amp; host terms",
    "The short version: share photos you'd be happy for everyone at the event to see, and be kind.",
    `
<div class="card"><strong>In a nutshell</strong>
<ul>
  <li>Photos you take are shared with the <strong>host</strong> and <strong>other guests</strong>, and may appear <strong>live on the big screen</strong> at the event.</li>
  <li>Only take photos people are happy to share. Nothing offensive, and respect anyone who'd rather not be photographed.</li>
  <li>The host can approve, hide or delete any photo, and you can report a photo you're not comfortable with.</li>
</ul></div>

<h2>What SnapShare is</h2>
<p>SnapShare is a shared photo album for events, run by ${operator()}. Guests join by scanning the event's QR code — no account is needed. Photos taken in SnapShare are added to the event's album and can be shown on a live slideshow at the venue.</p>

<h2>Sharing photos</h2>
<ul>
  <li>Only upload photos you took, or have the right to share.</li>
  <li>Don't upload anything illegal, sexually explicit, violent, hateful, harassing or intended to embarrass someone.</li>
  <li>Respect people who ask not to be photographed, and take extra care with photos of children — check with their parent or caregiver.</li>
  <li>Your display name is shown next to your photos. You can leave it blank.</li>
</ul>

<h2>Who sees your photos</h2>
<p>The host(s) of the event, the other guests who joined it, and anyone who can see the slideshow screen at the venue. Hosts can download the photos at full quality to keep after the event.</p>

<h2>Your photos stay yours</h2>
<p>You keep the rights to your photos. By sharing one, you let the host and the event's guests view it in the album and on the slideshow, let the host download and keep it for their personal use, and let ${operator()} store and display it only to run the service.</p>

<h2>Moderation and reporting</h2>
<ul>
  <li>The host can turn on <em>approve before public</em>, so photos only appear once they've checked them, and can hide or delete any photo at any time.</li>
  <li>Guests can <strong>report</strong> a photo from the gallery. The host is told straight away, and a photo reported by several guests is hidden until the host reviews it.</li>
  <li>We can remove photos, block a device from an event, or suspend an event that breaks these terms.</li>
</ul>

<h2>For hosts</h2>
<ul>
  <li>You're responsible for your event: telling guests how photos will be shared (for example on the QR flyer), keeping an eye on what appears on screen, and acting on reports.</li>
  <li>Use the photos for your own personal or event purposes, and respect guests' requests to remove photos of them.</li>
  <li>You can delete photos, close uploads, or ask us to delete the whole event at any time.</li>
</ul>

<h2>Responsibility</h2>
<p>Photos are taken and shared by guests, and moderated by the host. ${operator()} doesn't review photos before they appear, and isn't responsible for photos guests upload — but we will act promptly on reports and removal requests. Nothing in these terms limits any rights you have under the Consumer Guarantees Act 1993 or the Fair Trading Act 1986.</p>

<h2>Removing a photo</h2>
<p>Ask the host, use the <strong>Report</strong> button on the photo, or ${contact()}.</p>

<h2>Changes</h2>
<p>We may update these terms; the date above shows the latest version. These terms are governed by New Zealand law.</p>`,
  );

const privacyPage = () =>
  page(
    "Privacy notice",
    "What SnapShare collects, who can see it, and how to have it removed.",
    `
<h2>Who we are</h2>
<p>SnapShare is run by ${operator()}. For any privacy question or request, ${contact()}.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>Photos you share.</strong> They're resized on your phone before upload, and <strong>location (GPS) and camera details are removed</strong> first.</li>
  <li><strong>Your display name</strong>, if you enter one.</li>
  <li><strong>A random device ID and session key</strong>, kept in your browser so you stay joined to the event and photos taken offline can upload later.</li>
  <li><strong>Likes, comments and reports</strong> you make in the gallery.</li>
  <li><strong>Technical information</strong> such as your IP address and browser, used for security and to prevent abuse (for example, limiting how fast photos can be uploaded).</li>
  <li><strong>Hosts:</strong> name, email address and a securely hashed password.</li>
</ul>

<h2>How we use it</h2>
<p>Only to run the event album and slideshow, keep the service secure, and handle reports and requests. We don't sell your information, show you ads, or use advertising or analytics trackers.</p>

<h2>Who can see it</h2>
<p>Your photos, display name, likes and comments are visible to the event's host(s) and its other guests, and photos may appear on the slideshow at the venue. Reports are only visible to the host. We use service providers to run SnapShare — such as our hosting and Cloudflare, which carries the site's traffic — and they handle data only to provide that service.</p>

<h2>How long we keep it</h2>
<p>Photos and event data are kept until the host deletes them or the event, or until you ask us to remove photos of you. Hosts can delete any photo at any time.</p>

<h2>Your rights</h2>
<p>Under the New Zealand Privacy Act 2020 you can ask to see or correct the information we hold about you, and ask for photos of you to be removed. If you're not happy with how we've handled a privacy matter, you can contact the <a href="https://www.privacy.org.nz">Office of the Privacy Commissioner</a>.</p>

<h2>Storage on your device</h2>
<p>SnapShare stores your session and any photos waiting to upload in your browser's storage. It doesn't use tracking cookies.</p>`,
  );

export const legalRoutes = new Hono()
  .get("/terms", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(termsPage());
  })
  .get("/privacy", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(privacyPage());
  });
