import type { PageResponse, PhotoDTO, WsServerMessage } from "@snapshare/shared";
import { type InfiniteData, type QueryClient, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ApiError, api } from "../lib/api";
import { connectEventSocket } from "../lib/socket";

export type FeedData = InfiniteData<PageResponse<PhotoDTO>, string | null>;

export const feedKey = (eventId: string) => ["feed", eventId] as const;

/** Apply a change to every loaded page of the guest feed. */
export function patchFeed(qc: QueryClient, eventId: string, fn: (items: PhotoDTO[], pageIndex: number) => PhotoDTO[]) {
  qc.setQueryData<FeedData>(feedKey(eventId), (data) =>
    data ? { ...data, pages: data.pages.map((p, i) => ({ ...p, items: fn(p.items, i) })) } : data,
  );
}

/** The guest's session no longer works for this event (ended, removed, or the event was taken down). */
export const isSessionEnded = (err: unknown) => err instanceof ApiError && [401, 403, 404, 410].includes(err.status);

/** The event's live gallery: paged history plus real-time updates over the WebSocket. */
export function useEventFeed(eventId: string, guestToken: string) {
  const qc = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: feedKey(eventId),
    queryFn: ({ pageParam }) => api.getPhotos(eventId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: (failures, err) => !isSessionEnded(err) && failures < 2,
  });

  useEffect(() => {
    const patch = (fn: (items: PhotoDTO[], pageIndex: number) => PhotoDTO[]) => patchFeed(qc, eventId, fn);

    const onMessage = (msg: WsServerMessage) => {
      switch (msg.type) {
        case "photo.added":
          patch((items, i) => (i === 0 && !items.some((p) => p.id === msg.photo.id) ? [msg.photo, ...items] : items));
          break;
        case "photo.updated":
          patch((items) => items.map((p) => (p.id === msg.photo.id ? { ...msg.photo, likedByMe: p.likedByMe } : p)));
          break;
        case "photo.removed":
          patch((items) => items.filter((p) => p.id !== msg.photoId));
          break;
        case "photo.liked":
          patch((items) => items.map((p) => (p.id === msg.photoId ? { ...p, likeCount: msg.likeCount } : p)));
          break;
        case "comment.added":
          void qc.invalidateQueries({ queryKey: ["comments", msg.photoId] });
          break;
      }
    };

    return connectEventSocket({
      eventId,
      role: "guest",
      token: guestToken,
      onMessage,
      // After a reconnect we may have missed messages — refetch what's on screen.
      onReconnect: () => void qc.invalidateQueries({ queryKey: feedKey(eventId), refetchType: "active" }),
    });
  }, [eventId, guestToken, qc]);

  const photos = useMemo(() => {
    // A photo can arrive over the socket and again in a later page; show it once.
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !seen.has(p.id) && seen.add(p.id));
  }, [query.data]);

  return { ...query, photos };
}
