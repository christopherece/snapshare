import { and, asc, count, desc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import { type AppEnv, hashToken, randomToken, requireAdmin, requireHost } from "../lib/auth.ts";
import { body, notFound } from "../lib/http.ts";

const { hosts, hostInvites, events } = schema;

/** Admin-only: manage who can host events. */
export const adminRoutes = new Hono<AppEnv>()
  .use(requireHost, requireAdmin)

  // ─── Host accounts ──────────────────────────────────────────────────────

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
      .select({ id: hostInvites.id, note: hostInvites.note, expiresAt: hostInvites.expiresAt, createdAt: hostInvites.createdAt })
      .from(hostInvites)
      .where(and(isNull(hostInvites.usedAt), gt(hostInvites.expiresAt, new Date())))
      .orderBy(desc(hostInvites.createdAt));
    return c.json(rows);
  })

  /** Returns the raw invite token once; the dashboard turns it into a link. */
  .post("/invites", async (c) => {
    const input = await body(
      c,
      z.object({ note: z.string().trim().max(120).nullish(), days: z.number().int().min(1).max(30).default(7) }),
    );
    const token = randomToken(24);
    const [invite] = await db
      .insert(hostInvites)
      .values({
        tokenHash: hashToken(token),
        note: input.note || null,
        createdBy: c.get("hostId"),
        expiresAt: new Date(Date.now() + input.days * 86_400_000),
      })
      .returning({ id: hostInvites.id, note: hostInvites.note, expiresAt: hostInvites.expiresAt, createdAt: hostInvites.createdAt });
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
