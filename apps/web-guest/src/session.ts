import type { EventPublicDTO } from "@snapshare/shared";

/**
 * Guest identity lives in localStorage: a stable device ID (used by the backend for
 * rate limiting / re-joins) and one session per event code. Every access is guarded —
 * storage can be unavailable in private modes, in which case the guest simply re-joins.
 */

export interface GuestSession {
  event: EventPublicDTO;
  guestToken: string;
  guestName: string | null;
}

const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

let memoryDeviceId: string | null = null;

export function deviceId(): string {
  const existing = read<string>("snapshare.deviceId") ?? memoryDeviceId;
  if (existing) return existing;
  const id = crypto.randomUUID();
  memoryDeviceId = id;
  write("snapshare.deviceId", id);
  return id;
}

export const sessions = {
  get: (slug: string) => read<GuestSession>(`snapshare.session.${slug}`),
  set: (slug: string, s: GuestSession) => write(`snapshare.session.${slug}`, s),
  clear: (slug: string) => write(`snapshare.session.${slug}`, null),
  lastName: () => read<string>("snapshare.guestName"),
  rememberName: (name: string | null) => write("snapshare.guestName", name),
};
