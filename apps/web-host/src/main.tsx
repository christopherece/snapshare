import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Me, api, setUnauthorizedHandler, tokenStore } from "./api";
import { EventList } from "./EventList";
import { EventPage } from "./EventPage";
import { Login } from "./Login";
import { Team } from "./Team";
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

  const page =
    route.page === "event" ? (
      <EventPage key={route.id} eventId={route.id} token={token} />
    ) : route.page === "team" && me?.role === "admin" ? (
      <Team />
    ) : (
      <EventList />
    );

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand">
          SnapShare <span>Host</span>
        </a>
        <nav className="row">
          <a href="#/" className={`nav-link ${route.page === "events" || route.page === "event" ? "active" : ""}`}>
            Events
          </a>
          {me?.role === "admin" && (
            <a href="#/team" className={`nav-link ${route.page === "team" ? "active" : ""}`}>
              Team
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
