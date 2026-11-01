import { Logo } from "./Logo";
import type { EventPublicDTO } from "@snapshare/shared";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { API_URL, ApiError, api } from "./api";
import { enterFullscreen } from "./fullscreen";
import { trackOrientation } from "./orientation";
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
  const loading = slug.length >= 6 && !event && !lookupError;

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

  useEffect(() => {
    document.title = event ? `${event.name} · SnapShare` : "Join an event · SnapShare";
  }, [event]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!event) return;
    enterFullscreen(); // must run inside the tap, before any await
    void trackOrientation(); // landscape photos — iPhone asks for motion access, which needs this tap
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
    ? new Date(event.startsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long" })
    : null;

  return (
    <main className="join">
      <div className="join-glow" aria-hidden />
      <header className="join-top">
        <Logo size={30} />
      </header>

      <form className="join-card" onSubmit={submit}>
        {loading ? (
          <div className="join-skeleton" aria-label="Loading event">
            <span />
            <span />
            <span />
          </div>
        ) : event ? (
          <>
            <p className="kicker">You're invited to share photos</p>
            <h1>{event.name}</h1>
            {(when || event.location) && (
              <div className="join-meta">
                {when && (
                  <span className="meta-chip">
                    <IconCalendar /> {when}
                  </span>
                )}
                {event.location && (
                  <span className="meta-chip">
                    <IconPin /> {event.location}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="kicker">Join an event</p>
            <h1>{lookupError ? "Hmm, that didn't work" : "Enter your event code"}</h1>
            {!lookupError && <p className="muted">It's printed under the QR code at the venue.</p>}
          </>
        )}

        {(event || !initialSlug) && (
          <ol className="steps" aria-label="How it works">
            <li>
              <IconCamera />
              <span>Snap</span>
            </li>
            <li>
              <IconSend />
              <span>It's shared</span>
            </li>
            <li>
              <IconSpark />
              <span>See it live</span>
            </li>
          </ol>
        )}

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
          {(event || !initialSlug) && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              maxLength={60}
              autoComplete="given-name"
              aria-label="Your name"
            />
          )}
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

        {(error || lookupError) && (
          <p className="error" role="alert">
            {error ?? lookupError}
          </p>
        )}

        {event && (
          <div className="join-notice">
            <p>
              <strong>Before you start.</strong> Your photos are shared with the host and other guests, and may appear{" "}
              <strong>live on the big screen</strong>.
            </p>
            <p>Only take photos people are happy to share. Nothing offensive, and respect anyone who'd rather not be photographed.</p>
          </div>
        )}

        {(event || !initialSlug) && (
          <button className="btn primary big" disabled={!event || busy}>
            {busy ? (
              <>
                <span className="spinner" /> Joining…
              </>
            ) : (
              <>
                <IconCamera /> Open the camera
              </>
            )}
          </button>
        )}
        <p className="fineprint">
          No app or account needed. By continuing you agree to the{" "}
          <a href={`${API_URL}/terms`} target="_blank" rel="noopener">
            Guest terms
          </a>{" "}
          and{" "}
          <a href={`${API_URL}/privacy`} target="_blank" rel="noopener">
            Privacy notice
          </a>
          .
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

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const IconCamera = () => (
  <Svg>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Svg>
);
const IconSend = () => (
  <Svg>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
  </Svg>
);
const IconSpark = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="12" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Svg>
);
const IconCalendar = () => (
  <Svg>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Svg>
);
const IconPin = () => (
  <Svg>
    <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </Svg>
);
