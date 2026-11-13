import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EventPublicDTO } from "@snapshare/shared";
import { randomUUID } from "expo-crypto";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Which side of the app was used last — the app reopens there. */
export type AppMode = "guest" | "host" | null;

interface SessionState {
  /** Stable per-install ID — the backend rate-limits and dedupes guests on it. */
  deviceId: string;
  guestName: string | null;
  event: EventPublicDTO | null;
  guestToken: string | null;
  mode: AppMode;
  hydrated: boolean;
  setSession: (event: EventPublicDTO, guestToken: string, guestName: string | null) => void;
  leaveEvent: () => void;
  setMode: (mode: AppMode) => void;
}

/**
 * Guest session. The guest token is an opaque, per-event credential that only allows sharing photos to
 * that one event, so it lives in ordinary app storage (the host's account token is in the keychain —
 * see store/host.ts).
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      deviceId: randomUUID(),
      guestName: null,
      event: null,
      guestToken: null,
      mode: null,
      hydrated: false,
      setSession: (event, guestToken, guestName) => set({ event, guestToken, guestName, mode: "guest" }),
      leaveEvent: () => set((s) => ({ event: null, guestToken: null, mode: s.mode === "guest" ? null : s.mode })),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "snapshare-session",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => useSession.setState({ hydrated: true }),
    },
  ),
);
