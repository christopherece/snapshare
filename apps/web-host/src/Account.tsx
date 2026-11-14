import { type FormEvent, useState } from "react";
import { type Me, api } from "./api";

/** The signed-in host's account: who they are, changing their password, and deleting the account. */
export function Account({
  me,
  onTokenChanged,
  onDeleted,
}: {
  me: Me;
  onTokenChanged: (token: string) => void;
  onDeleted: () => void;
}) {
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

      <DeleteAccount onDeleted={onDeleted} />
    </>
  );
}

/** Permanently delete the account and everything in it — needs the password, then one more confirm. */
function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm("Delete your account, all of your events and every photo in them? This can't be undone.")) return;
    setError(null);
    setBusy(true);
    try {
      await api.deleteAccount(password);
      alert("Your account has been deleted.");
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete your account.");
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="card account-card">
        <h3>Delete account</h3>
        <p className="muted">
          Permanently deletes your account, your events and all of their photos. Download the photos you want to keep first.
        </p>
        <div className="row end">
          <button type="button" className="btn danger" onClick={() => setOpen(true)}>
            Delete my account…
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="card account-card" onSubmit={submit}>
      <h3>Delete account</h3>
      <p className="muted">
        This deletes your account, every event you host and all of their photos, straight away. It can't be undone.
      </p>
      <label>
        Your password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button className="btn danger" disabled={busy || !password}>
          {busy ? "Deleting…" : "Delete my account permanently"}
        </button>
      </div>
    </form>
  );
}
