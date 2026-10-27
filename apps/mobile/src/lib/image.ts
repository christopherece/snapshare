import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { JPEG_QUALITY, MAX_IMAGE_EDGE } from "./config";

/**
 * Downscale to MAX_IMAGE_EDGE on the longest side and re-encode as JPEG.
 * A 12–48 MP capture typically lands at 3–5 MB — print quality; slower on busy venue
 * Wi-Fi, but the queue uploads in the background. Re-encoding also drops EXIF (incl. GPS).
 */
export async function compressPhoto(uri: string, width: number, height: number, rotate: -90 | 0 | 90 = 0) {
  // Turning swaps the sides, so size the resize on the turned photo.
  const [w, h] = rotate ? [height, width] : [width, height];
  const longest = Math.max(w, h);
  const actions = [
    ...(rotate ? [{ rotate }] : []),
    ...(longest > MAX_IMAGE_EDGE ? [{ resize: w >= h ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE } }] : []),
  ];
  return manipulateAsync(uri, actions, { compress: JPEG_QUALITY, format: SaveFormat.JPEG });
}
