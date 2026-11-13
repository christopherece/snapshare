const DAY_MS = 86_400_000;

/** "Sat, 14 November" — for a guest's invitation. */
export const formatEventDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long" }) : null;

/** "14 Nov 2026" — for lists. */
export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;

/** "14 November 2026" — for notices. */
export const formatLongDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null;

/** Whole days from now until the given moment (negative once it has passed). */
export const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Local midnight of a calendar day — events are dated by day, not by time. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Uploads stay open until the end of the day after the event (plus the server's grace period). */
export const defaultEndsAt = (startsAt: Date) => new Date(startsAt.getTime() + 2 * DAY_MS);
