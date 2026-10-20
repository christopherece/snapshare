import "../global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { startUploadQueue } from "../src/lib/upload-queue";

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 2 } } }),
  );

  useEffect(() => {
    startUploadQueue();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000" } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="join/[slug]" />
          <Stack.Screen name="camera" options={{ animation: "fade" }} />
          <Stack.Screen name="feed" options={{ animation: "slide_from_bottom" }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
