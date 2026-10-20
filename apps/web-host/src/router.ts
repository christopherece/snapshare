import { useEffect, useState } from "react";

export type Route =
  | { page: "events" }
  | { page: "event"; id: string }
  | { page: "team" }
  | { page: "invite"; token: string };

/** Tiny hash router: #/  #/events/<id>  #/team  #/invite/<token> */
export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const event = hash.match(/^#\/events\/([\w-]+)/);
  if (event) return { page: "event", id: event[1]! };
  const invite = hash.match(/^#\/invite\/([\w-]+)/);
  if (invite) return { page: "invite", token: invite[1]! };
  if (hash.startsWith("#/team")) return { page: "team" };
  return { page: "events" };
}

export const navigate = (path: string) => (location.hash = path);

/** Shareable link that opens the dashboard's sign-up form with an invite token. */
export const inviteLink = (token: string) => `${location.origin}${location.pathname}#/invite/${token}`;
