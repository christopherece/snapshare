import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Adds the parts of the app config that depend on where the server lives (app.json holds the rest).
 *
 * The app claims https://<host>/join/<code> and /open/<code>, so a guest who has the app installed lands
 * in it straight from the printed QR code. <host> is EXPO_PUBLIC_LINK_HOST, or else the host of
 * EXPO_PUBLIC_API_URL when that is https. The server proves the claim at /.well-known/* once its
 * IOS_APP_ID / ANDROID_APP_FINGERPRINTS are set; until then the links simply keep opening the web app.
 */
function linkHost(): string | null {
  const explicit = process.env.EXPO_PUBLIC_LINK_HOST?.trim();
  if (explicit) return explicit.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  try {
    const api = new URL(process.env.EXPO_PUBLIC_API_URL ?? "");
    return api.protocol === "https:" ? api.host : null;
  } catch {
    return null;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const host = linkHost();
  const easProjectId = process.env.EAS_PROJECT_ID;

  return {
    ...config,
    name: config.name ?? "SnapShare",
    slug: config.slug ?? "snapshare",
    ios: {
      ...config.ios,
      ...(host && { associatedDomains: [`applinks:${host}`] }),
    },
    android: {
      ...config.android,
      ...(host && {
        intentFilters: [
          {
            action: "VIEW",
            autoVerify: true,
            data: ["/join", "/open"].map((pathPrefix) => ({ scheme: "https", host, pathPrefix })),
            category: ["BROWSABLE", "DEFAULT"],
          },
        ],
      }),
    },
    extra: {
      ...config.extra,
      ...(easProjectId && { eas: { projectId: easProjectId } }),
    },
  };
};
