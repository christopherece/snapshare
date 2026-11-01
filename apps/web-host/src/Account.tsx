import { type FormEvent, useState } from "react";
import { type Me, api } from "./api";

/** The signed-in host's account: who they are, and changing their password. */
export function Account({ me, onTokenChanged }: { me: Me; onTokenChanged: (token: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (next !== confirm) return setStatus({ ok: false, text: "The new passwords don't match." });
    setBusy(true);
    try {
      const { token } = await api.changePassword(current, next);
      onTokenChanged(token); // this session stays signed in; any others are signed out
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({ ok: true, text: "Password changed. You've been signed out on your other devices." });
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : "Couldn't change your password." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Account</p>
          <h1>{me.name}</h1>
          <p className="muted">
            {me.email} · {me.role === "admin" ? "Admin" : "Host"}
          </p>
        </div>
      </div>

      <form className="card account-card" onSubmit={submit}>
        <h3>Change password</h3>
        <label>
          Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </label>
        <label>
          New password (8+ characters)
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <label>
          Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        {status && <p className={status.ok ? "notice ok" : "error"}>{status.text}</p>}
        <div className="row end">
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </>
  );
}
