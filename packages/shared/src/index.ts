/**
 * Types shared by the backend, mobile app and slideshow.
 * Keep this file dependency-free so every runtime can import it.
 */

export type ModerationStatus = "pending" | "approved" | "hidden";

export interface PhotoDTO {
  id: string;
  eventId: string;
  guestName: string | null;
  /** Small WebP, ~400px — for grids/feeds. */
  thumbUrl: string;
  /** Large WebP, ~2048px — for full-screen viewing and the slideshow. */
  displayUrl: string;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  createdAt: string;
  moderation: ModerationStatus;
  isFavorite: boolean;
  likeCount: number;
  likedByMe?: boolean;
}

export interface EventPublicDTO {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  requiresPasscode: boolean;
  coverUrl: string | null;
}

export interface JoinEventResponse {
  event: EventPublicDTO;
  guestToken: string;
  guestId: string;
}

export interface UploadUrlResponse {
  photoId: string;
  uploadUrl: string;
  /** Headers the client MUST send with the PUT for the signature to match. */
  headers: Record<string, string>;
  expiresIn: number;
}

/** Messages pushed from the server over the WebSocket. */
export type WsServerMessage =
  | { type: "hello"; eventId: string; role: WsRole }
  | { type: "photo.added"; photo: PhotoDTO }
  | { type: "photo.updated"; photo: PhotoDTO }
  | { type: "photo.removed"; photoId: string }
  | { type: "photo.liked"; photoId: string; likeCount: number }
  | { type: "comment.added"; photoId: string; comment: CommentDTO };

export type WsRole = "guest" | "host" | "display";

export interface CommentDTO {
  id: string;
  photoId: string;
  guestName: string | null;
  body: string;
  createdAt: string;
}

export interface PageResponse<T> {
  items: T[];
  nextCursor: string | null;
}
