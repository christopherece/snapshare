import Ionicons from "@expo/vector-icons/Ionicons";
import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { plural } from "../lib/format";
import { discardBlocked, useBlockedCount, usePendingCount, useUploadQueue } from "../lib/upload-queue";
import { colors } from "../theme";

const DONE_MS = 2500;

/**
 * One line that tells a guest what's happening to their photos: uploading, saved for later while
 * offline, done — or stuck, with a way out. Renders nothing when there's nothing to say.
 */
export function UploadStatus({
  eventId,
  onRejoin,
  importing = 0,
}: {
  eventId: string;
  /** Start the join flow again — a fresh session unblocks refused photos (see retryBlocked). */
  onRejoin: () => void;
  /** Photos picked from the library that are still being prepared. */
  importing?: number;
}) {
  const pending = usePendingCount(eventId);
  const blocked = useBlockedCount(eventId);
  const online = useUploadQueue((s) => s.online);
  const lastCompletedAt = useUploadQueue((s) => s.lastCompletedAt);

  // Show "Uploaded" briefly after the queue empties.
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    const left = DONE_MS - (Date.now() - lastCompletedAt);
    if (pending > 0 || left <= 0) return setJustDone(false);
    setJustDone(true);
    const t = setTimeout(() => setJustDone(false), left);
    return () => clearTimeout(t);
  }, [lastCompletedAt, pending]);

  if (blocked > 0) {
    const explain = () =>
      Alert.alert(
        `${plural(blocked, "photo")} couldn't upload`,
        "Your place at this event may have expired. Rejoin to send them, or discard them.",
        // Android shows at most three buttons.
        [
          { text: "Discard", style: "destructive", onPress: () => discardBlocked(eventId) },
          { text: "Cancel", style: "cancel" },
          { text: "Rejoin and retry", onPress: onRejoin },
        ],
      );
    return (
      <Pill onPress={explain} tone="warn" icon="alert-circle">
        {plural(blocked, "photo")} couldn't upload · Tap to fix
      </Pill>
    );
  }

  if (importing > 0) return <Pill busy>Adding {plural(importing, "photo")}…</Pill>;

  if (!online) {
    return (
      <Pill icon="cloud-offline-outline">
        {pending > 0 ? `Offline · ${plural(pending, "photo")} saved, will upload automatically` : "Offline · photos are saved and sent later"}
      </Pill>
    );
  }

  if (pending > 0) return <Pill busy>Uploading {plural(pending, "photo")}…</Pill>;
  if (justDone) return <Pill icon="checkmark-circle">Uploaded</Pill>;
  return null;
}

function Pill({
  children,
  icon,
  busy = false,
  tone = "plain",
  onPress,
}: {
  children: ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  busy?: boolean;
  tone?: "plain" | "warn";
  onPress?: () => void;
}) {
  const tint = tone === "warn" ? colors.ink : "#fff";
  return (
    <View pointerEvents="box-none" className="items-center px-6">
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLiveRegion="polite"
        className={`flex-row items-center gap-2 rounded-full px-4 py-2 ${tone === "warn" ? "bg-accent" : "bg-black/55"}`}
      >
        {busy ? <ActivityIndicator size="small" color={tint} /> : icon && <Ionicons name={icon} size={16} color={tint} />}
        <Text className={`text-[13px] font-medium ${tone === "warn" ? "text-ink" : "text-white"}`}>{children}</Text>
      </Pressable>
    </View>
  );
}
