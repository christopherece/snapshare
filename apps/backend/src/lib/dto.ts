import type { EventPublicDTO, PhotoDTO } from "@snapshare/shared";
import type { Event, Photo } from "../db/schema.ts";
import { hiddenKey, presignDownload, publicUrl } from "./storage.ts";

/** Approved renditions are on the CDN; pending/hidden ones (host-only) get short-lived signed links. */
function renditionUrl(p: Photo, key: string | null) {
  if (!key) return "";
  return p.moderation === "approved" ? publicUrl(key) : presignDownload(hiddenKey(key), 6 * 3600);
}

export function toPhotoDTO(p: Photo, guestName: string | null, likedByMe?: boolean): PhotoDTO {
  return {
    id: p.id,
    eventId: p.eventId,
    guestName,
    thumbUrl: renditionUrl(p, p.thumbKey),
    displayUrl: renditionUrl(p, p.displayKey),
    width: p.width,
    height: p.height,
    takenAt: p.takenAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    moderation: p.moderation,
    isFavorite: p.isFavorite,
    likeCount: p.likeCount,
    likedByMe,
  };
}

export function toEventPublicDTO(e: Event): EventPublicDTO {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    location: e.location,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    requiresPasscode: e.passcodeHash !== null,
    coverUrl: e.coverKey ? publicUrl(e.coverKey) : null,
  };
}

/** Opaque keyset cursor: "<createdAt ISO>|<id>" base64url-encoded. */
export const cursor = {
  encode: (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url"),
  decode: (raw: string | undefined) => {
    if (!raw) return null;
    const [iso, id] = Buffer.from(raw, "base64url").toString().split("|");
    const createdAt = new Date(iso ?? "");
    return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
  },
};
