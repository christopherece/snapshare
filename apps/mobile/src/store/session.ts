import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EventPublicDTO } from "@snapshare/shared";
import { randomUUID } from "expo-crypto";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SessionState {
  /** Stable per-install ID — the backend rate-limits and dedupes guests on it. */
  deviceId: string;
  guestName: string | null;
  event: EventPublicDTO | null;
  guestToken: string | null;
  hydrated: boolean;
  setSession: (event: EventPublicDTO, guestToken: string, guestName: string | null) => void;
  leaveEvent: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      deviceId: randomUUID(),
      guestName: null,
      event: null,
      guestToken: null,
      hydrated: false,
      setSession: (event, guestToken, guestName) => set({ event, guestToken, guestName }),
      leaveEvent: () => set({ event: null, guestToken: null }),
    }),
    {
      name: "snapshare-session",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => useSession.setState({ hydrated: true }),
    },
  ),
);
