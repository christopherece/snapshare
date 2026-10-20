import { type FormEvent, useEffect, useState } from "react";
import { type AuthConfig, type InviteInfo, api } from "./api";

export function Login({ inviteToken, onAuthed }: { inviteToken: string | null; onAuthed: (token: string) => void }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">(inviteToken ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfig().then(
      (c) => {
        setConfig(c);
        if (c.setupRequired) setMode("register");
      },
      () => setConfig({ registration: "invite", setupRequired: false }),
    );
  }, []);

  // Invite links: greet the customer and pre-fill (and lock) the email the invite was made for.
  useEffect(() => {
    if (!inviteToken) return;
    api.inviteInfo(inviteToken).then(
      (info) => {
        setInvite(info);
        if (info.email) setEmail(info.email);
        if (info.note) setName(info.note);
      },
      (e) => {
        setInviteError(e.message);
        setMode("login");
      },
    );
  }, [inviteToken]);

  const usableInvite = !!inviteToken && !inviteError;
  const canRegister = usableInvite || config?.setupRequired || config?.registration === "open";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(name, email, password, usableInvite ? inviteToken : null);
      onAuthed(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "login"
      ? "Welcome back"
      : config?.setupRequired
        ? "Create the admin account"
        : usableInvite
          ? "You're invited"
          : "Create your account";

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <p className="kicker">SnapShare</p>
        <h1>{title}</h1>
        <p className="muted">
          {config?.setupRequired && mode === "register"
            ? "This is a new install — the first account manages who else can host events."
            : usableInvite && mode === "register"
              ? "Create your account to set up your event. Guests will scan a QR code to share their photos live."
              : "Collect every guest's photos, live, in one place."}
        </p>
        {inviteError && <p className="notice warn">{inviteError}. Ask the organiser for a new link, or sign in below.</p>}

        {mode === "register" && (
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            readOnly={mode === "register" && !!invite?.email}
          />
        </label>
        <label>
          {mode === "register" ? "Choose a password (8+ characters)" : "Password"}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn primary block" disabled={busy || !config}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>

        {canRegister ? (
          <button
            type="button"
            className="btn link"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        ) : (
          config && <p className="muted small center">Hosting is by invitation. Ask the organiser for an invite link.</p>
        )}
      </form>
    </div>
  );
}
