import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type HostAccount, type Invite, api } from "./api";
import { inviteLink } from "./router";

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Admin page: who can host events, and invite links for new hosts. */
export function Team() {
  const [hosts, setHosts] = useState<HostAccount[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.admin.hosts().then(setHosts, (e) => setError(e.message));
    api.admin.invites().then(setInvites, () => {});
  }, []);
  useEffect(load, [load]);

  const update = async (h: HostAccount, patch: { disabled?: boolean; role?: "admin" | "host" }) => {
    if (patch.disabled && !confirm(`Disable ${h.email}? They'll be signed out and can't sign in until you re-enable them.`)) return;
    try {
      await api.admin.updateHost(h.id, patch);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Admin</p>
          <h1>Team</h1>
          <p className="muted">Only people you invite can create a host account and run events.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <InvitePanel invites={invites} onChange={load} />

      <section className="card">
        <h3>Host accounts</h3>
        {!hosts && <p className="muted">Loading…</p>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Events</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {hosts?.map((h) => (
                <tr key={h.id} className={h.disabled ? "dimmed" : ""}>
                  <td>
                    {h.name} {h.isMe && <span className="badge">You</span>}
                  </td>
                  <td>{h.email}</td>
                  <td>{h.role === "admin" ? <span className="badge accent">Admin</span> : "Host"}</td>
                  <td>{h.eventCount}</td>
                  <td>{fmt(h.createdAt)}</td>
                  <td className="actions">
                    {!h.isMe && (
                      <>
                        {h.disabled ? (
                          <button className="btn small" onClick={() => update(h, { disabled: false })}>
                            Enable
                          </button>
                        ) : (
                          <button className="btn small danger" onClick={() => update(h, { disabled: true })}>
                            Disable
                          </button>
                        )}
                        <button
                          className="btn small ghost"
                          onClick={() => update(h, { role: h.role === "admin" ? "host" : "admin" })}
                        >
                          {h.role === "admin" ? "Remove admin" : "Make admin"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function InvitePanel({ invites, onChange }: { invites: Invite[]; onChange: () => void }) {
  const [note, setNote] = useState("");
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState<{ link: string; note: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const inv = await api.admin.createInvite(note.trim() || null, days);
      setCreated({ link: inviteLink(inv.token), note: inv.note });
      setCopied(false);
      setNote("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create invite");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {}
  };

  return (
    <section className="card team-invite">
      <h3>Invite a host</h3>
      <form className="invite-form" onSubmit={create}>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who is it for? (e.g. Sarah — wedding)" maxLength={120} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Link valid for">
          <option value={1}>Valid 1 day</option>
          <option value={7}>Valid 7 days</option>
          <option value={30}>Valid 30 days</option>
        </select>
        <button className="btn primary" disabled={busy}>
          {busy ? "Creating…" : "Create invite link"}
        </button>
      </form>
      {error && <p className="error small">{error}</p>}

      {created && (
        <div className="invite-created">
          <p className="small">
            Send this link{created.note ? ` to ${created.note}` : ""}. It works once, and this is the only time it's shown.
          </p>
          <div className="row">
            <input readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn small" onClick={copy}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <>
          <p className="label small">Pending invites</p>
          <ul className="invite-list">
            {invites.map((i) => (
              <li key={i.id}>
                <span>{i.note ?? "Unnamed invite"}</span>
                <span className="muted small">expires {fmt(i.expiresAt)}</span>
                <button
                  className="btn link small"
                  onClick={async () => {
                    await api.admin.revokeInvite(i.id).catch(() => {});
                    onChange();
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
