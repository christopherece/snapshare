// Service worker for the guest app (scope /join/). Android Chrome needs one before it offers
// "Install app"; it also lets the installed app open with no signal. Photo uploads already work
// offline through the in-page IndexedDB queue — this only makes the app itself load.
const CACHE = "snapshare-guest-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // API calls, uploads to storage, photos and WebSockets go straight to the network, untouched.
  if (req.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/join/")) return;
  if (url.pathname.endsWith(".webmanifest")) return; // let manifest edits (name, icons) through

  if (req.mode === "navigate") {
    // Pages: always try the network first (fresh deploys), fall back to the last copy offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/join/", { ignoreSearch: true }))),
    );
    return;
  }

  // Bundled JS/CSS/icons have content-hashed or fixed names: serve from cache, fill it on first use.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
