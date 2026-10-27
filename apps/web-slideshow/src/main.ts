import type { EventPublicDTO, PageResponse, PhotoDTO, WsServerMessage } from "@snapshare/shared";

/**
 * Live slideshow for TVs/projectors.
 * URL: /?event=<eventId>&key=<displayKey>[&style=fade|slide|zoom|flip|kenburns|polaroid|mosaic]
 *      [&interval=7][&api=https://api.example.com]
 *
 * New photos jump the queue so guests see their shot within seconds;
 * otherwise the show cycles through the whole event, newest first.
 * Style and speed can also be changed live (move the mouse, or press S) and are remembered per screen.
 */

const STYLES = {
  fade: "Fade",
  slide: "Slide",
  zoom: "Zoom",
  flip: "Flip",
  kenburns: "Ken Burns",
  polaroid: "Polaroids",
  mosaic: "Mosaic",
} as const;
type Style = keyof typeof STYLES;
const isStyle = (s: string | null): s is Style => !!s && s in STYLES;
const SPEEDS = [5, 7, 10, 15];

const params = new URLSearchParams(location.search);
const EVENT_ID = params.get("event") ?? "";
const KEY = params.get("key") ?? "";
const API = (params.get("api") ?? (location.port === "5173" ? "http://localhost:3000" : location.origin)).replace(/\/$/, "");

const PREFS_KEY = `snapshare.slideshow.${EVENT_ID}`;
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { style?: string; interval?: number };
  } catch {
    return {};
  }
})();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let style: Style = isStyle(params.get("style")) ? (params.get("style") as Style) : isStyle(saved.style ?? null) ? (saved.style as Style) : "fade";
let intervalMs = Math.max(3, Number(params.get("interval") ?? saved.interval ?? 7)) * 1000;

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const stage = $<HTMLElement>("#stage");
const layers = [$<HTMLDivElement>('[data-layer="a"]'), $<HTMLDivElement>('[data-layer="b"]')];
const pileEl = $<HTMLDivElement>("#pile");
const mosaicEl = $<HTMLDivElement>("#mosaic");
const emptyEl = $<HTMLElement>("#empty");
const creditEl = $<HTMLElement>("#credit");
const toastEl = $<HTMLElement>("#toast");
const statusEl = $<HTMLElement>("#status");

// ─── Playlist state ───────────────────────────────────────────────────────────

const pool: PhotoDTO[] = []; // every approved photo, newest first
const fresh: PhotoDTO[] = []; // arrived live, not yet shown
const liveIds = new Set<string>(); // arrived live — highlighted the first time they're shown
let cursor = 0;
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
  // Hidden/deleted photos leave the screen straight away.
  pileEl.querySelectorAll(`[data-id="${photoId}"]`).forEach((el) => el.remove());
  const tile = mosaicEl.querySelector<HTMLElement>(`[data-id="${photoId}"]`);
  if (tile) void fillTile(tile);
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

/** Mosaic swaps one tile at a time, so it moves faster than a full-screen photo. */
const stepMs = () => (style === "mosaic" ? Math.max(2500, intervalMs / 2) : intervalMs);

async function advance() {
  if (timer) clearTimeout(timer);
  const photo = nextPhoto();
  emptyEl.hidden = photo !== null;

  if (photo) {
    try {
      await preload(photo.displayUrl);
      render(photo);
    } catch {
      // Image failed to load (e.g. deleted mid-show) — skip it.
    }
  } else {
    current = null;
    clearStage();
  }
  timer = setTimeout(advance, photo ? stepMs() : 3000);
}

function render(photo: PhotoDTO) {
  current = photo;
  creditEl.textContent = photo.guestName ? `📸 ${photo.guestName}` : "";
  if (style === "polaroid") dropPolaroid(photo);
  else if (style === "mosaic") void placeInMosaic(photo);
  else swapLayers(photo);
  if (style !== "mosaic") liveIds.delete(photo.id);
}

function clearStage() {
  layers.forEach((l) => l.classList.remove("visible", "leaving"));
  pileEl.querySelectorAll(".polaroid").forEach((el) => el.remove());
  mosaicEl.replaceChildren();
}

// ─── Full-screen styles: two layers trade places ──────────────────────────────

let front = 0;

function swapLayers(photo: PhotoDTO) {
  const incoming = layers[1 - front]!;
  const outgoing = layers[front]!;
  incoming.querySelector<HTMLImageElement>("img")!.src = photo.displayUrl;
  incoming.querySelector<HTMLDivElement>(".backdrop")!.style.backgroundImage = `url("${photo.thumbUrl}")`;
  // Ken Burns: drift towards a different corner each time.
  incoming.style.setProperty("--kb-x", `${(Math.random() * 6 - 3).toFixed(2)}%`);
  incoming.style.setProperty("--kb-y", `${(Math.random() * 6 - 3).toFixed(2)}%`);

  // Snap the incoming layer to its start position (no animation), then animate it in.
  incoming.classList.remove("visible", "leaving");
  incoming.classList.add("pre");
  void incoming.offsetWidth;
  incoming.classList.remove("pre");
  incoming.classList.add("visible");
  outgoing.classList.remove("visible");
  outgoing.classList.add("leaving");
  front = 1 - front;
}

// ─── Polaroids: prints land on a pile ─────────────────────────────────────────

