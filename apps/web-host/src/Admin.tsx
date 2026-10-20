import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type HostAccount, type HostEvent, type Invite, api } from "./api";
import { type AdminTab, inviteLink } from "./router";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Admin console: every customer event, customer accounts, and invites. */
export function Admin({ tab }: { tab: AdminTab }) {
  return (
    <>
      <div className="page-head">
        <div>
          <p className="kicker">Admin</p>
          <h1>Manage SnapShare</h1>
        </div>
      </div>
      <nav className="tabs" role="tablist">
        {(
          [
            ["events", "Events"],
            ["customers", "Customers"],
            ["invites", "Invites"],
          ] as const
        ).map(([key, label]) => (
          <a key={key} role="tab" aria-selected={tab === key} className={`tab ${tab === key ? "active" : ""}`} href={`#/admin/${key}`}>
            {label}
          </a>
        ))}
      </nav>
      {tab === "events" && <EventsTab />}
      {tab === "customers" && <CustomersTab />}
      {tab === "invites" && <InvitesTab />}
    </>
  );
}

// ─── Events ───────────────────────────────────────────────────────────────────

function EventsTab() {
  const [events, setEvents] = useState<HostEvent[] | null>(null);
  const [editing, setEditing] = useState<HostEvent | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.admin.events().then(setEvents, (e) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const suspend = (e: HostEvent) =>
    run(async () => {
      if (!e.suspended && !confirm(`Suspend "${e.name}"? Guests, the slideshow and ${e.owner?.name ?? "the customer"} lose access until you restore it.`))
        return;
      await api.admin.updateEvent(e.id, { suspended: !e.suspended });
    });

  const remove = (e: HostEvent) =>
    run(async () => {
      if (!confirm(`Permanently delete "${e.name}" and all ${e.photoCount ?? 0} photos? This can't be undone.`)) return;
      await api.admin.deleteEvent(e.id);
    });

  const q = query.trim().toLowerCase();
  const shown = events?.filter(
    (e) => !q || [e.name, e.slug, e.owner?.name, e.owner?.email].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <section className="card">
      <div className="row between wrap">
        <h3>All events {events && <span className="muted small">({events.length})</span>}</h3>
        <input className="search" placeholder="Search events or customers…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && <p className="error small">{error}</p>}
      {!events && <p className="muted">Loading…</p>}
      {events?.length === 0 && <p className="muted">No events yet. Invite a customer from the Invites tab.</p>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Photos</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown?.map((e) => (
              <tr key={e.id} className={e.suspended ? "dimmed" : ""}>
                <td>
                  <strong>{e.name}</strong>
                  <div className="muted small code">{e.slug.toUpperCase()}</div>
                </td>
                <td>
                  {e.owner?.name}
                  <div className="muted small">{e.owner?.email}</div>
                </td>
                <td>{fmt(e.startsAt)}</td>
                <td>
                  {e.photoCount ?? 0}
                  {!!e.pendingCount && <span className="badge accent">{e.pendingCount} to review</span>}
                </td>
                <td>
                  {e.suspended ? (
                    <span className="badge danger">Suspended</span>
                  ) : e.uploadsOpen ? (
                    <span className="badge ok">Live</span>
                  ) : (
                    <span className="badge">Uploads closed</span>
                  )}
                </td>
                <td className="actions">
                  <a className="btn small" href={`#/events/${e.id}`}>
                    Open
                  </a>
                  <button className="btn small" onClick={() => setEditing(e)}>
                    Edit
                  </button>
                  <button className={`btn small ${e.suspended ? "" : "danger"}`} onClick={() => suspend(e)}>
                    {e.suspended ? "Restore" : "Suspend"}
                  </button>
                  <button className="btn small ghost danger" onClick={() => remove(e)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EventEditor
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

function EventEditor({ event, onClose, onSaved }: { event: HostEvent; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(event.name);
  const [location, setLocation] = useState(event.location ?? "");
  const [date, setDate] = useState(event.startsAt ? event.startsAt.slice(0, 10) : "");
  const [passcode, setPasscode] = useState("");
  const [clearPasscode, setClearPasscode] = useState(false);
  const [requireApproval, setRequireApproval] = useState(event.requireApproval);
  const [uploadsOpen, setUploadsOpen] = useState(event.uploadsOpen);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const startsAt = date ? new Date(`${date}T00:00:00`) : null;
      await api.admin.updateEvent(event.id, {
        name,
        location: location || null,
        startsAt: startsAt?.toISOString() ?? null,
        endsAt: startsAt ? new Date(startsAt.getTime() + 2 * 86_400_000).toISOString() : null,
        requireApproval,
        uploadsOpen,
        ...(passcode ? { passcode } : clearPasscode ? { passcode: null } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card" onSubmit={save} onClick={(e) => e.stopPropagation()}>
        <h2>Edit event</h2>
        <p className="muted small">
          {event.owner?.name} · {event.owner?.email} · code {event.slug.toUpperCase()}
        </p>
        <div className="form-grid">
          <label className="span-2">
            Event name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Location
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={255} />
          </label>
          <label>
            {event.hasPasscode ? "New passcode" : "Guest passcode"}
            <input
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              minLength={4}
              maxLength={64}
              placeholder={event.hasPasscode ? "Leave blank to keep" : "Optional"}
              disabled={clearPasscode}
            />
          </label>
          {event.hasPasscode && (
            <label className="check">
              <input type="checkbox" checked={clearPasscode} onChange={(e) => setClearPasscode(e.target.checked)} />
              <span>Remove passcode</span>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={uploadsOpen} onChange={(e) => setUploadsOpen(e.target.checked)} />
            <span>
              Accept uploads<small>Turn off to stop new photos (the gallery stays viewable).</small>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
            <span>
              Approve photos before they go public<small>New photos wait in "To review".</small>
            </span>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Customers (host accounts) ────────────────────────────────────────────────

function CustomersTab() {
  const [hosts, setHosts] = useState<HostAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.admin.hosts().then(setHosts, (e) => setError(e.message)), []);
  useEffect(() => void load(), [load]);

  const update = async (h: HostAccount, patch: { disabled?: boolean; role?: "admin" | "host" }) => {
    if (patch.disabled && !confirm(`Disable ${h.email}? They'll be signed out and can't sign in until you re-enable them.`)) return;
    if (patch.role === "admin" && !confirm(`Make ${h.email} an admin? They'll be able to manage every event and customer.`)) return;
    try {
      await api.admin.updateHost(h.id, patch);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  return (
    <section className="card">
      <h3>Customer accounts</h3>
      {error && <p className="error small">{error}</p>}
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
                  {h.disabled && <span className="badge danger">Disabled</span>}
                </td>
                <td>{h.email}</td>
                <td>{h.role === "admin" ? <span className="badge accent">Admin</span> : "Customer"}</td>
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
                      <button className="btn small ghost" onClick={() => update(h, { role: h.role === "admin" ? "host" : "admin" })}>
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
  );
}

// ─── Invites ──────────────────────────────────────────────────────────────────

function InvitesTab() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState<{ link: string; name: string | null; email: string | null; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.admin.invites().then(setInvites, () => {}), []);
  useEffect(() => void load(), [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const inv = await api.admin.createInvite({ note: name.trim() || null, email: email.trim() || null, days });
      setCreated({ link: inviteLink(inv.token), name: inv.note, email: inv.email, expiresAt: inv.expiresAt });
      setCopied(false);
      setName("");
      setEmail("");
      void load();
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

  const mailto = (c: NonNullable<typeof created>) => {
    const subject = "Your SnapShare event invite";
    const body = [
      `Hi${c.name ? ` ${c.name}` : ""},`,
      "",
      "You're invited to set up your event on SnapShare. Your guests scan a QR code, take photos, and they appear live in your gallery and on the big screen.",
      "",
      `Create your account here (the link works once and expires ${fmt(c.expiresAt)}):`,
      c.link,
      "",
      "Thanks!",
    ].join("\n");
    return `mailto:${encodeURIComponent(c.email ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <>
      <section className="card team-invite">
        <h3>Invite a customer</h3>
        <p className="muted small">They'll create an account with this email and can set up one event.</p>
        <form className="invite-form" onSubmit={create}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" maxLength={120} />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Customer email" maxLength={255} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Link valid for">
            <option value={1}>Valid 1 day</option>
            <option value={7}>Valid 7 days</option>
            <option value={30}>Valid 30 days</option>
          </select>
          <button className="btn primary" disabled={busy}>
            {busy ? "Creating…" : "Create invite"}
          </button>
        </form>
        {error && <p className="error small">{error}</p>}

        {created && (
          <div className="invite-created">
            <p className="small">
              Invite for <strong>{created.name ?? created.email ?? "a new customer"}</strong>
              {created.email && <> — only {created.email} can use it</>}. It works once, and this is the only time the link
              is shown.
            </p>
            <div className="row">
              <input readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn small" onClick={copy}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <a className="btn small primary" href={mailto(created)}>
                Email invite
              </a>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Pending invites</h3>
        {invites.length === 0 && <p className="muted small">No pending invites.</p>}
        <ul className="invite-list">
          {invites.map((i) => (
            <li key={i.id}>
              <span>
                {i.note ?? "Unnamed invite"} {i.email && <span className="muted small">· {i.email}</span>}
              </span>
              <span className="muted small">expires {fmt(i.expiresAt)}</span>
              <button
                className="btn link small"
                onClick={async () => {
                  await api.admin.revokeInvite(i.id).catch(() => {});
                  void load();
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
