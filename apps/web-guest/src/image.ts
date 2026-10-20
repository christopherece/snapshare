const MAX_EDGE = 2560;
const QUALITY = 0.82;

/**
 * Downscale to MAX_EDGE on the longest side and re-encode as JPEG (typically 0.8–2 MB),
 * applying EXIF orientation. Re-encoding also strips EXIF (incl. GPS) before upload.
 * Falls back to the original file if the browser can't decode it (e.g. HEIC on Chrome).
 */
export async function compressImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  // Always prefer the re-encoded copy so location metadata never leaves the phone.
  return blob ?? file;
}

/** Grab the current frame of a <video> as a full-resolution JPEG. */
export async function captureVideoFrame(video: HTMLVideoElement, mirror: boolean): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d")!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Could not capture photo");
  return blob;
}
