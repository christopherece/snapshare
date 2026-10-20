import type { EventPublicDTO } from "@snapshare/shared";
import { type FormEvent, useEffect, useState } from "react";
import { API_URL, ApiError, api } from "./api";
import { retryBlocked } from "./queue";
import { type GuestSession, deviceId, sessions } from "./session";

/**
 * Zero-friction onboarding: the QR link pre-fills the event, the guest optionally
 * types a name, taps once, and lands in the camera. No account, no password.
 */
export function Join({
  initialSlug,
  onJoined,
}: {
  initialSlug: string | null;
  onJoined: (s: GuestSession, slug: string) => void;
}) {
  const [code, setCode] = useState(initialSlug ?? "");
  const [event, setEvent] = useState<EventPublicDTO | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [name, setName] = useState(sessions.lastName() ?? "");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slug = code.trim().toLowerCase();

  useEffect(() => {
    setEvent(null);
    setLookupError(null);
    if (slug.length < 6) return;
    let cancelled = false;
    api.getEvent(slug).then(
      (e) => !cancelled && setEvent(e),
      (err) =>
        !cancelled &&
        setLookupError(
          err instanceof ApiError && err.status === 410 ? `${err.message}.` : "We couldn't find an event with that code.",
        ),
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      const guestName = name.trim() || null;
      const res = await api.join(slug, { deviceId: deviceId(), displayName: guestName, passcode: passcode || null });
      const session: GuestSession = { event: res.event, guestToken: res.guestToken, guestName };
      sessions.set(slug, session);
      sessions.rememberName(guestName);
      retryBlocked(res.event.id, res.guestToken);
      onJoined(session, slug);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't connect. Check your signal and try again.");
      setBusy(false);
    }
  };

  const when = event?.startsAt
    ? new Date(event.startsAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <main className="join">
      <form className="join-card" onSubmit={submit}>
        <p className="kicker">{event ? "You're invited to share photos" : "SnapShare"}</p>
        <h1>{event?.name ?? "Join the event"}</h1>
        {event && (when || event.location) && <p className="muted">{[when, event.location].filter(Boolean).join(" · ")}</p>}

        <div className="fields">
          {!initialSlug && (
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Event code"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={32}
              aria-label="Event code"
            />
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (optional)"
            maxLength={60}
            autoComplete="given-name"
            aria-label="Your name"
          />
          {event?.requiresPasscode && (
            <input
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Event passcode"
              type="password"
              aria-label="Event passcode"
            />
          )}
        </div>

        {(error || lookupError) && <p className="error">{error ?? lookupError}</p>}

        <button className="btn primary" disabled={!event || busy}>
          {busy ? "Joining…" : "Start taking photos"}
        </button>
        <p className="fineprint">
          No app or account needed. Photos you take are shared with the hosts and other guests.
        </p>
        {event && (
          <a className="fineprint link" href={`${API_URL}/open/${slug}`}>
            Have the SnapShare app? Open it instead
          </a>
        )}
      </form>
    </main>
  );
}
