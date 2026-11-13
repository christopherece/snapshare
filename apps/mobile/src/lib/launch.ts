import { router } from "expo-router";

/**
 * Reopening the app takes people back to where they were (the camera for a guest, their events for a
 * host) — but only on a cold start. Once the first screen is up, Home behaves like a normal screen.
 */
export const launch = { handled: false };

/** Back to the home screen from anywhere, whether or not it's underneath in the stack. */
export function goHome() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
