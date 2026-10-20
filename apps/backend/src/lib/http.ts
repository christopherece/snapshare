import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HTTPException(400, {
      res: Response.json({ error: "Invalid request", issues: result.error.flatten() }, { status: 400 }),
    });
  }
  return result.data;
}

export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: "Expected JSON body" });
  });
  return parse(schema, json);
}

export function notFound(what = "Resource"): never {
  throw new HTTPException(404, { message: `${what} not found` });
}

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

export function randomSlug(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}
