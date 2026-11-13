import type {
  CommentDTO,
  EventPublicDTO,
  JoinEventResponse,
  PageResponse,
  PhotoDTO,
  ReportReason,
  UploadUrlResponse,
} from "@snapshare/shared";
import { useSession } from "../store/session";
import { ApiError, http } from "./http";

export { ApiError };

/** Guest calls carry the opaque guest token for the event they joined. */
const guest = (token?: string | null): Record<string, string> => {
  const t = token ?? useSession.getState().guestToken;
  return t ? { "X-Guest-Token": t } : {};
};

export const api = {
  getEvent: (slug: string) => http<EventPublicDTO>(`/e/${encodeURIComponent(slug)}`),

  join: (slug: string, input: { deviceId: string; displayName?: string | null; passcode?: string | null }) =>
    http<JoinEventResponse>(`/e/${encodeURIComponent(slug)}/join`, { method: "POST", body: input }),

  // Upload calls take an explicit token: queued photos belong to the event they
  // were taken at, even if the guest has since switched events.
  getUploadUrl: (token: string, eventId: string, clientId: string, contentType = "image/jpeg") =>
    http<UploadUrlResponse>(
      `/events/${eventId}/upload-url?clientId=${encodeURIComponent(clientId)}&contentType=${encodeURIComponent(contentType)}`,
      { headers: guest(token) },
    ),

  completeUpload: (token: string, photoId: string) =>
    http<{ photoId: string; status: string }>(`/photos/${photoId}/complete`, { method: "POST", headers: guest(token) }),

  getPhotos: (eventId: string, cursor?: string | null) =>
    http<PageResponse<PhotoDTO>>(`/events/${eventId}/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: guest(),
    }),

  setLike: (photoId: string, liked: boolean) =>
    http<{ liked: boolean; likeCount: number }>(`/photos/${photoId}/like`, {
      method: liked ? "PUT" : "DELETE",
      headers: guest(),
    }),

  getComments: (photoId: string) => http<CommentDTO[]>(`/photos/${photoId}/comments`, { headers: guest() }),

  addComment: (photoId: string, body: string) =>
    http<CommentDTO>(`/photos/${photoId}/comments`, { method: "POST", body: { body }, headers: guest() }),

  /** Only the host sees reports; the guest's name isn't attached. */
  reportPhoto: (photoId: string, reason: ReportReason) =>
    http<{ reported: boolean }>(`/photos/${photoId}/report`, { method: "POST", body: { reason }, headers: guest() }),
};
