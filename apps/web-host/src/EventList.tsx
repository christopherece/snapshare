import { type FormEvent, useEffect, useState } from "react";
import { type HostEvent, type Me, api } from "./api";
import { navigate } from "./router";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

export function EventList({ me }: { me: Me | null }) {
  const [events, setEvents] = useState<HostEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.events().then(setEvents, (e) => setError(e.message));
  }, []);

  const atLimit = !!me && me.eventLimit !== null && (events?.length ?? 0) >= me.eventLimit;
  const canCreate = !!me && !!events && !atLimit;

  // A customer with their one event goes straight to it.
  useEffect(() => {
    if (me?.eventLimit === 1 && events?.length === 1 && !events[0]!.suspended) navigate(`/events/${events[0]!.id}`);
  }, [me, events]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">{me?.role === "admin" ? "Your events" : "Welcome"}</p>
          <h1>{me?.eventLimit === 1 ? "Your event" : "Events"}</h1>
        </div>
        {canCreate && !creating && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New event
          </button>
        )}
      </div>

      {atLimit && events?.some((e) => e.suspended) && (
        <p className="notice warn">Your event has been suspended. Please contact the organiser.</p>
      )}

      {creating && (
        <CreateEvent
          onCancel={() => setCreating(false)}
          onCreated={(e) => navigate(`/events/${e.id}`)}
        />
      )}

      {error && <p className="error">{error}</p>}
      {!events && !error && <p className="muted">Loading…</p>}
      {events?.length === 0 && !creating && (
        <div className="empty-card">
          <h2>{me?.eventLimit === 1 ? "Set up your event" : "No events yet"}</h2>
          <p className="muted">Create your event to get a QR code guests can scan.</p>
          {canCreate && (
            <button className="btn primary" onClick={() => setCreating(true)} style={{ marginTop: 16 }}>
              Create my event
            </button>
          )}
        </div>
      )}

      <div className="event-grid">
        {events?.map((e) => (
          <a
            key={e.id}
            href={e.suspended ? undefined : `#/events/${e.id}`}
            className={`event-card ${e.suspended ? "suspended" : ""}`}
          >
            <div className="event-card-top">
              <h2>{e.name}</h2>
              {!!e.pendingCount && <span className="badge accent">{e.pendingCount} to review</span>}
            </div>
            <p className="muted">
              {[fmtDate(e.startsAt), e.location].filter(Boolean).join(" · ") || "No date set"}
            </p>
            <div className="event-card-foot">
              <span>
                <strong>{e.photoCount ?? 0}</strong> photos
              </span>
              <span className="code">{e.slug.toUpperCase()}</span>
              {e.suspended ? (
                <span className="badge danger">Suspended</span>
              ) : (
                !e.uploadsOpen && <span className="badge">Closed</span>
              )}
            </div>
          </a>
        ))}
      </div>
    </>
  );
}

function CreateEvent({ onCancel, onCreated }: { onCancel: () => void; onCreated: (e: HostEvent) => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [passcode, setPasscode] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const startsAt = date ? new Date(`${date}T00:00:00`) : null;
      const created = await api.createEvent({
        name,
        location: location || null,
        startsAt: startsAt?.toISOString() ?? null,
        // Uploads stay open until the end of the day after the event (plus the server's 12h grace).
        endsAt: startsAt ? new Date(startsAt.getTime() + 2 * 86_400_000).toISOString() : null,
        passcode: passcode || null,
        requireApproval,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event");
      setBusy(false);
    }
  };

  return (
    <form className="card form-card" onSubmit={submit}>
      <h2>New event</h2>
      <div className="form-grid">
        <label className="span-2">
          Event name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} placeholder="Sarah & Mark's Wedding" autoFocus />
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={255} placeholder="Optional" />
        </label>
        <label>
          Guest passcode
          <input value={passcode} onChange={(e) => setPasscode(e.target.value)} minLength={4} maxLength={64} placeholder="Optional" />
        </label>
        <label className="check">
          <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
          <span>
            Approve photos before they go public
            <small>Otherwise photos appear instantly in the feed and slideshow.</small>
          </span>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? "Creating…" : "Create event"}
        </button>
      </div>
    </form>
  );
}
