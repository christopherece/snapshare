import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "hono/jwt";
import { db, schema } from "../db/client.ts";
import type { Event, Guest, Host } from "../db/schema.ts";
import { env } from "../env.ts";

export type AppEnv = {
  Variables: {
    hostId: string;
    host: Host;
    guest: Guest;
  };
};

const HOST_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

// ─── Tokens ─────────────────────────────────────────────────────────────────

export function randomToken(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export function hashToken(token: string) {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export function signHostToken(hostId: string) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: hostId, iat: now, exp: now + HOST_TOKEN_TTL }, env.JWT_SECRET, "HS256");
}

async function verifyHostToken(token: string): Promise<{ hostId: string; issuedAt: number } | null> {
  try {
    const payload = await verify(token, env.JWT_SECRET, "HS256");
    if (typeof payload.sub !== "string") return null;
    return { hostId: payload.sub, issuedAt: typeof payload.iat === "number" ? payload.iat : 0 };
  } catch {
    return null;
  }
}

/** Ends every existing session for a host (password changed/reset); sign a new token afterwards to stay signed in. */
export async function revokeHostSessions(hostId: string) {
  // Whole seconds, so a token signed right after this (same second) still counts as valid.
  const at = new Date(Math.floor(Date.now() / 1000) * 1000);
  await db.update(schema.hosts).set({ sessionsValidAfter: at }).where(eq(schema.hosts.id, hostId));
}

async function findGuestByToken(token: string) {
  const guest = await db.query.guests.findFirst({
    where: eq(schema.guests.tokenHash, hashToken(token)),
  });
  return guest && !guest.isBlocked ? guest : null;
}

function bearer(c: Context) {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/** Host dashboard routes: `Authorization: Bearer <jwt>`. Checks the account still exists and isn't disabled. */
export const requireHost: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c);
  const claims = token ? await verifyHostToken(token) : null;
  const host = claims ? await findActiveHost(claims.hostId, claims.issuedAt) : null;
  if (!host) throw new HTTPException(401, { message: "Host authentication required" });
  c.set("hostId", host.id);
  c.set("host", host);
  await next();
};

/** Use after requireHost. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("host").role !== "admin") throw new HTTPException(403, { message: "Admins only" });
  await next();
};

async function findActiveHost(id: string, tokenIssuedAt: number) {
  const host = await db.query.hosts.findFirst({ where: eq(schema.hosts.id, id) });
  if (!host || host.disabledAt) return null;
  if (host.sessionsValidAfter && tokenIssuedAt < host.sessionsValidAfter.getTime() / 1000) return null;
  return host;
}

/** Guest routes: `X-Guest-Token: <opaque token>` issued by POST /api/e/:slug/join. */
export const requireGuest: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header("x-guest-token");
  const guest = token ? await findGuestByToken(token) : null;
  if (!guest) throw new HTTPException(401, { message: "Guest session required" });
  c.set("guest", guest);
  await next();
};

/**
 * The event if this host may manage it: admins can manage every event, hosts only their own —
 * and not while an admin has it suspended.
 */
export async function assertCanManageEvent(host: Host, eventId: string): Promise<Event> {
  const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
  if (!event || (host.role !== "admin" && event.hostId !== host.id)) {
    throw new HTTPException(404, { message: "Event not found" });
  }
  if (event.suspendedAt && host.role !== "admin") {
    throw new HTTPException(403, { message: "This event has been suspended. Please contact the organiser." });
  }
  return event;
}

/** Guests, displays and joins are refused while an event is suspended. */
export function assertEventLive(event: Event) {
  if (event.suspendedAt) throw new HTTPException(410, { message: "This event is no longer available" });
}

export type Viewer =
  | { role: "host"; hostId: string }
  | { role: "guest"; guest: Guest }
  | { role: "display" };

/**
 * Resolve who is looking at an event's photos — used by the feed endpoint
 * and the WebSocket upgrade, which accept any of the three credential types.
 */
export async function resolveViewer(
  event: Event,
  creds: { bearer?: string | null; guestToken?: string | null; displayKey?: string | null },
): Promise<Viewer | null> {
  if (creds.bearer) {
    const claims = await verifyHostToken(creds.bearer);
    const host = claims ? await findActiveHost(claims.hostId, claims.issuedAt) : null;
    if (host && (host.role === "admin" || (host.id === event.hostId && !event.suspendedAt))) {
      return { role: "host", hostId: host.id };
    }
  }
  // Everyone else is shut out of a suspended event.
  if (event.suspendedAt) return null;
  if (creds.guestToken) {
    const guest = await findGuestByToken(creds.guestToken);
    if (guest && guest.eventId === event.id) return { role: "guest", guest };
  }
  if (creds.displayKey && safeEqual(creds.displayKey, event.displayKey)) {
    return { role: "display" };
  }
  return null;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
