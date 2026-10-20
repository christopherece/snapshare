import type {
  CommentDTO,
  EventPublicDTO,
  JoinEventResponse,
  PageResponse,
  PhotoDTO,
  UploadUrlResponse,
} from "@snapshare/shared";
import { useSession } from "../store/session";
import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { guestToken } = useSession.getState();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(guestToken && { "X-Guest-Token": guestToken }),
      ...init.headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string })?.error ?? res.statusText, body);
  return body as T;
}

export const api = {
  getEvent: (slug: string) => request<EventPublicDTO>(`/e/${encodeURIComponent(slug)}`),

  join: (slug: string, input: { deviceId: string; displayName?: string | null; passcode?: string | null }) =>
    request<JoinEventResponse>(`/e/${encodeURIComponent(slug)}/join`, { method: "POST", body: JSON.stringify(input) }),

  // Upload calls take an explicit token: queued photos belong to the event they
  // were taken at, even if the guest has since switched events.
  getUploadUrl: (token: string, eventId: string, clientId: string, contentType = "image/jpeg") =>
    request<UploadUrlResponse>(
      `/events/${eventId}/upload-url?clientId=${encodeURIComponent(clientId)}&contentType=${encodeURIComponent(contentType)}`,
      { headers: { "X-Guest-Token": token } },
    ),

  completeUpload: (token: string, photoId: string) =>
    request<{ photoId: string; status: string }>(`/photos/${photoId}/complete`, {
      method: "POST",
      headers: { "X-Guest-Token": token },
    }),

  getPhotos: (eventId: string, cursor?: string | null) =>
    request<PageResponse<PhotoDTO>>(`/events/${eventId}/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),

  setLike: (photoId: string, liked: boolean) =>
    request<{ liked: boolean; likeCount: number }>(`/photos/${photoId}/like`, { method: liked ? "PUT" : "DELETE" }),

  getComments: (photoId: string) => request<CommentDTO[]>(`/photos/${photoId}/comments`),

  addComment: (photoId: string, body: string) =>
    request<CommentDTO>(`/photos/${photoId}/comments`, { method: "POST", body: JSON.stringify({ body }) }),
};
