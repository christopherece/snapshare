/**
 * Hide the browser's tabs and address bar.
 *
 * Android / desktop: the Fullscreen API, which needs a user gesture — call this from a tap handler.
 * iPhone Safari doesn't support it for pages; there the only way is opening the app from the home screen
 * (manifest + apple-mobile-web-app-capable), which `shouldSuggestHomeScreen` nudges guests towards.
 */
export function enterFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenEnabled || document.fullscreenElement || typeof el.requestFullscreen !== "function") return;
  el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}

const TIP_KEY = "snapshare.homeScreenTipDismissed";

const isIos = () =>
  /iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone in Safari (not already opened from the home screen), and the guest hasn't dismissed the tip. */
export function shouldSuggestHomeScreen() {
  try {
    if (localStorage.getItem(TIP_KEY)) return false;
  } catch {}
  return isIos() && !isStandalone() && !document.fullscreenEnabled;
}

export function dismissHomeScreenTip() {
  try {
    localStorage.setItem(TIP_KEY, "1");
  } catch {}
}
