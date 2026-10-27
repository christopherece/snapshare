/**
 * Hide the browser's tabs and address bar.
 *
 * Android / desktop: the Fullscreen API, which needs a user gesture — call this from a tap handler.
 * iPhone Safari doesn't support it for pages; there the only way is opening the app from the home screen,
 * which the install card (install.ts) walks guests through.
 */
export function enterFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenEnabled || document.fullscreenElement || typeof el.requestFullscreen !== "function") return;
  el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}
