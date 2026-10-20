import type { PhotoDTO, WsRole, WsServerMessage } from "@snapshare/shared";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { resolveViewer } from "../lib/auth.ts";

/**
 * Real-time fan-out using Bun's built-in pub/sub.
 *
 * Every event has two topics:
 *   event:{id}:public  approved photos only — guests & slideshow displays
 *   event:{id}:host    everything, including pending/hidden — host dashboard
 *
 * NOTE: Bun pub/sub is per-process. To scale horizontally, bridge publish()
 * through Redis/Postgres LISTEN-NOTIFY.
 */

export interface WsData {
  eventId: string;
  role: WsRole;
}

const topics = {
  public: (eventId: string) => `event:${eventId}:public`,
  host: (eventId: string) => `event:${eventId}:host`,
};

let server: Server<WsData> | null = null;

export function attachServer(s: Server<WsData>) {
  server = s;
}

function publish(topic: string, msg: WsServerMessage) {
  server?.publish(topic, JSON.stringify(msg));
}

// ─── Broadcast helpers used by routes and the media pipeline ────────────────

export const realtime = {
  photoReady(photo: PhotoDTO) {
    if (photo.moderation === "approved") publish(topics.public(photo.eventId), { type: "photo.added", photo });
    publish(topics.host(photo.eventId), { type: "photo.added", photo });
  },

  photoModerated(photo: PhotoDTO, previous: PhotoDTO["moderation"]) {
    const pub = topics.public(photo.eventId);
    if (photo.moderation === "approved" && previous !== "approved") publish(pub, { type: "photo.added", photo });
    else if (photo.moderation !== "approved" && previous === "approved") publish(pub, { type: "photo.removed", photoId: photo.id });
    else if (photo.moderation === "approved") publish(pub, { type: "photo.updated", photo });
    publish(topics.host(photo.eventId), { type: "photo.updated", photo });
  },

  photoRemoved(eventId: string, photoId: string) {
    publish(topics.public(eventId), { type: "photo.removed", photoId });
    publish(topics.host(eventId), { type: "photo.removed", photoId });
  },

  photoLiked(eventId: string, photoId: string, likeCount: number) {
    const msg: WsServerMessage = { type: "photo.liked", photoId, likeCount };
    publish(topics.public(eventId), msg);
    publish(topics.host(eventId), msg);
  },

  broadcastPublic(eventId: string, msg: WsServerMessage) {
    publish(topics.public(eventId), msg);
    publish(topics.host(eventId), msg);
  },
};

// ─── Upgrade + socket handlers ──────────────────────────────────────────────

/**
 * GET /ws?eventId=…&token=<guest token>|&key=<display key>|&auth=<host jwt>
 * Browsers can't set headers on WebSocket requests, so creds go in the query.
 */
export async function handleUpgrade(req: Request, srv: Server<WsData>): Promise<Response | undefined> {
  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");
  if (!eventId) return new Response("eventId required", { status: 400 });

  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event) return new Response("Not found", { status: 404 });

  const viewer = await resolveViewer(event, {
    bearer: url.searchParams.get("auth"),
    guestToken: url.searchParams.get("token"),
    displayKey: url.searchParams.get("key"),
  });
  if (!viewer) return new Response("Unauthorized", { status: 401 });

  const ok = srv.upgrade(req, { data: { eventId, role: viewer.role } });
  return ok ? undefined : new Response("Upgrade failed", { status: 400 });
}

export const websocketHandlers: WebSocketHandler<WsData> = {
  idleTimeout: 120,
  sendPings: true,
  open(ws: ServerWebSocket<WsData>) {
    const { eventId, role } = ws.data;
    ws.subscribe(role === "host" ? topics.host(eventId) : topics.public(eventId));
    ws.send(JSON.stringify({ type: "hello", eventId, role } satisfies WsServerMessage));
  },
  message() {
    // Server → client only. Mutations go through REST so they're authenticated & rate limited.
  },
};
