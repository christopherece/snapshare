import { useEffect, useState } from "react";

export type AdminTab = "events" | "customers" | "invites";

export type Route =
  | { page: "events" }
  | { page: "event"; id: string }
  | { page: "admin"; tab: AdminTab }
  | { page: "invite"; token: string };

/** Tiny hash router: #/  #/events/<id>  #/admin/<tab>  #/invite/<token> */
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
  const admin = hash.match(/^#\/(?:admin|team)(?:\/(\w+))?/);
  if (admin) {
    const tab = admin[1] === "customers" || admin[1] === "invites" ? admin[1] : "events";
    return { page: "admin", tab };
  }
  return { page: "events" };
}

export const navigate = (path: string) => (location.hash = path);

/** Shareable link that opens the dashboard's sign-up form with an invite token. */
export const inviteLink = (token: string) => `${location.origin}${location.pathname}#/invite/${token}`;
