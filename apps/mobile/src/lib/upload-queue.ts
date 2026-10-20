import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { AppState } from "react-native";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { ApiError, api } from "./api";
import { compressPhoto } from "./image";

/**
 * Offline-first upload queue.
 *
 *   capture → compress → copy into app documents → persist queue entry
 *          → (when online) presign → PUT to S3 → POST /complete → delete local file
 *
 * Queue entries are persisted in AsyncStorage and image files live in the app's
 * document directory, so photos survive app kills, reboots and dead zones.
 */

export type QueueStatus = "queued" | "uploading" | "blocked";

export interface QueueItem {
  clientId: string;
  eventId: string;
  guestToken: string;
  /** File name only — the iOS container path changes across app updates. */
  fileName: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: QueueStatus;
  photoId?: string;
  /** PUT to storage succeeded; only /complete is outstanding. */
  stored?: boolean;
  error?: string;
}

interface QueueState {
  items: QueueItem[];
  add: (item: QueueItem) => void;
  update: (clientId: string, patch: Partial<QueueItem>) => void;
  remove: (clientId: string) => void;
}

export const useUploadQueue = create<QueueState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) => set((s) => ({ items: [...s.items, item] })),
      update: (clientId, patch) =>
        set((s) => ({ items: s.items.map((i) => (i.clientId === clientId ? { ...i, ...patch } : i)) })),
      remove: (clientId) => set((s) => ({ items: s.items.filter((i) => i.clientId !== clientId) })),
    }),
    {
      name: "snapshare-upload-queue-v1",
      storage: createJSONStorage(() => AsyncStorage),
      // Anything "uploading" when the app died needs to be retried.
      onRehydrateStorage: () => (state) => {
        state?.items.forEach((i) => i.status === "uploading" && state.update(i.clientId, { status: "queued" }));
        drain();
      },
    },
  ),
);

const PENDING_DIR = `${FileSystem.documentDirectory}pending-uploads/`;
const CONCURRENCY = 2;
const MAX_BACKOFF_MS = 5 * 60_000;

const fileUri = (item: Pick<QueueItem, "fileName">) => PENDING_DIR + item.fileName;

let online = true;
let running = 0;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** Call once at app start. */
export function startUploadQueue() {
  if (started) return;
  started = true;
  void FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true }).catch(() => {});

  NetInfo.addEventListener((state) => {
    const wasOnline = online;
    online = !!state.isConnected && state.isInternetReachable !== false;
    if (online && !wasOnline) {
      // Connectivity came back: retry everything right away instead of waiting out backoff.
      const { items, update } = useUploadQueue.getState();
      items.forEach((i) => i.status === "queued" && update(i.clientId, { nextAttemptAt: 0 }));
    }
    drain();
  });

  AppState.addEventListener("change", (s) => s === "active" && drain());
}

/** Compress a fresh capture, persist it locally, and queue it for upload. Returns the local preview URI. */
export async function enqueuePhoto(opts: { uri: string; width: number; height: number; eventId: string; guestToken: string }) {
  const compressed = await compressPhoto(opts.uri, opts.width, opts.height);
  const clientId = randomUUID();
  const fileName = `${clientId}.jpg`;

  await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.moveAsync({ from: compressed.uri, to: PENDING_DIR + fileName });
  // The raw capture is still on screen in the fly-to-gallery animation; drop it shortly after.
  setTimeout(() => void FileSystem.deleteAsync(opts.uri, { idempotent: true }), 5000);

  useUploadQueue.getState().add({
    clientId,
    eventId: opts.eventId,
    guestToken: opts.guestToken,
    fileName,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "queued",
  });
  drain();
  return PENDING_DIR + fileName;
}

export function drain() {
  if (!started || !online) return;
  const now = Date.now();
  const { items } = useUploadQueue.getState();
  const ready = items
    .filter((i) => i.status === "queued" && i.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);

  while (running < CONCURRENCY && ready.length) void processItem(ready.shift()!);
  scheduleWake();
}

function scheduleWake() {
  if (wakeTimer) clearTimeout(wakeTimer);
  const waiting = useUploadQueue.getState().items.filter((i) => i.status === "queued");
  if (!waiting.length) return;
  const next = Math.min(...waiting.map((i) => i.nextAttemptAt));
  wakeTimer = setTimeout(drain, Math.max(1000, next - Date.now()));
}

async function processItem(item: QueueItem) {
  const { update, remove } = useUploadQueue.getState();
  running++;
  update(item.clientId, { status: "uploading" });

  try {
    let { photoId, stored } = item;

    if (!stored) {
      let target;
      try {
        target = await api.getUploadUrl(item.guestToken, item.eventId, item.clientId);
      } catch (err) {
        // Server already has this photo (previous attempt got further than we recorded).
        if (err instanceof ApiError && err.status === 409) return finish(item);
        throw err;
      }
      photoId = target.photoId;
      update(item.clientId, { photoId });

      const res = await FileSystem.uploadAsync(target.uploadUrl, fileUri(item), {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.BACKGROUND, // iOS keeps uploading when backgrounded
        headers: target.headers,
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`Storage upload failed (${res.status})`);
      stored = true;
      update(item.clientId, { stored });
    }

    try {
      await api.completeUpload(item.guestToken, photoId!);
    } catch (err) {
      // Backend couldn't see the object — redo the PUT on the next attempt.
      if (err instanceof ApiError && err.status === 409) update(item.clientId, { stored: false });
      throw err;
    }
    await finish(item);
  } catch (err) {
    const attempts = item.attempts + 1;
    const fatal = err instanceof ApiError && [401, 403, 404, 413].includes(err.status);
    update(item.clientId, {
      status: fatal ? "blocked" : "queued",
      attempts,
      nextAttemptAt: Date.now() + Math.min(2 ** attempts * 2000, MAX_BACKOFF_MS),
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running--;
    drain();
  }

  async function finish(i: QueueItem) {
    await FileSystem.deleteAsync(fileUri(i), { idempotent: true });
    remove(i.clientId);
    notifyUploaded();
  }
}

// One soft haptic per burst of completions, not one per photo.
let hapticTimer: ReturnType<typeof setTimeout> | null = null;
function notifyUploaded() {
  if (hapticTimer) clearTimeout(hapticTimer);
  hapticTimer = setTimeout(() => {
    if (AppState.currentState === "active") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, 600);
}

/** Selector: number of photos still waiting to upload for an event. */
export const usePendingCount = (eventId: string | undefined) =>
  useUploadQueue((s) => s.items.filter((i) => i.eventId === eventId && i.status !== "blocked").length);
