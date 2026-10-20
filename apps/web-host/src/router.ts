import { useEffect, useState } from "react";

export type Route = { page: "events" } | { page: "event"; id: string };

/** Tiny hash router: #/  and  #/events/<id> */
export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const match = hash.match(/^#\/events\/([\w-]+)/);
  return match ? { page: "event", id: match[1]! } : { page: "events" };
}

export const navigate = (path: string) => (location.hash = path);
