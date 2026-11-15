import Ionicons from "@expo/vector-icons/Ionicons";
import type { PhotoDTO } from "@snapshare/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ModerationAction } from "../../hooks/useHostGallery";
import { plural } from "../../lib/format";
import { hostApi, hostKeys } from "../../lib/host-api";
import { errorMessage } from "../../lib/http";
import { colors, useTheme } from "../../theme";
import { PhotoPager } from "../PhotoPager";
import { type IconName, Notice, Sheet } from "../ui";

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
  const qc = useQueryClient();
  const [busy, setBusy] = useState<ModerationAction | null>(null);
  const [panel, setPanel] = useState<"comments" | "more" | null>(null);

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

  // Block whoever took this photo; their photos turn "Hidden" as the live updates arrive.
  const removeGuest = (photo: PhotoDTO) =>
    Alert.alert(
      `Remove ${photo.guestName ?? "this guest"}?`,
      "They'll be signed out of the event and can't rejoin from their phone. All of their photos and comments will be hidden.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove guest",
          style: "destructive",
          onPress: () => {
            setPanel(null);
            hostApi
              .removeGuest(photo.id)
              .then((res) => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                void qc.invalidateQueries({ queryKey: hostKeys.allPhotos(photo.eventId) });
                void qc.invalidateQueries({ queryKey: hostKeys.event(photo.eventId) });
                Alert.alert("Guest removed", `${plural(res.photosHidden, "photo")} hidden.`);
              })
              .catch((err) => Alert.alert("That didn't work", errorMessage(err, "Please try again.")));
          },
        },
      ],
    );

  const close = () => {
    setPanel(null);
    onClose();
  };

  return (
    <PhotoPager photos={photos} openId={openId} onClose={close} onEndReached={onEndReached}>
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
              <View className="flex-row gap-2">
                <TopButton icon="chatbubble-outline" label="Comments" onPress={() => setPanel("comments")} />
                <TopButton icon="ellipsis-horizontal" label="More" onPress={() => setPanel("more")} />
                <TopButton icon="close" label="Close" onPress={close} />
              </View>
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

            <Sheet inline visible={panel === "comments"} onClose={() => setPanel(null)} title="Comments">
              <HostComments key={photo.id} photoId={photo.id} />
            </Sheet>
            <Sheet inline visible={panel === "more"} onClose={() => setPanel(null)} title={photo.guestName ?? "Guest"}>
              <Pressable
                onPress={() => removeGuest(photo)}
                accessibilityRole="button"
                className="flex-row items-center gap-3.5 rounded-2xl border border-danger/30 px-4 py-3.5 active:opacity-70 dark:border-danger-soft/40"
              >
                <Ionicons name="person-remove-outline" size={21} color={colors.dangerSoft} />
                <View className="flex-1">
                  <Text className="text-base font-medium text-danger dark:text-danger-soft">Remove this guest</Text>
                  <Text className="mt-0.5 text-sm text-muted dark:text-muted-dark">Sign them out and hide all their photos and comments</Text>
                </View>
              </Pressable>
            </Sheet>
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

function TopButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
    >
      <Ionicons name={icon} size={20} color="#fff" />
    </Pressable>
  );
}

/** Every comment on the photo, including ones guests reported (hidden from them), with delete. */
function HostComments({ photoId }: { photoId: string }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const { height } = useWindowDimensions();
  const comments = useQuery({ queryKey: hostKeys.comments(photoId), queryFn: () => hostApi.comments(photoId), staleTime: 0 });
  const remove = useMutation({
    mutationFn: hostApi.deleteComment,
    onSuccess: () => void qc.invalidateQueries({ queryKey: hostKeys.comments(photoId) }),
    onError: (err) => Alert.alert("That didn't work", errorMessage(err, "Please try again.")),
  });

  if (comments.isPending) return <ActivityIndicator color={theme.accent} style={{ paddingVertical: 20 }} />;
  if (comments.isError) return <Notice tone="error">{errorMessage(comments.error, "Couldn't load comments.")}</Notice>;
  return (
    <FlatList
      data={comments.data}
      style={{ maxHeight: height * 0.45 }}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => (
        <View className="flex-row items-start gap-3 py-2">
          <View className="flex-1">
            <Text className="text-xs font-semibold text-muted dark:text-muted-dark">
              {item.guestName ?? "Guest"}
              {item.hidden ? "  ·  Reported, hidden from guests" : ""}
            </Text>
            <Text className={`mt-0.5 text-base leading-6 text-ink dark:text-paper ${item.hidden ? "opacity-60" : ""}`}>{item.body}</Text>
          </View>
          <Pressable
            onPress={() =>
              Alert.alert("Delete this comment?", undefined, [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => remove.mutate(item.id) },
              ])
            }
            disabled={remove.isPending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete comment"
            className="p-1.5"
          >
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
          </Pressable>
        </View>
      )}
      ListEmptyComponent={<Text className="py-4 text-center text-muted dark:text-muted-dark">No comments on this photo.</Text>}
    />
  );
}
