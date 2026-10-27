import type { CommentDTO, PhotoDTO, WsServerMessage } from "@snapshare/shared";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, WS_URL, api } from "./api";
import { previewUrl, useQueue } from "./queue";
import type { GuestSession } from "./session";

interface Props {
  session: GuestSession;
  onBack: () => void;
  onSessionExpired: () => void;
}

export function Feed({ session, onBack, onSessionExpired }: Props) {
  const { event, guestToken } = session;
  const feed = useLiveFeed(event.id, guestToken, onSessionExpired);
  const [open, setOpen] = useState<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && feed.loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [feed.loadMore]);

  return (
    <main className="feed">
      <header className="feed-top">
        <div>
          <p className="kicker">Live gallery</p>
          <h1>{event.name}</h1>
        </div>
        <button className="round-btn" aria-label="Back to camera" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
            <circle cx="12" cy="13.5" r="3.5" />
          </svg>
        </button>
      </header>

      <MyPendingStrip eventId={event.id} />

      {feed.photos.length === 0 && !feed.loading && (
        <div className="empty">
          <p>No photos yet.</p>
          <p className="muted">Be the first to capture the moment!</p>
        </div>
      )}

      <div className="photo-grid">
        {feed.photos.map((p, i) => (
          <button key={p.id} className="tile" onClick={() => setOpen(i)} aria-label={`Photo by ${p.guestName ?? "a guest"}`}>
            <img src={p.thumbUrl} alt="" loading="lazy" decoding="async" />
            {p.likeCount > 0 && <span className="tile-likes">♥ {p.likeCount}</span>}
          </button>
        ))}
      </div>
      <div ref={sentinel} className="sentinel">
        {feed.loading && <span className="spinner dark" />}
      </div>

      {open !== null && feed.photos[open] && (
        <Viewer
          photos={feed.photos}
          index={open}
          token={guestToken}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onLiked={feed.patchPhoto}
        />
      )}
    </main>
  );
}

// ─── Data: paginated feed kept live over WebSocket ────────────────────────────

function useLiveFeed(eventId: string, token: string, onExpired: () => void) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const page = await api.getPhotos(token, eventId, reset ? null : cursor);
        setPhotos((prev) => {
          if (reset) return page.items;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
        });
        setCursor(page.nextCursor);
        setHasMore(!!page.nextCursor);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [eventId, token, cursor, onExpired],
  );

  useEffect(() => {
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, token]);

  const loadMore = useCallback(() => {
    if (hasMore) void fetchPage(false);
  }, [hasMore, fetchPage]);

  const patchPhoto = useCallback(
    (id: string, patch: Partial<PhotoDTO>) => setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    [],
  );

  // Live updates with exponential-backoff reconnects; paused while the tab is hidden.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;
    let connectedBefore = false;

    const onMessage = (msg: WsServerMessage) => {
      if (msg.type === "photo.added")
        setPhotos((prev) => (prev.some((p) => p.id === msg.photo.id) ? prev : [msg.photo, ...prev]));
      else if (msg.type === "photo.updated")
        setPhotos((prev) => prev.map((p) => (p.id === msg.photo.id ? { ...msg.photo, likedByMe: p.likedByMe } : p)));
      else if (msg.type === "photo.removed") setPhotos((prev) => prev.filter((p) => p.id !== msg.photoId));
      else if (msg.type === "photo.liked")
        setPhotos((prev) => prev.map((p) => (p.id === msg.photoId ? { ...p, likeCount: msg.likeCount } : p)));
      else if (msg.type === "comment.added") dispatchEvent(new CustomEvent("snapshare:comment", { detail: msg }));
    };

    const connect = () => {
      if (closed || ws) return;
      // Token goes in the subprotocol header, not the URL, so it stays out of proxy logs.
      ws = new WebSocket(`${WS_URL}?eventId=${eventId}`, ["snapshare", `snapshare.guest.${token}`]);
      ws.onopen = () => {
        if (connectedBefore) void fetchFirstPage(); // we may have missed messages while away
        connectedBefore = true;
        retry = 0;
      };
      ws.onmessage = (e) => {
        try {
          onMessage(JSON.parse(String(e.data)));
        } catch {}
      };
      ws.onclose = () => {
        ws = null;
        if (!closed && document.visibilityState === "visible") timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 30_000));
      };
    };

    const fetchFirstPage = async () => {
      try {
        const page = await api.getPhotos(token, eventId);
        setPhotos((prev) => {
          const fresh = page.items.filter((p) => !prev.some((q) => q.id === p.id));
          return [...fresh, ...prev];
        });
      } catch {}
    };

    const onVis = () => {
      if (document.visibilityState === "visible") connect();
      else {
        clearTimeout(timer);
        ws?.close();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      ws?.close();
    };
  }, [eventId, token]);

  return { photos, loading, loadMore, patchPhoto };
}

