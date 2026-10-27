import { useSyncExternalStore } from "react";

/**
 * Android "Install app" prompt.
 *
 * Chrome fires `beforeinstallprompt` once the page is installable and the guest has engaged with it
 * (a tap and a little time on the page). We keep the event and show our own "Install SnapShare?"
 * card; tapping Install opens Chrome's confirmation dialog. iPhone never fires it — there the
 * Add to Home Screen tip is shown instead (fullscreen.ts).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Call at startup, before React renders, so an early event isn't missed. */
export function captureInstallPrompt() {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own card instead of Chrome's mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

/** True while the app can be installed with one tap. */
export const useCanInstall = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
  );

/** Opens Chrome's install dialog. Must be called from a tap. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null; // each event can only be prompted once
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === "accepted";
}

const dismissKey = (slug: string) => `snapshare.installDismissed.${slug}`;

/** "Not now" hides the card for this event; the smaller Install link stays available. */
export function installCardDismissed(slug: string) {
  try {
    return localStorage.getItem(dismissKey(slug)) === "1";
  } catch {
    return false;
  }
}

export function dismissInstallCard(slug: string) {
  try {
    localStorage.setItem(dismissKey(slug), "1");
  } catch {}
}
