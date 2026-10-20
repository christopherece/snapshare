import type { EventPublicDTO, PhotoDTO } from "@snapshare/shared";
import type { Event, Photo } from "../db/schema.ts";
import { publicUrl } from "./storage.ts";

export function toPhotoDTO(p: Photo, guestName: string | null, likedByMe?: boolean): PhotoDTO {
  return {
    id: p.id,
    eventId: p.eventId,
    guestName,
    thumbUrl: p.thumbKey ? publicUrl(p.thumbKey) : "",
    displayUrl: p.displayKey ? publicUrl(p.displayKey) : "",
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
