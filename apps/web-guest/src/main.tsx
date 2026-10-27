import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera } from "./Camera";
import { Feed } from "./Feed";
import { Join } from "./Join";
import { startQueue } from "./queue";
import { type GuestSession, sessions } from "./session";

/** Event code from /join/<code> (the QR link). */
const slugFromPath = () => location.pathname.match(/\/join\/([\w-]+)/)?.[1]?.toLowerCase() ?? null;

function App() {
  const [slug, setSlug] = useState(slugFromPath);
  const [session, setSession] = useState<GuestSession | null>(() => (slug ? sessions.get(slug) : null));
  const [view, setView] = useState<"camera" | "feed">("camera");
  const [lastThumb, setLastThumb] = useState<string | null>(null);

  useEffect(() => void startQueue(), []);

  // Keep the URL shareable and the back button sensible.
  useEffect(() => {
    if (slug && !location.pathname.endsWith(`/join/${slug}`)) history.replaceState(null, "", `/join/${slug}${location.search}`);
  }, [slug]);

  useEffect(() => {
    const onPop = () => setView(location.hash === "#feed" ? "feed" : "camera");
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const openFeed = () => {
    history.pushState(null, "", "#feed");
    setView("feed");
  };
  const closeFeed = () => (location.hash === "#feed" ? history.back() : setView("camera"));

  if (!session || !slug) {
    return (
      <Join
        initialSlug={slug}
        onJoined={(s, joinedSlug) => {
          setSlug(joinedSlug);
          setSession(s);
        }}
      />
    );
  }

  const leave = () => {
    sessions.clear(slug);
    setSession(null);
  };

  return view === "feed" ? (
    <Feed session={session} onBack={closeFeed} onSessionExpired={leave} />
  ) : (
    <Camera
      session={session}
      lastThumb={lastThumb}
      onCaptured={(url) =>
        setLastThumb((prev) => {
          if (prev && prev !== url) URL.revokeObjectURL(prev);
          return url;
        })
      }
      onOpenFeed={openFeed}
    />
  );
}

// The manifest and icons are served as-is from public/ (the manifest needs fixed icon paths), which the
// HTML bundler can't resolve at build time — so link them here.
for (const [rel, href] of [
  ["manifest", `/join/manifest.webmanifest${slugFromPath() ? `?slug=${slugFromPath()}` : ""}`],
  ["apple-touch-icon", "/join/icons/apple-touch-icon.png"],
] as const) {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  document.head.append(link);
}

createRoot(document.getElementById("root")!).render(<App />);

// Makes the app installable on Android ("Install app") and lets it open offline. HTTPS / localhost only.
if ("serviceWorker" in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register("/join/sw.js", { scope: "/join/" }).catch(() => {});
}
