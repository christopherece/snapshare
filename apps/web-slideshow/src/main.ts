import type { EventPublicDTO, PageResponse, PhotoDTO, WsServerMessage } from "@snapshare/shared";

/**
 * Live slideshow for TVs/projectors.
 * URL: /?event=<eventId>&key=<displayKey>[&api=https://api.example.com][&interval=7]
 *
 * New photos jump the queue so guests see their shot within seconds;
 * otherwise the show cycles through the whole event, newest first.
 */

const params = new URLSearchParams(location.search);
const EVENT_ID = params.get("event") ?? "";
const KEY = params.get("key") ?? "";
const API = (params.get("api") ?? (location.port === "5173" ? "http://localhost:3000" : location.origin)).replace(/\/$/, "");
const INTERVAL_MS = Math.max(3, Number(params.get("interval") ?? 7)) * 1000;

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const layers = [$<HTMLDivElement>('[data-layer="a"]'), $<HTMLDivElement>('[data-layer="b"]')];
const emptyEl = $<HTMLElement>("#empty");
const creditEl = $<HTMLElement>("#credit");
const toastEl = $<HTMLElement>("#toast");
const statusEl = $<HTMLElement>("#status");

// ─── Playlist state ───────────────────────────────────────────────────────────

const pool: PhotoDTO[] = []; // every approved photo, newest first
const fresh: PhotoDTO[] = []; // arrived live, not yet shown
let cursor = 0;
let front = 0; // which layer is visible
let current: PhotoDTO | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function upsert(photo: PhotoDTO) {
  const i = pool.findIndex((p) => p.id === photo.id);
  if (i === -1) pool.unshift(photo);
  else pool[i] = photo;
}

function remove(photoId: string) {
  for (const list of [pool, fresh]) {
    const i = list.findIndex((p) => p.id === photoId);
    if (i !== -1) list.splice(i, 1);
  }
  if (current?.id === photoId) void advance();
}

function nextPhoto(): PhotoDTO | null {
  if (fresh.length) return fresh.shift()!;
  if (!pool.length) return null;
  cursor = cursor % pool.length;
  return pool[cursor++]!;
}

async function preload(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
}

async function advance() {
  if (timer) clearTimeout(timer);
  const photo = nextPhoto();
  emptyEl.hidden = photo !== null;

  if (photo) {
    try {
      await preload(photo.displayUrl);
      show(photo);
    } catch {
      // Image failed to load (e.g. deleted mid-show) — skip it.
    }
  } else {
    current = null;
    layers.forEach((l) => l.classList.remove("visible"));
  }
  timer = setTimeout(advance, photo ? INTERVAL_MS : 3000);
}

function show(photo: PhotoDTO) {
  const back = layers[1 - front]!;
  back.querySelector<HTMLImageElement>("img")!.src = photo.displayUrl;
  back.querySelector<HTMLDivElement>(".backdrop")!.style.backgroundImage = `url("${photo.thumbUrl}")`;
  back.classList.add("visible");
  layers[front]!.classList.remove("visible");
  front = 1 - front;
  current = photo;
  creditEl.textContent = photo.guestName ? `📸 ${photo.guestName}` : "";
}

function toast(text: string) {
  toastEl.hidden = true;
  void toastEl.offsetWidth; // restart CSS animation
  toastEl.textContent = text;
  toastEl.hidden = false;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function api<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API}/api${path}${sep}key=${encodeURIComponent(KEY)}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function loadInitial() {
  const display = await api<{ event: EventPublicDTO; qrSvg: string }>(`/events/${EVENT_ID}/display`);
  document.title = `${display.event.name} · Live`;
  document.querySelectorAll(".event-name").forEach((el) => (el.textContent = display.event.name));
  document.querySelectorAll(".qr").forEach((el) => (el.innerHTML = display.qrSvg));

  // Load up to ~500 recent photos for the rotation.
  let next: string | null = null;
  for (let page = 0; page < 5; page++) {
    const res: PageResponse<PhotoDTO> = await api(
      `/events/${EVENT_ID}/photos?limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
    );
    res.items.forEach((p) => pool.push(p));
    next = res.nextCursor;
    if (!next) break;
  }
}

// ─── Realtime ─────────────────────────────────────────────────────────────────

function connect(retry = 0) {
  const ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws?eventId=${EVENT_ID}&key=${encodeURIComponent(KEY)}`);

  ws.onopen = () => {
    statusEl.hidden = true;
    retry = 0;
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data) as WsServerMessage;
    switch (msg.type) {
      case "photo.added": {
        const isNew = !pool.some((p) => p.id === msg.photo.id);
        upsert(msg.photo);
        if (isNew) {
          fresh.push(msg.photo);
          if (msg.photo.guestName) toast(`New photo from ${msg.photo.guestName}`);
          if (!current) void advance(); // wake up from the empty state immediately
        }
        break;
      }
      case "photo.updated":
        upsert(msg.photo);
        break;
      case "photo.removed":
        remove(msg.photoId);
        break;
    }
  };

  ws.onclose = () => {
    statusEl.hidden = false;
    setTimeout(() => connect(retry + 1), Math.min(1000 * 2 ** retry, 30_000));
  };
}

// ─── Kiosk niceties ───────────────────────────────────────────────────────────

let idleTimer: ReturnType<typeof setTimeout>;
const wake = () => {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add("idle"), 2500);
};
addEventListener("mousemove", wake);
wake();

addEventListener("keydown", (e) => {
  if (e.key === "f") void document.documentElement.requestFullscreen?.();
  if (e.key === "ArrowRight" || e.key === " ") void advance();
});
addEventListener("dblclick", () => void document.documentElement.requestFullscreen?.());

// Keep the TV from sleeping where supported.
void (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } }).wakeLock
  ?.request("screen")
  .catch(() => {});

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (!EVENT_ID || !KEY) {
  emptyEl.hidden = false;
  $(".empty h1").textContent = "Missing ?event= and ?key= in the URL";
} else {
  loadInitial()
    .catch((err) => {
      console.error(err);
      statusEl.hidden = false;
      statusEl.textContent = "Couldn't load event — check the slideshow link.";
    })
    .finally(() => {
      void advance();
      connect();
    });
}
