import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Admin } from "./Admin";
import { type Me, api, setUnauthorizedHandler, tokenStore } from "./api";
import { EventList } from "./EventList";
import { EventPage } from "./EventPage";
import { Login } from "./Login";
import { navigate, useRoute } from "./router";

function App() {
  const [token, setToken] = useState(tokenStore.get());
  const [me, setMe] = useState<Me | null>(null);
  const route = useRoute();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.set(null);
      setToken(null);
    });
  }, []);

  useEffect(() => {
    setMe(null);
    if (token) api.me().then(setMe, () => {});
  }, [token]);

  if (!token) {
    return (
      <Login
        inviteToken={route.page === "invite" ? route.token : null}
        onAuthed={(t) => {
          tokenStore.set(t);
          setToken(t);
          if (route.page === "invite") navigate("/");
        }}
      />
    );
  }

  const signOut = () => {
    tokenStore.set(null);
    setToken(null);
    navigate("/");
  };

  const isAdmin = me?.role === "admin";
  const page =
    route.page === "event" ? (
      <EventPage key={route.id} eventId={route.id} token={token} me={me} />
    ) : !me ? (
      <p className="muted">Loading…</p>
    ) : route.page === "admin" && isAdmin ? (
      <Admin tab={route.tab} />
    ) : (
      <EventList me={me} />
    );

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand">
          SnapShare <span>Host</span>
        </a>
        <nav className="row">
          <a href="#/" className={`nav-link ${route.page === "events" || route.page === "event" ? "active" : ""}`}>
            {isAdmin ? "My events" : "My event"}
          </a>
          {isAdmin && (
            <a href="#/admin" className={`nav-link ${route.page === "admin" ? "active" : ""}`}>
              Admin
            </a>
          )}
          <button className="btn ghost small" onClick={signOut} title={me ? `Signed in as ${me.email}` : undefined}>
            Sign out
          </button>
        </nav>
      </header>
      <main className="content">{page}</main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
