/**
 * Which way the phone is physically held — like the system camera, from the motion sensor, so it works
 * even with rotation lock on (the screen, and so the camera feed, then stays portrait).
 *
 * iPhone asks permission ("motion & orientation") the first time, so start this from a tap.
 */

export type Rotation = 0 | 90 | 180 | 270; // like screen.orientation.angle: 90 = turned anticlockwise

const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let held: Rotation = 0;
let listening = false;

function onMotion(e: DeviceMotionEvent) {
  const g = e.accelerationIncludingGravity;
  if (g?.x == null || g.y == null) return;
  // Android/spec: upright → y ≈ +9.8, left edge down (turned anticlockwise) → x ≈ +9.8. iOS reports the opposite signs.
  const x = isIos ? -g.x : g.x;
  const y = isIos ? -g.y : g.y;
  if (Math.abs(x) < 4 && Math.abs(y) < 4) return; // lying flat: keep the last reading
  held = Math.abs(x) > Math.abs(y) ? (x > 0 ? 90 : 270) : y > 0 ? 0 : 180;
}

/** Start listening. Call from a tap handler: iPhone shows its permission prompt then. */
export async function trackOrientation() {
  if (listening || typeof DeviceMotionEvent === "undefined") return;
  listening = true;
  const DM = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
  if (typeof DM.requestPermission === "function") {
    try {
      if ((await DM.requestPermission()) !== "granted") {
        listening = false;
        return;
      }
    } catch {
      listening = false;
      return;
    }
  }
  addEventListener("devicemotion", onMotion);
}

const screenAngle = (): Rotation => ((screen.orientation?.angle ?? 0) % 360) as Rotation;

/**
 * Degrees to turn a just-captured photo (clockwise, ±90) so it comes out the way the phone was held.
 * Pure, so it's testable: frames normally come in the screen's orientation, or the phone's natural portrait.
 */
export function photoCorrection(heldAs: Rotation, screenAs: Rotation, width: number, height: number): -90 | 0 | 90 {
  const wantLandscape = heldAs === 90 || heldAs === 270;
  if (wantLandscape === width > height) return 0; // already the right shape
  // Held sideways but the photo is portrait (rotation lock, or Android's full-res capture):
  // turned anticlockwise → the scene's "up" is the photo's right edge → turn the photo anticlockwise.
  if (wantLandscape) return heldAs === 90 ? -90 : 90;
  // Held upright but the photo came out landscape (the screen was still turned): undo the screen's turn.
  return screenAs === 90 ? 90 : screenAs === 270 ? -90 : 0;
}

/** Correction for the current moment, or 0 if we don't know how the phone is held. */
export const correctionNow = (width: number, height: number) =>
  photoCorrection(listening ? held : screenAngle(), screenAngle(), width, height);
