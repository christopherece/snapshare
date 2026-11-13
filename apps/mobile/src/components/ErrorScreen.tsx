import Ionicons from "@expo/vector-icons/Ionicons";
import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { colors } from "../theme";

/**
 * Shown by expo-router when a screen throws while rendering. Deliberately plain (no custom fonts,
 * no stores) so it can't fail for the same reason the screen did. Queued photos are safe on disk.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  return (
    <View className="flex-1 items-center justify-center bg-ink-deep px-10">
      <Ionicons name="alert-circle-outline" size={44} color={colors.gold} />
      <Text className="mt-5 text-center text-2xl font-light text-white">Something went wrong</Text>
      <Text className="mt-2 text-center text-base leading-6 text-white/60">
        Sorry about that. Any photos you've taken are saved on this phone and will still upload.
      </Text>
      {__DEV__ && <Text className="mt-4 text-center text-xs text-white/40">{error.message}</Text>}
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        className="mt-8 rounded-full bg-white px-8 py-3 active:opacity-80"
      >
        <Text className="text-base font-medium text-black">Try again</Text>
      </Pressable>
    </View>
  );
}
