import type { PageResponse, PhotoDTO, WsServerMessage } from "@snapshare/shared";
import { type InfiniteData, type QueryClient, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { hostApi, hostKeys, type PhotoFilter } from "../lib/host-api";
import { connectEventSocket } from "../lib/socket";
import { useHostAuth } from "../store/host";

type HostFeed = InfiniteData<PageResponse<PhotoDTO>, string | null>;

export type ModerationAction = "approve" | "hide" | "favorite" | "delete";

/** Does a photo belong in the given view of the host gallery? */
export const matchesFilter = (p: PhotoDTO, f: PhotoFilter) =>
  f === "all" || (f === "favorites" ? p.isFavorite : f === "reported" ? (p.reportCount ?? 0) > 0 : p.moderation === f);

function patchGallery(qc: QueryClient, eventId: string, filter: PhotoFilter, fn: (items: PhotoDTO[], pageIndex: number) => PhotoDTO[]) {
  qc.setQueryData<HostFeed>(hostKeys.photos(eventId, filter), (data) =>
    data ? { ...data, pages: data.pages.map((p, i) => ({ ...p, items: fn(p.items, i) })) } : data,
  );
}

/**
 * The host's view of an event's photos — including ones waiting for review, hidden or reported — kept
 * live over the host WebSocket channel, plus the moderation actions.
 */
export function useHostGallery(eventId: string, filter: PhotoFilter, onReport: (message: string) => void) {
  const qc = useQueryClient();
  const token = useHostAuth((s) => s.token);

  const query = useInfiniteQuery({
    queryKey: hostKeys.photos(eventId, filter),
    queryFn: ({ pageParam }) => hostApi.photos(eventId, filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Only the view on screen is patched live, so always refresh a view when coming back to it.
    staleTime: 0,
  });

  // One socket for the event; it patches whichever view is showing.
  const live = useRef({ filter, onReport });
  live.current = { filter, onReport };

  // The counts on the filter chips come from the event itself. A burst of uploads → one refresh.
  const countsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpCounts = useCallback(() => {
    if (countsTimer.current) clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: hostKeys.event(eventId) });
      void qc.invalidateQueries({ queryKey: hostKeys.events });
    }, 600);
  }, [qc, eventId]);
  useEffect(() => () => void (countsTimer.current && clearTimeout(countsTimer.current)), []);

  useEffect(() => {
    if (!token) return;
    const patch = (fn: (items: PhotoDTO[], pageIndex: number) => PhotoDTO[]) => patchGallery(qc, eventId, live.current.filter, fn);

    const onMessage = (msg: WsServerMessage) => {
      const f = live.current.filter;
      switch (msg.type) {
        case "photo.added":
          if (matchesFilter(msg.photo, f)) {
            patch((items, i) => (i === 0 && !items.some((p) => p.id === msg.photo.id) ? [msg.photo, ...items] : items));
          }
          bumpCounts();
          break;
        case "photo.updated":
          // Broadcast updates don't carry reports (guests share that channel), so keep the count we have.
          patch((items) =>
            items
              .map((p) => (p.id === msg.photo.id ? { ...msg.photo, reportCount: msg.photo.reportCount ?? p.reportCount } : p))
              .filter((p) => p.id !== msg.photo.id || matchesFilter(p, f)),
          );
          bumpCounts();
          break;
        case "photo.reported":
          patch((items) => items.map((p) => (p.id === msg.photoId ? { ...p, reportCount: msg.reportCount } : p)));
          live.current.onReport(msg.autoHidden ? "A photo was hidden after several guests reported it." : "A guest reported a photo.");
          bumpCounts();
          break;
        case "photo.removed":
          patch((items) => items.filter((p) => p.id !== msg.photoId));
          bumpCounts();
          break;
        case "photo.liked":
          patch((items) => items.map((p) => (p.id === msg.photoId ? { ...p, likeCount: msg.likeCount } : p)));
          break;
      }
    };

    return connectEventSocket({
      eventId,
      role: "host",
      token,
      onMessage,
      onReconnect: () => {
        void qc.invalidateQueries({ queryKey: hostKeys.allPhotos(eventId), refetchType: "active" });
        bumpCounts();
      },
    });
  }, [eventId, token, qc, bumpCounts]);

  const photos = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !seen.has(p.id) && seen.add(p.id));
  }, [query.data]);

  /** Apply a moderation action. Rejects with the server's error so the caller can show it. */
  const act = useCallback(
    async (photo: PhotoDTO, action: ModerationAction) => {
      const f = live.current.filter;
      if (action === "delete") {
        await hostApi.deletePhoto(photo.id);
        patchGallery(qc, eventId, f, (items) => items.filter((p) => p.id !== photo.id));
      } else {
        const updated = await hostApi.moderate(
          photo.id,
          action === "approve" ? { moderation: "approved" } : action === "hide" ? { moderation: "hidden" } : { isFavorite: !photo.isFavorite },
        );
        patchGallery(qc, eventId, f, (items) =>
          matchesFilter(updated, f) ? items.map((p) => (p.id === updated.id ? updated : p)) : items.filter((p) => p.id !== updated.id),
        );
      }
      bumpCounts();
    },
    [qc, eventId, bumpCounts],
  );

  return { ...query, photos, act };
}