const PILE_MAX = 7;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function dropPolaroid(photo: PhotoDTO) {
  pileEl.querySelector<HTMLDivElement>(".backdrop")!.style.backgroundImage = `url("${photo.thumbUrl}")`;

  const card = document.createElement("figure");
  card.className = "polaroid";
  card.dataset.id = photo.id;
  card.style.setProperty("--r", `${rand(-9, 9).toFixed(1)}deg`);
  card.style.setProperty("--x", `${rand(-14, 14).toFixed(1)}vw`);
  card.style.setProperty("--y", `${rand(-7, 5).toFixed(1)}vh`);
  const img = document.createElement("img");
  img.src = photo.displayUrl;
  img.alt = "";
  const caption = document.createElement("figcaption");
  caption.textContent = photo.guestName ?? "";
  card.append(img, caption);
  pileEl.append(card);

  // Older prints sink and fade; the oldest leave the table.
  const cards = [...pileEl.querySelectorAll<HTMLElement>(".polaroid")];
  cards.forEach((c, i) => c.style.setProperty("--depth", String(cards.length - 1 - i)));
  for (const old of cards.slice(0, Math.max(0, cards.length - PILE_MAX))) {
    old.classList.add("gone");
    setTimeout(() => old.remove(), 1200);
  }
}

// ─── Mosaic: a wall of tiles, one flipping at a time ──────────────────────────

const TILE_COUNT = 6;
let tileTurn = 0;

function showOnTile(tile: HTMLElement, photo: PhotoDTO, isNew: boolean) {
  tile.dataset.id = photo.id;
  tile.classList.add("turning");
  setTimeout(() => {
    tile.querySelector("img")!.src = photo.displayUrl;
    tile.querySelector("figcaption")!.textContent = photo.guestName ?? "";
    tile.classList.remove("turning");
    tile.classList.toggle("new", isNew);
  }, 450);
}

async function fillTile(tile: HTMLElement) {
  const photo = pool.find((p) => !mosaicEl.querySelector(`[data-id="${p.id}"]`));
  if (!photo) return;
  await preload(photo.displayUrl).catch(() => {});
  showOnTile(tile, photo, false);
}

async function placeInMosaic(photo: PhotoDTO) {
  if (!mosaicEl.children.length) await buildMosaic(photo);
  const tiles = [...mosaicEl.children] as HTMLElement[];
  if (tiles.some((t) => t.dataset.id === photo.id)) return;
  // Round-robin so every tile gets refreshed, rather than one corner flickering.
  const tile = tiles[tileTurn++ % tiles.length]!;
  mosaicEl.querySelectorAll(".new").forEach((t) => t.classList.remove("new"));
  showOnTile(tile, photo, liveIds.delete(photo.id));
}

async function buildMosaic(first: PhotoDTO) {
  const picks = [first, ...pool.filter((p) => p.id !== first.id).slice(0, TILE_COUNT - 1)];
  await Promise.all(picks.map((p) => preload(p.displayUrl).catch(() => {})));
  mosaicEl.replaceChildren(
    ...Array.from({ length: TILE_COUNT }, (_, i) => {
      const tile = document.createElement("figure");
      tile.className = "tile";
      tile.style.setProperty("--i", String(i));
      const img = document.createElement("img");
      img.alt = "";
      const caption = document.createElement("figcaption");
      const p = picks[i % picks.length]!;
      tile.dataset.id = i < picks.length ? p.id : "";
      img.src = p.displayUrl;
      caption.textContent = p.guestName ?? "";
      tile.append(img, caption);
      return tile;
    }),
  );
  tileTurn = 1;
}

// ─── Style + speed controls ──────────────────────────────────────────────────

function applyStyle(next: Style, opts: { save?: boolean } = {}) {
  style = reducedMotion && next !== "mosaic" && next !== "polaroid" ? "fade" : next;
  stage.dataset.style = style;
  clearStage();
  if (opts.save) savePrefs();
  renderOptions();
  void advanceFromCurrent();
}

/** Re-show what's on screen in the new style instead of skipping ahead. */
async function advanceFromCurrent() {
  if (current) fresh.unshift(current);
  await advance();
}

function setSpeed(seconds: number) {
  intervalMs = seconds * 1000;
  savePrefs();
  renderOptions();
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ style, interval: intervalMs / 1000 }));
  } catch {}
  // Keep the URL in sync, so copying it from the address bar keeps the look.
  const url = new URL(location.href);
  url.searchParams.set("style", style);
  url.searchParams.set("interval", String(intervalMs / 1000));
  history.replaceState(null, "", url);
}

const settingsEl = $<HTMLElement>("#settings");

function renderOptions() {
  $("#style-options").replaceChildren(
    ...(Object.keys(STYLES) as Style[]).map((s, i) =>
      optionButton(`${i + 1} · ${STYLES[s]}`, s === style, () => applyStyle(s, { save: true })),
    ),
  );
  $("#speed-options").replaceChildren(
    ...SPEEDS.map((sec) => optionButton(`${sec}s`, sec * 1000 === intervalMs, () => setSpeed(sec))),
  );
}

function optionButton(label: string, active: boolean, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = active ? "active" : "";
  b.addEventListener("click", onClick);
  return b;
}

const toggleSettings = (open = settingsEl.hidden) => {
  settingsEl.hidden = !open;
  document.body.classList.toggle("settings-open", open);
};
$("#settings-btn").addEventListener("click", () => toggleSettings());

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
          liveIds.add(msg.photo.id);
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
  if (e.key === "s") toggleSettings();
  if (e.key === "Escape") toggleSettings(false);
  const n = Number(e.key);
  const styles = Object.keys(STYLES) as Style[];
  if (n >= 1 && n <= styles.length) applyStyle(styles[n - 1]!, { save: true });
});
addEventListener("dblclick", (e) => {
  if (!(e.target as Element).closest(".settings, .settings-btn")) void document.documentElement.requestFullscreen?.();
});

// Keep the TV from sleeping where supported.
void (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } }).wakeLock
  ?.request("screen")
  .catch(() => {});

// ─── Boot ─────────────────────────────────────────────────────────────────────

stage.dataset.style = style;
renderOptions();

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
