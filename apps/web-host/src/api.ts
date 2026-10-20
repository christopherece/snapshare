import type { PageResponse, PhotoDTO } from "@snapshare/shared";

/** In dev the dashboard runs on :5174 and the API on :3000 of the same machine. */
export const API_URL =
  new URLSearchParams(location.search).get("api") ??
  (location.port === "5174" ? `${location.protocol}//${location.hostname}:3000` : location.origin);

export interface HostEvent {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  requireApproval: boolean;
  uploadsOpen: boolean;
  hasPasscode: boolean;
  displayKey: string;
  joinUrl: string;
  slideshowUrl: string;
  createdAt: string;
  photoCount?: number;
  pendingCount?: number;
  favoriteCount?: number;
  hiddenCount?: number;
}

export interface EventInput {
  name?: string;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  passcode?: string | null;
  requireApproval?: boolean;
  uploadsOpen?: boolean;
}

export type PhotoFilter = "all" | "pending" | "favorites" | "hidden";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "admin" | "host";
}

export interface AuthConfig {
  registration: "invite" | "open";
  setupRequired: boolean;
}

export interface HostAccount {
  id: string;
  name: string;
  email: string;
  role: "admin" | "host";
  disabled: boolean;
  isMe: boolean;
  eventCount: number;
  createdAt: string;
}

export interface Invite {
  id: string;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  token?: string;
}

const TOKEN_KEY = "snapshare.hostToken";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

async function raw(path: string, init: RequestInit = {}) {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      ...(init.body && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  });
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await raw(path, init);
  return (res.status === 204 ? null : await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    json<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string, invite?: string | null) =>
    json<{ token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, ...(invite && { invite }) }),
    }),
  authConfig: () => json<AuthConfig>("/auth/config"),
  me: () => json<Me>("/auth/me"),

  admin: {
    hosts: () => json<HostAccount[]>("/admin/hosts"),
    updateHost: (id: string, patch: { disabled?: boolean; role?: "admin" | "host" }) =>
      json<{ id: string; role: string; disabled: boolean }>(`/admin/hosts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    invites: () => json<Invite[]>("/admin/invites"),
    createInvite: (note: string | null, days: number) =>
      json<Invite & { token: string }>("/admin/invites", { method: "POST", body: JSON.stringify({ note, days }) }),
    revokeInvite: (id: string) => json<null>(`/admin/invites/${id}`, { method: "DELETE" }),
  },

  events: () => json<HostEvent[]>("/host/events"),
  event: (id: string) => json<HostEvent>(`/host/events/${id}`),
  createEvent: (input: EventInput) => json<HostEvent>("/host/events", { method: "POST", body: JSON.stringify(input) }),
  updateEvent: (id: string, input: EventInput) =>
    json<HostEvent>(`/host/events/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

  qrSvg: async (id: string) => (await raw(`/host/events/${id}/qr.svg`)).text(),
  flyerHtml: async (id: string) => (await raw(`/host/events/${id}/flyer`)).text(),

  photos: (eventId: string, filter: PhotoFilter, cursor?: string | null) =>
    json<PageResponse<PhotoDTO>>(
      `/events/${eventId}/photos?limit=60&filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  moderate: (photoId: string, patch: { moderation?: PhotoDTO["moderation"]; isFavorite?: boolean }) =>
    json<PhotoDTO>(`/host/photos/${photoId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePhoto: (photoId: string) => json<null>(`/host/photos/${photoId}`, { method: "DELETE" }),

  downloadUrl: async (eventId: string, filter: "all" | "favorites") => {
    const { path } = await json<{ path: string }>(`/host/events/${eventId}/download-link?filter=${filter}`, {
      method: "POST",
    });
    return API_URL + path;
  },
};

export const wsUrl = (eventId: string, token: string) =>
  `${API_URL.replace(/^http/, "ws")}/ws?eventId=${eventId}&auth=${encodeURIComponent(token)}`;
