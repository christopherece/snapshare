import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { setUnauthorizedHandler, tokenStore } from "./api";
import { EventList } from "./EventList";
import { EventPage } from "./EventPage";
import { Login } from "./Login";
import { navigate, useRoute } from "./router";

function App() {
  const [token, setToken] = useState(tokenStore.get());
  const route = useRoute();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.set(null);
      setToken(null);
    });
  }, []);

  if (!token) {
    return (
      <Login
        onAuthed={(t) => {
          tokenStore.set(t);
          setToken(t);
        }}
      />
    );
  }

  const signOut = () => {
    tokenStore.set(null);
    setToken(null);
    navigate("/");
  };

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="brand">
          SnapShare <span>Host</span>
        </a>
        <button className="btn ghost small" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main className="content">
        {route.page === "event" ? <EventPage key={route.id} eventId={route.id} token={token} /> : <EventList />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
