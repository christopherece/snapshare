import "../global.css";
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic, useFonts } from "@expo-google-fonts/instrument-serif";
import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { isSessionEnded } from "../src/hooks/useEventFeed";
import { ApiError } from "../src/lib/http";
import { launch } from "../src/lib/launch";
import { startUploadQueue } from "../src/lib/upload-queue";
import { hydrateHost, useHostAuth } from "../src/store/host";
import { useSession } from "../src/store/session";
import { useTheme } from "../src/theme";

// A screen that throws while rendering shows this instead of a blank app.
export { ErrorScreen as ErrorBoundary } from "../src/components/ErrorScreen";

// Keep the splash up until fonts and the saved session are ready, so the first frame is the right screen.
void SplashScreen.preventAutoHideAsync().catch(() => {});

// React Query should pause when the phone is offline and refetch when the app comes back to the front.
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)));
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
  return () => sub.remove();
});

/** Don't hammer the server over things a retry can't fix (signed out, not found, validation…). */
const shouldRetry = (failures: number, err: unknown) => {
  if (isSessionEnded(err)) return false;
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) return false;
  return failures < 2;
};

export default function RootLayout() {
  const theme = useTheme();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetry }, mutations: { retry: false } } }),
  );
  const [fontsLoaded, fontError] = useFonts({ InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic });
  const sessionReady = useSession((s) => s.hydrated);
  const hostReady = useHostAuth((s) => s.hydrated);
  // Never leave the app stuck on an empty screen: if fonts or saved data take too long, carry on
  // without them (fonts fall back to the system face; a late-loading session still applies when it lands).
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  const loaded = (fontsLoaded || !!fontError) && sessionReady && hostReady;
  const ready = loaded || gaveUp;
  useEffect(() => {
    if (gaveUp && !loaded) console.warn("Startup is slow", { fontsLoaded, fontError: fontError?.message, sessionReady, hostReady });
  }, [gaveUp, loaded, fontsLoaded, fontError, sessionReady, hostReady]);

  useEffect(() => {
    startUploadQueue();
    void hydrateHost();
    // Like the system camera: the UI never rotates; icons turn instead (see EventCamera).
    // app.json locks store builds already — this also covers development builds.
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    launch.handled = true; // children rendered first — Home has already decided where to resume
    void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // The splash normally covers this; it's a plain brand-coloured screen rather than nothing.
  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="join/index" />
          <Stack.Screen name="join/[slug]" />
          <Stack.Screen name="scan" options={{ animation: "slide_from_bottom", contentStyle: { backgroundColor: "#000" } }} />
          <Stack.Screen name="camera" options={{ animation: "fade", contentStyle: { backgroundColor: "#000" } }} />
          <Stack.Screen name="feed" options={{ animation: "slide_from_bottom" }} />
          <Stack.Screen name="host" />
          <Stack.Screen name="+not-found" />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
