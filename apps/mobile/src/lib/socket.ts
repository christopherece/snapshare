import type { WsServerMessage } from "@snapshare/shared";
import { AppState } from "react-native";
import { WS_URL } from "./config";

interface SocketOptions {
  eventId: string;
  role: "guest" | "host";
  token: string;
  onMessage: (msg: WsServerMessage) => void;
  /** Called after a dropped connection comes back — messages may have been missed. */
  onReconnect: () => void;
}

/**
 * Resilient WebSocket: exponential backoff reconnects, and disconnects while
 * the app is backgrounded to save battery. Returns a cleanup function.
 */
export function connectEventSocket({ eventId, role, token, onMessage, onReconnect }: SocketOptions) {
  let ws: WebSocket | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let hasConnected = false;

  const open = () => {
    if (closed || ws) return;
    if (timer) clearTimeout(timer);
    // Token goes in the subprotocol header, not the URL, so it stays out of proxy logs.
    const socket = new WebSocket(`${WS_URL}?eventId=${encodeURIComponent(eventId)}`, ["snapshare", `snapshare.${role}.${token}`]);
    ws = socket;
    socket.onopen = () => {
      if (hasConnected) onReconnect();
      hasConnected = true;
      retry = 0;
    };
    socket.onmessage = (e) => {
      try {
        onMessage(JSON.parse(String(e.data)));
      } catch {
        // Ignore anything that isn't one of our JSON messages.
      }
    };
    socket.onclose = () => {
      if (ws !== socket) return; // superseded by a newer connection
      ws = null;
      if (closed || AppState.currentState !== "active") return;
      timer = setTimeout(open, Math.min(1000 * 2 ** retry++, 30_000));
    };
  };

  const close = () => {
    if (timer) clearTimeout(timer);
    const socket = ws;
    ws = null;
    socket?.close();
  };

  const sub = AppState.addEventListener("change", (s) => (s === "active" ? open() : close()));
  open();

  return () => {
    closed = true;
    sub.remove();
    close();
  };
}
