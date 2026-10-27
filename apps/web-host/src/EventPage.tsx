import type { PhotoDTO, WsServerMessage } from "@snapshare/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { type HostEvent, type Me, type PhotoFilter, api, openEventSocket } from "./api";

const matches = (p: PhotoDTO, f: PhotoFilter) =>
  f === "all" || (f === "favorites" ? p.isFavorite : p.moderation === f);

export function EventPage({ eventId, token, me }: { eventId: string; token: string; me: Me | null }) {
  const [event, setEvent] = useState<HostEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshEvent = useCallback(() => api.event(eventId).then(setEvent, (e) => setError(e.message)), [eventId]);
  useEffect(() => void refreshEvent(), [refreshEvent]);

  if (error) return <p className="notice warn">{error}</p>;
  if (!event) return <p className="muted">Loading…</p>;

  const isAdmin = me?.role === "admin";
  const managingOthers = isAdmin && event.owner && event.owner.id !== me?.id;
  const single = me?.eventLimit === 1;

  return (
    <>
      <div className="page-head">
        <div>
          {!single && (
            <a href={managingOthers ? "#/admin/events" : "#/"} className="back">
              ← {managingOthers ? "All customer events" : "All events"}
            </a>
          )}
          <h1>{event.name}</h1>
          <p className="muted">
            {[event.startsAt && new Date(event.startsAt).toLocaleDateString(), event.location].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {managingOthers && (
        <p className="notice">
          You're managing <strong>{event.owner!.name}</strong>'s event ({event.owner!.email}) as admin.
        </p>
      )}
      {event.suspended && (
        <p className="notice warn">
          This event is <strong>suspended</strong>: guests, the slideshow and the customer can't access it. Restore it from
          Admin → Events.
        </p>
      )}

      <div className="event-layout">
        <aside className="side">
          <SharePanel event={event} />
          <DownloadPanel event={event} />
          <SettingsPanel event={event} onSaved={setEvent} />
        </aside>
        <Gallery event={event} token={token} onCountsChanged={refreshEvent} />
      </div>
    </>
  );
}

// ─── Share: QR, flyer, slideshow ──────────────────────────────────────────────

function SharePanel({ event }: { event: HostEvent }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.qrSvg(event.id).then(setQr, () => setQr(null));
  }, [event.id]);

  const printFlyer = async () => {
    const win = window.open("", "_blank"); // open synchronously so popup blockers allow it
    const html = await api.flyerHtml(event.id);
    win?.document.write(html);
    win?.document.close();
  };

  const copySlideshow = async () => {
    try {
      await navigator.clipboard.writeText(event.slideshowUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <section className="card">
      <h3>Invite guests</h3>
      <div className="qr" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
      <p className="join-code">
        Event code <strong>{event.slug.toUpperCase()}</strong>
      </p>
      <div className="stack">
        <button className="btn primary block" onClick={printFlyer}>
          Print QR flyer
        </button>
        <a className="btn block" href={event.slideshowUrl} target="_blank" rel="noreferrer">
          Open live slideshow ↗
        </a>
        <button className="btn ghost block small" onClick={copySlideshow}>
          {copied ? "Copied ✓" : "Copy slideshow link"}
        </button>
      </div>
    </section>
  );
}

// ─── Download ZIP ─────────────────────────────────────────────────────────────

function DownloadPanel({ event }: { event: HostEvent }) {
  const [busy, setBusy] = useState<"all" | "favorites" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = (event.photoCount ?? 0) - (event.hiddenCount ?? 0);

  const download = async (filter: "all" | "favorites") => {
    setBusy(filter);
    setError(null);
    try {
      // The signed link streams a ZIP with Content-Disposition: attachment, so the page stays put.
      location.href = await api.downloadUrl(event.id, filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setTimeout(() => setBusy(null), 1500);
    }
  };

  return (
    <section className="card">
      <h3>Download originals</h3>
      <p className="muted small">Full-resolution photos as a ZIP, oldest first. Hidden photos are left out.</p>
      <div className="stack">
        <button className="btn primary block" disabled={!visible || !!busy} onClick={() => download("all")}>
          {busy === "all" ? "Preparing…" : `Download all (${visible})`}
        </button>
        <button className="btn block" disabled={!event.favoriteCount || !!busy} onClick={() => download("favorites")}>
          {busy === "favorites" ? "Preparing…" : `Favorites only (${event.favoriteCount ?? 0})`}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsPanel({ event, onSaved }: { event: HostEvent; onSaved: (e: HostEvent) => void }) {
  const [passcode, setPasscode] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const save = async (patch: Parameters<typeof api.updateEvent>[1]) => {
    setStatus("Saving…");
    try {
      const updated = await api.updateEvent(event.id, patch);
      onSaved({ ...event, ...updated });
      setStatus("Saved ✓");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Save failed");
    }
  };

  return (
    <section className="card">
      <div className="row between">
        <h3>Settings</h3>
        {status && <span className="muted small">{status}</span>}
      </div>
      <Toggle
        label="Accept uploads"
        hint="Turn off after the event to stop new photos."
        checked={event.uploadsOpen}
        onChange={(v) => save({ uploadsOpen: v })}
      />
      <Toggle
        label="Approve before public"
        hint="New photos wait in “To review” until you approve them."
        checked={event.requireApproval}
        onChange={(v) => save({ requireApproval: v })}
      />
      <div className="passcode">
        <p className="label">Guest passcode {event.hasPasscode ? <span className="badge">On</span> : <span className="badge">Off</span>}</p>
        <div className="row">
          <input
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder={event.hasPasscode ? "New passcode" : "Set a passcode"}
            minLength={4}
          />
          <button
            className="btn small"
            disabled={passcode.length < 4}
            onClick={() => save({ passcode }).then(() => setPasscode(""))}
          >
            Set
          </button>
        </div>
        {event.hasPasscode && (
          <button className="btn link small" onClick={() => save({ passcode: null })}>
            Remove passcode
          </button>
        )}
      </div>
    </section>
  );
}

function Toggle(props: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {props.label}
        <small>{props.hint}</small>
      </span>
      <input type="checkbox" role="switch" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

// ─── Gallery with live updates + moderation ───────────────────────────────────

function Gallery({ event, token, onCountsChanged }: { event: HostEvent; token: string; onCountsChanged: () => void }) {
  const [filter, setFilter] = useState<PhotoFilter>(event.pendingCount ? "pending" : "all");
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // Debounced count refresh so a burst of uploads triggers one request.
  const countsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bumpCounts = useCallback(() => {
    clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(onCountsChanged, 600);
  }, [onCountsChanged]);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const page = await api.photos(event.id, filter, reset ? null : cursor);
        setPhotos((prev) => (reset ? page.items : [...prev, ...page.items]));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [event.id, filter, cursor],
  );

  useEffect(() => {
    setPhotos([]);
    setCursor(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, filter]);

  // Live updates (host channel includes pending & hidden photos).
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = openEventSocket(event.id, token);
      ws.onopen = () => (retry = 0);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as WsServerMessage;
        const f = filterRef.current;
        if (msg.type === "photo.added") {
          if (matches(msg.photo, f)) setPhotos((prev) => (prev.some((p) => p.id === msg.photo.id) ? prev : [msg.photo, ...prev]));
          bumpCounts();
        } else if (msg.type === "photo.updated") {
          setPhotos((prev) =>
            matches(msg.photo, f) ? prev.map((p) => (p.id === msg.photo.id ? msg.photo : p)) : prev.filter((p) => p.id !== msg.photo.id),
          );
          bumpCounts();
        } else if (msg.type === "photo.removed") {
          setPhotos((prev) => prev.filter((p) => p.id !== msg.photoId));
          bumpCounts();
        } else if (msg.type === "photo.liked") {
          setPhotos((prev) => prev.map((p) => (p.id === msg.photoId ? { ...p, likeCount: msg.likeCount } : p)));
        }
      };
      ws.onclose = () => {
        if (!closed) timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 30_000));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [event.id, token, bumpCounts]);

  const act = async (photo: PhotoDTO, action: "approve" | "hide" | "favorite" | "delete") => {
    if (action === "delete") {
      if (!confirm("Delete this photo permanently? This can't be undone.")) return;
      await api.deletePhoto(photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } else {
      const patch =
        action === "approve"
          ? { moderation: "approved" as const }
          : action === "hide"
            ? { moderation: "hidden" as const }
            : { isFavorite: !photo.isFavorite };
      const updated = await api.moderate(photo.id, patch);
      setPhotos((prev) =>
        matches(updated, filter) ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev.filter((p) => p.id !== updated.id),
      );
    }
    bumpCounts();
  };

  const chips: { key: PhotoFilter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: event.photoCount },
    { key: "pending", label: "To review", count: event.pendingCount },
    { key: "favorites", label: "Favorites", count: event.favoriteCount },
    { key: "hidden", label: "Hidden", count: event.hiddenCount },
  ];

  return (
    <section className="gallery">
      <div className="chips">
        {chips.map((c) => (
          <button key={c.key} className={`chip ${filter === c.key ? "active" : ""}`} onClick={() => setFilter(c.key)}>
            {c.label}
            {c.count ? <span className="chip-count">{c.count}</span> : null}
          </button>
        ))}
        <span className="live-dot" title="Live — new photos appear automatically">
          Live
        </span>
      </div>

      {!loading && photos.length === 0 && (
        <div className="empty-card">
          <h2>{filter === "pending" ? "All caught up" : "No photos here yet"}</h2>
          <p className="muted">
            {filter === "all" ? "Photos appear here the moment guests take them." : "Nothing in this view right now."}
          </p>
        </div>
      )}

      <div className="photo-grid">
        {photos.map((p, i) => (
          <figure key={p.id} className={`tile ${p.moderation}`}>
            <img src={p.thumbUrl} alt="" loading="lazy" onClick={() => setOpen(i)} />
            {p.moderation !== "approved" && <span className={`status ${p.moderation}`}>{p.moderation === "pending" ? "To review" : "Hidden"}</span>}
            <button className={`fav ${p.isFavorite ? "on" : ""}`} title="Favorite" onClick={() => act(p, "favorite")}>
              {p.isFavorite ? "★" : "☆"}
            </button>
            <figcaption>
              <span className="who">{p.guestName ?? "Guest"}</span>
              <span className="tile-actions">
                {p.moderation !== "approved" && (
                  <button title="Approve" onClick={() => act(p, "approve")}>
                    ✓
                  </button>
                )}
                {p.moderation !== "hidden" && (
                  <button title="Hide" onClick={() => act(p, "hide")}>
                    ⦸
                  </button>
                )}
                <button title="Delete" onClick={() => act(p, "delete")}>
                  🗑
                </button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {cursor && (
        <div className="row center">
          <button className="btn" disabled={loading} onClick={() => load(false)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {open !== null && photos[open] && (
        <Lightbox
          photo={photos[open]}
          onClose={() => setOpen(null)}
          onPrev={open > 0 ? () => setOpen(open - 1) : undefined}
          onNext={open < photos.length - 1 ? () => setOpen(open + 1) : undefined}
          onAction={(a) => act(photos[open]!, a)}
        />
      )}
    </section>
  );
}

function Lightbox(props: {
  photo: PhotoDTO;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onAction: (a: "approve" | "hide" | "favorite" | "delete") => void;
}) {
  const { photo, onClose, onPrev, onNext, onAction } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev?.();
      if (e.key === "ArrowRight") onNext?.();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="lightbox" onClick={onClose}>
      <img src={photo.displayUrl} alt="" onClick={(e) => e.stopPropagation()} />
      {onPrev && (
        <button className="nav prev" onClick={(e) => (e.stopPropagation(), onPrev())}>
          ‹
        </button>
      )}
      {onNext && (
        <button className="nav next" onClick={(e) => (e.stopPropagation(), onNext())}>
          ›
        </button>
      )}
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>
          {photo.guestName ?? "Guest"} · {new Date(photo.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          {photo.likeCount ? ` · ♥ ${photo.likeCount}` : ""}
        </span>
        <span className="row">
          <button className="btn small" onClick={() => onAction("favorite")}>
            {photo.isFavorite ? "★ Favorited" : "☆ Favorite"}
          </button>
          {photo.moderation !== "approved" && (
            <button className="btn small primary" onClick={() => onAction("approve")}>
              Approve
            </button>
          )}
          {photo.moderation !== "hidden" && (
            <button className="btn small" onClick={() => onAction("hide")}>
              Hide
            </button>
          )}
          <button className="btn small danger" onClick={() => onAction("delete")}>
            Delete
          </button>
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
    </div>
  );
}
