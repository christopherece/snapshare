import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { useSession } from "./session";

const TOKEN_KEY = "snapshare.hostToken";

interface HostAuthState {
  /** The host's account JWT. Kept in the iOS Keychain / Android Keystore, never in plain storage. */
  token: string | null;
  hydrated: boolean;
  setToken: (token: string) => void;
  signOut: () => void;
}

export const useHostAuth = create<HostAuthState>()((set) => ({
  token: null,
  hydrated: false,
  setToken: (token) => {
    set({ token });
    useSession.getState().setMode("host");
    void SecureStore.setItemAsync(TOKEN_KEY, token).catch((err) => console.warn("Could not save sign-in", err));
  },
  signOut: () => {
    set({ token: null });
    const session = useSession.getState();
    if (session.mode === "host") session.setMode(null);
    void SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  },
}));

let hydrating: Promise<void> | null = null;

/** Read the saved sign-in once at launch. */
export function hydrateHost() {
  hydrating ??= SecureStore.getItemAsync(TOKEN_KEY)
    .catch(() => null)
    .then((token) => useHostAuth.setState({ token, hydrated: true }));
  return hydrating;
}
