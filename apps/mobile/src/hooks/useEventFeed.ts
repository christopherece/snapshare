import type { PageResponse, PhotoDTO, WsServerMessage } from "@snapshare/shared";
import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { api } from "../lib/api";
import { WS_URL } from "../lib/config";

type FeedData = InfiniteData<PageResponse<PhotoDTO>, string | null>;

export const feedKey = (eventId: string) => ["feed", eventId] as const;

export function useEventFeed(eventId: string, guestToken: string) {
  const qc = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: feedKey(eventId),
    queryFn: ({ pageParam }) => api.getPhotos(eventId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  useEffect(() => {
    const patch = (fn: (items: PhotoDTO[], pageIndex: number) => PhotoDTO[]) =>
      qc.setQueryData<FeedData>(feedKey(eventId), (data) =>
        data ? { ...data, pages: data.pages.map((p, i) => ({ ...p, items: fn(p.items, i) })) } : data,
      );

    const onMessage = (msg: WsServerMessage) => {
      switch (msg.type) {
        case "photo.added":
          patch((items, i) =>
            i === 0 && !items.some((p) => p.id === msg.photo.id) ? [msg.photo, ...items] : items,
          );
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
          qc.invalidateQueries({ queryKey: ["comments", msg.photoId] });
          break;
      }
    };

    return connectEventSocket(eventId, guestToken, onMessage, () =>
      // After a reconnect we may have missed messages — refetch the first page.
      qc.invalidateQueries({ queryKey: feedKey(eventId), refetchType: "active" }),
    );
  }, [eventId, guestToken, qc]);

  const photos = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  return { ...query, photos };
}

/**
 * Resilient WebSocket: exponential backoff reconnects, and disconnects while
 * the app is backgrounded to save battery. Returns a cleanup function.
 */
function connectEventSocket(
  eventId: string,
  token: string,
  onMessage: (msg: WsServerMessage) => void,
  onReconnect: () => void,
) {
  let ws: WebSocket | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let hasConnected = false;

  const open = () => {
    if (closed || ws) return;
    // Token goes in the subprotocol header, not the URL, so it stays out of proxy logs.
    ws = new WebSocket(`${WS_URL}?eventId=${eventId}`, ["snapshare", `snapshare.guest.${token}`]);
    ws.onopen = () => {
      if (hasConnected) onReconnect();
      hasConnected = true;
      retry = 0;
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(String(e.data)));
      } catch {}
    };
    ws.onclose = () => {
      ws = null;
      if (closed || AppState.currentState !== "active") return;
      timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 30_000));
    };
  };

  const close = () => {
    if (timer) clearTimeout(timer);
    ws?.close();
    ws = null;
  };

  const sub = AppState.addEventListener("change", (s) => (s === "active" ? open() : close()));
  open();

  return () => {
    closed = true;
    sub.remove();
    close();
  };
}
