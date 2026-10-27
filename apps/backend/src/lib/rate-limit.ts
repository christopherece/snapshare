import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { env } from "../env.ts";

/**
 * In-memory token bucket. Fine for a single instance; swap for Redis
 * (e.g. a Lua token bucket) when running more than one backend replica.
 */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    // Drop idle buckets so the map doesn't grow forever.
    setInterval(() => this.sweep(), 60_000).unref();
  }

  /** Returns 0 if allowed, otherwise the seconds to wait before retrying. */
  take(key: string, cost = 1): number {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.updatedAt) / 1000) * this.refillPerSecond);
    b.updatedAt = now;
    this.buckets.set(key, b);
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return 0;
    }
    return Math.ceil((cost - b.tokens) / this.refillPerSecond);
  }

  private sweep() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [key, b] of this.buckets) if (b.updatedAt < cutoff) this.buckets.delete(key);
  }
}

export function rateLimit<E extends object>(
  bucket: TokenBucket,
  keyOf: (c: Parameters<MiddlewareHandler<E>>[0]) => string,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const retryAfter = bucket.take(keyOf(c));
    if (retryAfter > 0) {
      c.header("Retry-After", String(retryAfter));
      throw new HTTPException(429, { message: "Too many requests" });
    }
    await next();
  };
}

/**
 * Read the client IP from the one header our proxy overwrites (CLIENT_IP_HEADER, default X-Real-IP).
 * Never fall back to other headers: anything the proxy passes through unchanged (CF-Connecting-IP
 * without Cloudflare in front, X-Forwarded-For) is attacker-controlled and would give each request
 * a fresh rate-limit bucket.
 */
export function clientIp(c: { req: { header(name: string): string | undefined } }) {
  return c.req.header(env.CLIENT_IP_HEADER)?.trim() || "unknown";
}
