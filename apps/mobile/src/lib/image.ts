import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { JPEG_QUALITY, MAX_IMAGE_EDGE } from "./config";

/**
 * Downscale to MAX_IMAGE_EDGE on the longest side and re-encode as JPEG.
 * A 12–48 MP capture typically lands at 0.8–2 MB, which keeps uploads fast on
 * congested venue Wi-Fi. Re-encoding also drops EXIF (incl. GPS) before upload.
 */
export async function compressPhoto(uri: string, width: number, height: number) {
  const longest = Math.max(width, height);
  const actions =
    longest > MAX_IMAGE_EDGE ? [{ resize: width >= height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE } }] : [];
  return manipulateAsync(uri, actions, { compress: JPEG_QUALITY, format: SaveFormat.JPEG });
}
