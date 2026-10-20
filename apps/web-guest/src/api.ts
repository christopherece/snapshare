import type {
  CommentDTO,
  EventPublicDTO,
  JoinEventResponse,
  PageResponse,
  PhotoDTO,
  UploadUrlResponse,
} from "@snapshare/shared";

/** Dev: the guest app runs on :5175 and the API on :3000 of the same machine. Prod: same origin. */
export const API_URL =
  new URLSearchParams(location.search).get("api") ??
  (location.port === "5175" ? `${location.protocol}//${location.hostname}:3000` : location.origin);

export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${API_URL}/api${path}`, {
    ...rest,
    headers: {
      ...(rest.body && { "Content-Type": "application/json" }),
      ...(token && { "X-Guest-Token": token }),
      ...rest.headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? res.statusText);
  return body as T;
}

export const api = {
  getEvent: (slug: string) => request<EventPublicDTO>(`/e/${encodeURIComponent(slug)}`),

  join: (slug: string, input: { deviceId: string; displayName: string | null; passcode: string | null }) =>
    request<JoinEventResponse>(`/e/${encodeURIComponent(slug)}/join`, { method: "POST", body: JSON.stringify(input) }),

  getUploadUrl: (token: string, eventId: string, clientId: string, contentType: string) =>
    request<UploadUrlResponse>(
      `/events/${eventId}/upload-url?clientId=${encodeURIComponent(clientId)}&contentType=${encodeURIComponent(contentType)}`,
      { token },
    ),

  completeUpload: (token: string, photoId: string) =>
    request<{ photoId: string; status: string }>(`/photos/${photoId}/complete`, { method: "POST", token }),

  getPhotos: (token: string, eventId: string, cursor?: string | null) =>
    request<PageResponse<PhotoDTO>>(
      `/events/${eventId}/photos?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { token },
    ),

  setLike: (token: string, photoId: string, liked: boolean) =>
    request<{ liked: boolean; likeCount: number }>(`/photos/${photoId}/like`, { method: liked ? "PUT" : "DELETE", token }),

  getComments: (token: string, photoId: string) => request<CommentDTO[]>(`/photos/${photoId}/comments`, { token }),

  addComment: (token: string, photoId: string, body: string) =>
    request<CommentDTO>(`/photos/${photoId}/comments`, { method: "POST", body: JSON.stringify({ body }), token }),
};
