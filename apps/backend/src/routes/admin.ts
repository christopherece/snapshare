import { and, asc, count, desc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import { type AppEnv, hashToken, randomToken, requireAdmin, requireHost } from "../lib/auth.ts";
import { deleteEventWithPhotos, eventInput, hostEventView, photoCounts, updateEvent } from "../lib/events.ts";
import { body, notFound } from "../lib/http.ts";

const { hosts, hostInvites, events } = schema;

/** Admin-only: customers (host accounts), their events, and invites. */
export const adminRoutes = new Hono<AppEnv>()
  .use(requireHost, requireAdmin)

  // ─── All events ─────────────────────────────────────────────────────────

  .get("/events", async (c) => {
    const rows = await db
      .select({ event: events, ownerName: hosts.name, ownerEmail: hosts.email })
      .from(events)
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .orderBy(desc(events.createdAt));
    const counts = await photoCounts(rows.map((r) => r.event.id));
    return c.json(
      rows.map((r) => ({
        ...hostEventView(r.event),
        ...counts(r.event.id),
        owner: { id: r.event.hostId, name: r.ownerName, email: r.ownerEmail },
      })),
    );
  })

  /** Edit any event's details, and suspend/restore it. */
  .patch("/events/:id", async (c) => {
    const input = await body(c, eventInput.partial().extend({ suspended: z.boolean().optional() }));
    const event = await updateEvent(c.req.param("id"), input);
    if (!event) notFound("Event");
    return c.json(hostEventView(event));
  })

  /** Permanently delete an event, its guests and all of its photos (including stored files). */
  .delete("/events/:id", async (c) => {
    const event = await db.query.events.findFirst({ where: eq(events.id, c.req.param("id")) });
    if (!event) notFound("Event");
    const files = await deleteEventWithPhotos(event.id);
    return c.json({ deleted: true, filesRemoved: files });
  })

  // ─── Host accounts (customers) ──────────────────────────────────────────

  .get("/hosts", async (c) => {
    const rows = await db
      .select({
        id: hosts.id,
        name: hosts.name,
        email: hosts.email,
        role: hosts.role,
        disabledAt: hosts.disabledAt,
        createdAt: hosts.createdAt,
        eventCount: count(events.id),
      })
      .from(hosts)
      .leftJoin(events, eq(events.hostId, hosts.id))
      .groupBy(hosts.id)
      .orderBy(asc(hosts.createdAt));
    return c.json(rows.map((r) => ({ ...r, disabled: r.disabledAt !== null, isMe: r.id === c.get("hostId") })));
  })

  .patch("/hosts/:id", async (c) => {
    const input = await body(c, z.object({ disabled: z.boolean().optional(), role: z.enum(["admin", "host"]).optional() }));
    const id = c.req.param("id");
    if (id === c.get("hostId")) throw new HTTPException(400, { message: "You can't disable or demote your own account" });

    const [updated] = await db
      .update(hosts)
      .set({
        ...(input.role && { role: input.role }),
        ...(input.disabled !== undefined && { disabledAt: input.disabled ? new Date() : null }),
      })
      .where(eq(hosts.id, id))
      .returning({ id: hosts.id, role: hosts.role, disabledAt: hosts.disabledAt });
    if (!updated) notFound("Host");
    return c.json({ ...updated, disabled: updated.disabledAt !== null });
  })

  // ─── Invites ────────────────────────────────────────────────────────────

  /** Pending invites (unused and not expired). Links themselves can't be shown again — only at creation. */
  .get("/invites", async (c) => {
    const rows = await db
      .select({
        id: hostInvites.id,
        note: hostInvites.note,
        email: hostInvites.email,
        expiresAt: hostInvites.expiresAt,
        createdAt: hostInvites.createdAt,
      })
      .from(hostInvites)
      .where(and(isNull(hostInvites.usedAt), gt(hostInvites.expiresAt, new Date())))
      .orderBy(desc(hostInvites.createdAt));
    return c.json(rows);
  })

  /** Returns the raw invite token once; the dashboard turns it into a link. */
  .post("/invites", async (c) => {
    const input = await body(
      c,
      z.object({
        note: z.string().trim().max(120).nullish(),
        email: z
          .string()
          .trim()
          .toLowerCase()
          .email()
          .max(255)
          .nullish()
          .or(z.literal("").transform(() => null)),
        days: z.number().int().min(1).max(30).default(7),
      }),
    );
    if (input.email) {
      const taken = await db.query.hosts.findFirst({ where: eq(hosts.email, input.email), columns: { id: true } });
      if (taken) throw new HTTPException(409, { message: "There's already an account with that email" });
    }
    const token = randomToken(24);
    const [invite] = await db
      .insert(hostInvites)
      .values({
        tokenHash: hashToken(token),
        note: input.note || null,
        email: input.email || null,
        createdBy: c.get("hostId"),
        expiresAt: new Date(Date.now() + input.days * 86_400_000),
      })
      .returning({
        id: hostInvites.id,
        note: hostInvites.note,
        email: hostInvites.email,
        expiresAt: hostInvites.expiresAt,
        createdAt: hostInvites.createdAt,
      });
    return c.json({ ...invite!, token }, 201);
  })

  .delete("/invites/:id", async (c) => {
    const [deleted] = await db
      .delete(hostInvites)
      .where(and(eq(hostInvites.id, c.req.param("id")), isNull(hostInvites.usedAt)))
      .returning({ id: hostInvites.id });
    if (!deleted) notFound("Invite");
    return c.body(null, 204);
  });
