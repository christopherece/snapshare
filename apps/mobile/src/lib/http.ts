import { API_URL, REQUEST_TIMEOUT_MS } from "./config";

/** `status` is the HTTP status, or 0 when the server couldn't be reached at all. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get offline() {
    return this.status === 0;
  }
}

export const OFFLINE_MESSAGE = "Couldn't connect. Check your signal and try again.";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  /** "text" for the endpoints that return SVG/HTML. */
  as?: "json" | "text";
}

/** One fetch wrapper for guests and hosts: JSON in and out, a timeout, and errors with the server's own message. */
export async function http<T>(path: string, { method = "GET", body, headers, as = "json" }: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: as === "json" ? "application/json" : "*/*",
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, errBody?.error ?? fallbackMessage(res.status), errBody);
  }
  if (res.status === 204) return null as T;
  return (as === "text" ? await res.text() : await res.json().catch(() => null)) as T;
}

function fallbackMessage(status: number) {
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "The server had a problem. Please try again in a moment.";
  return `Request failed (${status})`;
}

/** A message that's safe to show to people, whatever was thrown. */
export const errorMessage = (err: unknown, fallback = "Something went wrong. Please try again.") =>
  err instanceof ApiError && err.message ? err.message : fallback;
