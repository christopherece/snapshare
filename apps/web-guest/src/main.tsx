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

createRoot(document.getElementById("root")!).render(<App />);
