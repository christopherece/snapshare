import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/client.ts";
import { signHostToken } from "../lib/auth.ts";
import { body } from "../lib/http.ts";
import { TokenBucket, clientIp, rateLimit } from "../lib/rate-limit.ts";

const authLimiter = new TokenBucket(10, 10 / 60); // 10 attempts, refills 10/min

const credentials = z.object({
  email: z.string().email().max(255).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(200),
});

export const authRoutes = new Hono()
  .use(rateLimit(authLimiter, clientIp))

  .post("/register", async (c) => {
    const input = await body(c, credentials.extend({ name: z.string().min(1).max(120) }));
    const [host] = await db
      .insert(schema.hosts)
      .values({ email: input.email, name: input.name, passwordHash: await Bun.password.hash(input.password) })
      .onConflictDoNothing()
      .returning();
    if (!host) throw new HTTPException(409, { message: "Email already registered" });
    return c.json({ token: await signHostToken(host.id), host: { id: host.id, name: host.name, email: host.email } }, 201);
  })

  .post("/login", async (c) => {
    const input = await body(c, credentials);
    const host = await db.query.hosts.findFirst({ where: eq(schema.hosts.email, input.email) });
    const ok = host ? await Bun.password.verify(input.password, host.passwordHash) : false;
    if (!host || !ok) throw new HTTPException(401, { message: "Invalid email or password" });
    return c.json({ token: await signHostToken(host.id), host: { id: host.id, name: host.name, email: host.email } });
  });
