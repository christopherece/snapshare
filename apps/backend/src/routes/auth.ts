import { and, count, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import type { Host } from "../db/schema.ts";
import { env } from "../env.ts";
import { type AppEnv, hashToken, requireHost, signHostToken } from "../lib/auth.ts";
import { body } from "../lib/http.ts";
import { TokenBucket, clientIp, rateLimit } from "../lib/rate-limit.ts";

const authLimiter = new TokenBucket(10, 10 / 60); // 10 attempts, refills 10/min
const limited = rateLimit<AppEnv>(authLimiter, clientIp);

const credentials = z.object({
  email: z.string().email().max(255).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(200),
});

export const publicHost = (h: Host) => ({ id: h.id, name: h.name, email: h.email, role: h.role });

const hostCount = async () => (await db.select({ n: count() }).from(schema.hosts))[0]?.n ?? 0;

export const authRoutes = new Hono<AppEnv>()
  /** Tells the login page whether to offer sign-up, and whether this is a fresh install. */
  .get("/config", async (c) => c.json({ registration: env.REGISTRATION, setupRequired: (await hostCount()) === 0 }))

  /**
   * Who may register:
   *  - the very first account on a fresh install (becomes admin),
   *  - anyone with a valid, unused invite link,
   *  - anyone at all when REGISTRATION=open.
   */
  .post("/register", limited, async (c) => {
    const input = await body(
      c,
      credentials.extend({ name: z.string().trim().min(1).max(120), invite: z.string().max(200).optional() }),
    );
    const passwordHash = await Bun.password.hash(input.password);

    const host = await db.transaction(async (tx) => {
      const [{ n }] = (await tx.select({ n: count() }).from(schema.hosts)) as [{ n: number }];
      const firstAccount = n === 0;

      let inviteId: string | null = null;
      if (input.invite) {
        const [invite] = await tx
          .select({ id: schema.hostInvites.id })
          .from(schema.hostInvites)
          .where(
            and(
              eq(schema.hostInvites.tokenHash, hashToken(input.invite)),
              isNull(schema.hostInvites.usedAt),
              gt(schema.hostInvites.expiresAt, new Date()),
            ),
          )
          .for("update");
        if (!invite) throw new HTTPException(403, { message: "This invite link is invalid, used, or expired" });
        inviteId = invite.id;
      } else if (!firstAccount && env.REGISTRATION !== "open") {
        throw new HTTPException(403, { message: "Registration is invite-only. Ask the organiser for an invite link." });
      }

      const [created] = await tx
        .insert(schema.hosts)
        .values({ email: input.email, name: input.name, passwordHash, role: firstAccount ? "admin" : "host" })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new HTTPException(409, { message: "Email already registered" });

      if (inviteId) {
        await tx
          .update(schema.hostInvites)
          .set({ usedAt: new Date(), usedBy: created.id })
          .where(eq(schema.hostInvites.id, inviteId));
      }
      return created;
    });

    return c.json({ token: await signHostToken(host.id), host: publicHost(host) }, 201);
  })

  .post("/login", limited, async (c) => {
    const input = await body(c, credentials);
    const host = await db.query.hosts.findFirst({ where: eq(schema.hosts.email, input.email) });
    const ok = host ? await Bun.password.verify(input.password, host.passwordHash) : false;
    if (!host || !ok) throw new HTTPException(401, { message: "Invalid email or password" });
    if (host.disabledAt) throw new HTTPException(403, { message: "This account has been disabled" });
    return c.json({ token: await signHostToken(host.id), host: publicHost(host) });
  })

  .get("/me", requireHost, (c) => c.json(publicHost(c.get("host"))));

/**
 * Make sure someone can administer the install:
 *  - every host listed in ADMIN_EMAIL becomes admin;
 *  - if there's still no admin, the oldest account is promoted.
 */
export async function ensureAdmin() {
  const emails = (env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  for (const email of emails) {
    const [h] = await db
      .update(schema.hosts)
      .set({ role: "admin", disabledAt: null })
      .where(eq(schema.hosts.email, email))
      .returning({ email: schema.hosts.email });
    if (h) console.log(`Admin: ${h.email}`);
    else console.warn(`ADMIN_EMAIL ${email} has no account yet — it will be promoted once it registers and the server restarts`);
  }

  const admin = await db.query.hosts.findFirst({ where: eq(schema.hosts.role, "admin") });
  if (admin) return;
  const oldest = await db.query.hosts.findFirst({ orderBy: (h, { asc }) => asc(h.createdAt) });
  if (oldest) {
    await db.update(schema.hosts).set({ role: "admin" }).where(eq(schema.hosts.id, oldest.id));
    console.log(`No admin configured — promoted the oldest account (${oldest.email}). Set ADMIN_EMAIL to choose.`);
  }
}
