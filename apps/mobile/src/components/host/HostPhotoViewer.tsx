import Ionicons from "@expo/vector-icons/Ionicons";
import type { PhotoDTO } from "@snapshare/shared";
import * as Haptics from "expo-haptics";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ModerationAction } from "../../hooks/useHostGallery";
import { plural } from "../../lib/format";
import { errorMessage } from "../../lib/http";
import { colors } from "../../theme";
import { PhotoPager } from "../PhotoPager";
import type { IconName } from "../ui";

interface Props {
  photos: PhotoDTO[];
  openId: string | null;
  onClose: () => void;
  onEndReached?: () => void;
  act: (photo: PhotoDTO, action: ModerationAction) => Promise<void>;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The host's full-screen viewer: swipe through the gallery and approve, hide, favorite or delete. */
export function HostPhotoViewer({ photos, openId, onClose, onEndReached, act }: Props) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<ModerationAction | null>(null);

  const run = async (photo: PhotoDTO, action: ModerationAction) => {
    if (busy) return;
    setBusy(action);
    try {
      await act(photo, action);
      void Haptics.selectionAsync();
    } catch (err) {
      Alert.alert("That didn't work", errorMessage(err, "Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = (photo: PhotoDTO) =>
    Alert.alert("Delete this photo permanently?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(photo, "delete") },
    ]);

  return (
    <PhotoPager photos={photos} openId={openId} onClose={onClose} onEndReached={onEndReached}>
      {(photo, { index, total }) => {
        const reports = photo.reportCount ?? 0;
        return (
          <>
            <View className="absolute left-0 right-0 flex-row items-start justify-between px-5" style={{ top: insets.top + 8 }}>
              <View className="flex-1 pr-3">
                <Text numberOfLines={1} className="text-sm font-medium text-white/90">
                  {photo.guestName ?? "Guest"} · {timeOf(photo.createdAt)}
                  {photo.likeCount ? ` · ♥ ${photo.likeCount}` : ""}
                </Text>
                <Text className="text-xs text-white/50">
                  {index + 1} / {total}
                </Text>
                <View className="mt-2 flex-row flex-wrap gap-1.5">
                  {photo.moderation !== "approved" && <Badge>{photo.moderation === "pending" ? "To review" : "Hidden"}</Badge>}
                  {reports > 0 && <Badge alert>⚑ Reported by {plural(reports, "guest")}</Badge>}
                </View>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="h-10 w-10 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
              >
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
            </View>

            <View
              className="absolute left-0 right-0 flex-row items-start justify-around bg-black/55 px-2 pt-3"
              style={{ bottom: 0, paddingBottom: insets.bottom + 10 }}
            >
              <Action
                icon={photo.isFavorite ? "star" : "star-outline"}
                label={photo.isFavorite ? "Favorited" : "Favorite"}
                tint={photo.isFavorite ? colors.gold : "#fff"}
                busy={busy === "favorite"}
                onPress={() => void run(photo, "favorite")}
              />
              {(photo.moderation !== "approved" || reports > 0) && (
                <Action
                  icon="checkmark-circle-outline"
                  label={reports > 0 ? "Keep photo" : "Approve"}
                  tint="#7ee2a8"
                  busy={busy === "approve"}
                  onPress={() => void run(photo, "approve")}
                />
              )}
              {photo.moderation !== "hidden" && (
                <Action icon="eye-off-outline" label="Hide" busy={busy === "hide"} onPress={() => void run(photo, "hide")} />
              )}
              <Action icon="trash-outline" label="Delete" tint={colors.dangerSoft} busy={busy === "delete"} onPress={() => confirmDelete(photo)} />
            </View>
          </>
        );
      }}
    </PhotoPager>
  );
}

function Badge({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <View className={`rounded-full px-2.5 py-1 ${alert ? "bg-danger" : "bg-white/20"}`}>
      <Text className="text-xs font-medium text-white">{children}</Text>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  busy,
  tint = "#fff",
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  busy: boolean;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-w-[72px] items-center gap-1 px-2 py-1 active:opacity-60"
    >
      <View className="h-7 items-center justify-center">
        {busy ? <ActivityIndicator color={tint} /> : <Ionicons name={icon} size={25} color={tint} />}
      </View>
      <Text className="text-xs font-medium text-white/90">{label}</Text>
    </Pressable>
  );
}