// ─── Your photos still uploading (so you know they're coming) ────────────────

function MyPendingStrip({ eventId }: { eventId: string }) {
  const items = useQueue().items.filter((i) => i.eventId === eventId);
  if (!items.length) return null;
  return (
    <section className="pending-strip">
      <p className="muted small">Your photos on the way · they'll appear below once uploaded</p>
      <div className="pending-row">
        {items.map((i) => (
          <div key={i.clientId} className={`pending-thumb ${i.status}`}>
            <img src={previewUrl(i)} alt="" />
            {i.status !== "blocked" && <span className="spinner" />}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Full-screen viewer: swipe/arrow navigation, double-tap like, comments ────

function Viewer({
  photos,
  index,
  token,
  onIndex,
  onClose,
  onLiked,
}: {
  photos: PhotoDTO[];
  index: number;
  token: string;
  onIndex: (i: number) => void;
  onClose: () => void;
  onLiked: (id: string, patch: Partial<PhotoDTO>) => void;
}) {
  const photo = photos[index]!;
  const [showComments, setShowComments] = useState(false);
  const [heart, setHeart] = useState(0);
  const lastTap = useRef(0);
  const touchX = useRef<number | null>(null);

  const go = (d: number) => {
    const n = index + d;
    if (n >= 0 && n < photos.length) onIndex(n);
  };

  const setLike = async (liked: boolean) => {
    const prev = { likedByMe: photo.likedByMe, likeCount: photo.likeCount };
    onLiked(photo.id, { likedByMe: liked, likeCount: Math.max(0, photo.likeCount + (liked ? 1 : -1)) });
    navigator.vibrate?.(10);
    try {
      const res = await api.setLike(token, photo.id, liked);
      onLiked(photo.id, { likedByMe: res.liked, likeCount: res.likeCount });
    } catch {
      onLiked(photo.id, prev);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  return (
    <div className="viewer" role="dialog" aria-modal>
      <div
        className="viewer-stage"
        onClick={() => {
          const now = Date.now();
          if (now - lastTap.current < 300) {
            if (!photo.likedByMe) void setLike(true);
            setHeart((h) => h + 1);
          }
          lastTap.current = now;
        }}
        onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        <img key={photo.id} src={photo.displayUrl} alt="" style={{ backgroundImage: `url("${photo.thumbUrl}")` }} />
        {heart > 0 && (
          <span key={heart} className="big-heart" aria-hidden>
            ♥
          </span>
        )}
      </div>

      <header className="viewer-top">
        <span>{photo.guestName ? `📸 ${photo.guestName}` : ""}</span>
        <button className="round-btn light" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      <footer className="viewer-bottom">
        <button className={`like ${photo.likedByMe ? "on" : ""}`} onClick={() => setLike(!photo.likedByMe)}>
          {photo.likedByMe ? "♥" : "♡"} {photo.likeCount > 0 ? photo.likeCount : ""}
        </button>
        <button className="comment-btn" onClick={() => setShowComments(true)}>
          💬 Comments
        </button>
        <span className="muted small counter">
          {index + 1} / {photos.length}
        </span>
      </footer>

      {showComments && <Comments photoId={photo.id} token={token} onClose={() => setShowComments(false)} />}
    </div>
  );
}

function Comments({ photoId, token, onClose }: { photoId: string; token: string; onClose: () => void }) {
  const [comments, setComments] = useState<CommentDTO[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.getComments(token, photoId).then(setComments, () => setComments([]));
    const onLive = (e: Event) => {
      const msg = (e as CustomEvent<Extract<WsServerMessage, { type: "comment.added" }>>).detail;
      if (msg.photoId === photoId)
        setComments((prev) => (prev && !prev.some((c) => c.id === msg.comment.id) ? [...prev, msg.comment] : prev));
    };
    addEventListener("snapshare:comment", onLive);
    return () => removeEventListener("snapshare:comment", onLive);
  }, [photoId, token]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const c = await api.addComment(token, photoId, body);
      setComments((prev) => (prev?.some((x) => x.id === c.id) ? prev : [...(prev ?? []), c]));
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="comment-list">
          {comments === null && <span className="spinner dark" />}
          {comments?.length === 0 && <p className="muted center">Say something nice ✨</p>}
          {comments?.map((c) => (
            <div key={c.id} className="comment">
              <strong>{c.guestName ?? "Guest"}</strong>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
        <form className="comment-form" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" maxLength={280} aria-label="Comment" />
          <button className="btn primary small" disabled={!text.trim() || sending}>
            Post
          </button>
        </form>
      </section>
    </div>
  );
}
