import { useSyncExternalStore } from "react";
import { ApiError, api } from "./api";
import { uuid } from "./id";
import { compressImage } from "./image";

/**
 * Offline-first upload queue for the browser.
 *
 *   capture → compress → save Blob in IndexedDB → (online) presign → PUT to storage → /complete → delete
 *
 * IndexedDB keeps photos across tab closes, reloads and dead zones. If it's unavailable
 * (rare private modes) the queue still works in memory for the current visit.
 */

export type ItemStatus = "queued" | "uploading" | "blocked";

export interface QueueItem {
  clientId: string;
  eventId: string;
  guestToken: string;
  blob: Blob;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: ItemStatus;
  photoId?: string;
  stored?: boolean;
  error?: string;
}

export interface QueueSnapshot {
  items: QueueItem[];
  /** Bumps each time a photo finishes uploading — drives the "✓ Uploaded" pill. */
  completed: number;
  lastCompletedAt: number;
  online: boolean;
}

const DB_NAME = "snapshare";
const STORE = "uploads";
const CONCURRENCY = 2;
const MAX_BACKOFF_MS = 5 * 60_000;

// ─── IndexedDB (tiny promise wrapper) ─────────────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const persist = (item: QueueItem) => idb("readwrite", (s) => s.put(item));
const unpersist = (clientId: string) => idb("readwrite", (s) => s.delete(clientId));

// ─── State + subscription (for React via useSyncExternalStore) ───────────────

let state: QueueSnapshot = { items: [], completed: 0, lastCompletedAt: 0, online: navigator.onLine };
const listeners = new Set<() => void>();

function setState(patch: Partial<QueueSnapshot>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function updateItem(clientId: string, patch: Partial<QueueItem>) {
  const items = state.items.map((i) => (i.clientId === clientId ? { ...i, ...patch } : i));
  setState({ items });
  const item = items.find((i) => i.clientId === clientId);
  if (item) void persist(item);
}

export function useQueue(): QueueSnapshot {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;
let running = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

export async function startQueue() {
  if (started) return;
  started = true;

  // Ask the browser not to evict our stored photos under storage pressure.
  void navigator.storage?.persist?.().catch(() => {});

  const saved = (await idb<QueueItem[]>("readonly", (s) => s.getAll())) ?? [];
  setState({
    items: [...saved.map((i) => (i.status === "uploading" ? { ...i, status: "queued" as const } : i)), ...state.items],
  });

  addEventListener("online", () => {
    setState({ online: true });
    // Connectivity is back: retry everything now instead of waiting out the backoff.
    state.items.forEach((i) => i.status === "queued" && updateItem(i.clientId, { nextAttemptAt: 0 }));
    drain();
  });
  addEventListener("offline", () => setState({ online: false }));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && drain());
  drain();
}

/** Compress, store locally, and queue a photo. Resolves once it's safely saved on the device. */
export async function enqueuePhoto(file: Blob, eventId: string, guestToken: string) {
  const blob = await compressImage(file);
  const item: QueueItem = {
    clientId: uuid(),
    eventId,
    guestToken,
    blob,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "queued",
  };
  await persist(item);
  setState({ items: [...state.items, item] });
  drain();
  return item;
}

/** Retry photos that were blocked (e.g. after re-joining an event). */
export function retryBlocked(eventId: string, guestToken: string) {
  state.items
    .filter((i) => i.eventId === eventId && i.status === "blocked")
    .forEach((i) => updateItem(i.clientId, { status: "queued", guestToken, nextAttemptAt: 0, attempts: 0 }));
  drain();
}

function drain() {
  if (!started || !navigator.onLine) return;
  const now = Date.now();
  const ready = state.items
    .filter((i) => i.status === "queued" && i.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (running < CONCURRENCY && ready.length) void processItem(ready.shift()!);

  if (wakeTimer) clearTimeout(wakeTimer);
  const waiting = state.items.filter((i) => i.status === "queued");
  if (waiting.length) {
    const next = Math.min(...waiting.map((i) => i.nextAttemptAt));
    wakeTimer = setTimeout(drain, Math.max(1000, next - Date.now()));
  }
}

async function processItem(item: QueueItem) {
  running++;
  updateItem(item.clientId, { status: "uploading" });
  try {
    let { photoId, stored } = item;

    if (!stored) {
      let target;
      try {
        target = await api.getUploadUrl(item.guestToken, item.eventId, item.clientId, item.blob.type || "image/jpeg");
      } catch (err) {
        // The server already has this photo from an earlier attempt.
        if (err instanceof ApiError && err.status === 409) return await finish(item);
        throw err;
      }
      photoId = target.photoId;
      updateItem(item.clientId, { photoId });

      const res = await fetch(target.uploadUrl, { method: "PUT", headers: target.headers, body: item.blob });
      if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
      stored = true;
      updateItem(item.clientId, { stored });
    }

    try {
      await api.completeUpload(item.guestToken, photoId!);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) updateItem(item.clientId, { stored: false });
      throw err;
    }
    await finish(item);
  } catch (err) {
    const attempts = item.attempts + 1;
    // 400 = server rejected the photo itself (e.g. unsupported type): retrying won't help.
    const fatal = err instanceof ApiError && [400, 401, 403, 404, 413].includes(err.status);
    updateItem(item.clientId, {
      status: fatal ? "blocked" : "queued",
      attempts,
      nextAttemptAt: Date.now() + Math.min(2 ** attempts * 2000, MAX_BACKOFF_MS),
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running--;
    drain();
  }
}

/** Stable object URL for showing a queued photo (revoked once it's uploaded). */
const previews = new Map<string, string>();
export function previewUrl(item: QueueItem) {
  let url = previews.get(item.clientId);
  if (!url) previews.set(item.clientId, (url = URL.createObjectURL(item.blob)));
  return url;
}

async function finish(item: QueueItem) {
  const url = previews.get(item.clientId);
  if (url) {
    URL.revokeObjectURL(url);
    previews.delete(item.clientId);
  }
  await unpersist(item.clientId);
  setState({
    items: state.items.filter((i) => i.clientId !== item.clientId),
    completed: state.completed + 1,
    lastCompletedAt: Date.now(),
  });
  navigator.vibrate?.(15);
}
