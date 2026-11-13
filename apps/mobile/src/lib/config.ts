/** The SnapShare server. Baked in at build time — see .env.example and eas.json. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

export const TERMS_URL = `${API_URL}/terms`;
export const PRIVACY_URL = `${API_URL}/privacy`;

/** Where account-deletion and help requests go (the same address as the server's CONTACT_EMAIL). */
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? "chris.ancheta@topitsolutions.co.nz";

/** Longest edge after client-side compression: print quality (≈ 12 MP), typically 3–5 MB JPEG. */
export const MAX_IMAGE_EDGE = 4000;
export const JPEG_QUALITY = 0.9;

/** How long an API call may take before we treat the connection as dead. */
export const REQUEST_TIMEOUT_MS = 20_000;
