import type { ModerationStatus, PageResponse, PhotoDTO } from "@snapshare/shared";
import { useHostAuth } from "../store/host";
import { API_URL } from "./config";
import { ApiError, http } from "./http";

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
  suspended: boolean;
  /** When the gallery is deleted (end of the plan's gallery period); null = kept forever. */
  keepUntil: string | null;
  photoCount?: number;
  pendingCount?: number;
  favoriteCount?: number;
  hiddenCount?: number;
  reportedCount?: number;
  /** Present when an admin opens another account's event. */
  owner?: { id: string; name: string; email: string };
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

export type PhotoFilter = "all" | "pending" | "favorites" | "hidden" | "reported";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "admin" | "host";
  /** Max events this account may create; null = unlimited (admins). */
  eventLimit: number | null;
}

export interface InviteInfo {
  note: string | null;
  email: string | null;
  expiresAt: string;
}

export interface AuthConfig {
  registration: "invite" | "open";
  setupRequired: boolean;
}

type Options = Parameters<typeof http>[1];

/** Host calls carry the account JWT; an expired or revoked one signs the app out. */
async function authed<T>(path: string, options: Options = {}): Promise<T> {
  const { token, signOut } = useHostAuth.getState();
  try {
    return await http<T>(path, {
      ...options,
      headers: { ...(token && { Authorization: `Bearer ${token}` }), ...options.headers },
    });
  } catch (err) {
    // Only if it's still the same sign-in — a slow request mustn't sign out a fresh one.
    if (err instanceof ApiError && err.status === 401 && token && useHostAuth.getState().token === token) signOut();
    throw err;
  }
}

export const hostApi = {
  authConfig: () => http<AuthConfig>("/auth/config"),
  login: (email: string, password: string) =>
    http<{ token: string }>("/auth/login", { method: "POST", body: { email, password } }),
  register: (name: string, email: string, password: string, invite?: string | null) =>
    http<{ token: string }>("/auth/register", { method: "POST", body: { name, email, password, ...(invite && { invite }) } }),
  inviteInfo: (token: string) => http<InviteInfo>(`/auth/invite/${encodeURIComponent(token)}`),

  me: () => authed<Me>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    authed<{ token: string }>("/auth/password", { method: "POST", body: { currentPassword, newPassword } }),
  /** Permanently deletes the account and all of its events and photos. */
  deleteAccount: (password: string) => authed<{ deleted: boolean }>("/auth/delete-account", { method: "POST", body: { password } }),

  events: () => authed<HostEvent[]>("/host/events"),
  event: (id: string) => authed<HostEvent>(`/host/events/${id}`),
  createEvent: (input: EventInput) => authed<HostEvent>("/host/events", { method: "POST", body: input }),
  updateEvent: (id: string, input: EventInput) => authed<HostEvent>(`/host/events/${id}`, { method: "PATCH", body: input }),

  qrSvg: (id: string) => authed<string>(`/host/events/${id}/qr.svg`, { as: "text" }),
  flyerHtml: (id: string) => authed<string>(`/host/events/${id}/flyer`, { as: "text" }),

  photos: (eventId: string, filter: PhotoFilter, cursor?: string | null) =>
    authed<PageResponse<PhotoDTO>>(
      `/events/${eventId}/photos?limit=60&filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  moderate: (photoId: string, patch: { moderation?: ModerationStatus; isFavorite?: boolean }) =>
    authed<PhotoDTO>(`/host/photos/${photoId}`, { method: "PATCH", body: patch }),
  deletePhoto: (photoId: string) => authed<null>(`/host/photos/${photoId}`, { method: "DELETE" }),

  /** A short-lived signed link to a ZIP of the originals — safe to hand to the browser. */
  downloadUrl: async (eventId: string, filter: "all" | "favorites") => {
    const { path } = await authed<{ path: string }>(`/host/events/${eventId}/download-link?filter=${filter}`, {
      method: "POST",
    });
    return API_URL + path;
  },
};

/** Query keys, in one place so screens and sockets invalidate the same things. */
export const hostKeys = {
  all: ["host"] as const,
  me: ["host", "me"] as const,
  events: ["host", "events"] as const,
  event: (id: string) => ["host", "event", id] as const,
  photos: (id: string, filter: PhotoFilter) => ["host", "photos", id, filter] as const,
  allPhotos: (id: string) => ["host", "photos", id] as const,
  qr: (id: string) => ["host", "qr", id] as const,
};
