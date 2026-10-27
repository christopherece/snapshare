import { Accelerometer } from "expo-sensors";
import { Platform } from "react-native";

/**
 * Android: the app is locked to portrait, so the camera saves sideways shots as portrait. Like the system
 * camera, read how the phone is held from the accelerometer and turn the photo to match.
 * (iOS does this natively via CameraView's responsiveOrientationWhenOrientationLocked.)
 */

export type Rotation = 0 | 90 | 180 | 270; // 90 = phone turned anticlockwise (left edge down)

let held: Rotation = 0;

/** Start reading the accelerometer; returns a stop function. No-op on iOS. */
export function watchHeldOrientation(): () => void {
  if (Platform.OS !== "android") return () => {};
  Accelerometer.setUpdateInterval(250);
  const sub = Accelerometer.addListener(({ x, y }) => {
    // Android, in g: upright → y ≈ +1, left edge down → x ≈ +1.
    if (Math.abs(x) < 0.4 && Math.abs(y) < 0.4) return; // lying flat: keep the last reading
    held = Math.abs(x) > Math.abs(y) ? (x > 0 ? 90 : 270) : y > 0 ? 0 : 180;
  });
  return () => sub.remove();
}

/** Degrees to turn a photo (clockwise when positive) so it matches how the phone is held; 0 on iOS. */
export function photoCorrection(width: number, height: number): -90 | 0 | 90 {
  if (Platform.OS !== "android") return 0;
  const wantLandscape = held === 90 || held === 270;
  if (wantLandscape === width > height) return 0; // already the right shape (some phones' cameras handle it)
  if (wantLandscape) return held === 90 ? -90 : 90;
  return 0;
}
