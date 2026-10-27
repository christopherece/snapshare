const MAX_EDGE = 2560;
const QUALITY = 0.82;

/** The photo couldn't be decoded on this device, so it isn't uploaded (never send an unprocessed original). */
export class UnsupportedImageError extends Error {
  constructor() {
    super("This photo format isn't supported");
  }
}

/** HEIC/HEIF — iPhone's default format. Only Safari can decode it natively. */
export const looksLikeHeic = (file: Blob) =>
  /^image\/hei[cf]/.test(file.type) || (file instanceof File && /\.hei[cf]$/i.test(file.name));

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {}
  // Chrome/Firefox can't read HEIC: decode it on the phone with libheif (~3 MB, loaded only when needed).
  try {
    const { heicTo } = await import("heic-to");
    return await heicTo({ blob: file, type: "bitmap", options: { imageOrientation: "from-image" } });
  } catch {
    throw new UnsupportedImageError();
  }
}

/**
 * Downscale to MAX_EDGE on the longest side and re-encode as JPEG (typically 0.8–2 MB),
 * applying EXIF orientation. Re-encoding also strips EXIF (incl. GPS) before upload,
 * so a file we can't decode is rejected rather than uploaded as-is.
 */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await decode(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UnsupportedImageError();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  // Only the re-encoded copy is ever uploaded, so location metadata never leaves the phone.
  if (!blob) throw new UnsupportedImageError();
  return blob;
}

/** Digital zoom: keep the centre 1/zoom of the photo (when the camera has no hardware zoom). */
export async function cropCenter(blob: Blob, zoom: number): Promise<Blob> {
  if (zoom <= 1.01) return blob;
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const w = Math.round(bitmap.width / zoom);
  const h = Math.round(bitmap.height / zoom);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - w) / 2, (bitmap.height - h) / 2, w, h, 0, 0, w, h);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!out) throw new Error("Could not zoom photo");
  return out;
}

/** Turn a photo by ±90° (clockwise when positive) — makes landscape shots come out landscape. */
export async function rotatePhoto(blob: Blob, degrees: -90 | 0 | 90): Promise<Blob> {
  if (!degrees) return blob;
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!out) throw new Error("Could not rotate photo");
  return out;
}

/** Width and height of a photo as it will display (EXIF orientation applied). */
export async function photoSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
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
