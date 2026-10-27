export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

/** Longest edge after client-side compression: print quality (≈ 12 MP), typically 3–5 MB JPEG. */
export const MAX_IMAGE_EDGE = 4000;
export const JPEG_QUALITY = 0.9;
