import Ionicons from "@expo/vector-icons/Ionicons";
import type { PhotoDTO, ReportReason } from "@snapshare/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { patchFeed } from "../hooks/useEventFeed";
import { api } from "../lib/api";
import { errorMessage } from "../lib/http";
import { colors, useTheme } from "../theme";
import { PhotoPager } from "./PhotoPager";
import { Button, Notice, Sheet } from "./ui";

interface Props {
  eventId: string;
  photos: PhotoDTO[];
  /** The photo to open on; null keeps the viewer closed. */
  openId: string | null;
  onClose: () => void;
  onEndReached?: () => void;
}

type Panel = "comments" | "report" | null;

/** The guest's full-screen viewer: swipe through the gallery, like, comment, or report a photo to the host. */
export function PhotoViewer({ eventId, photos, openId, onClose, onEndReached }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [panel, setPanel] = useState<Panel>(null);
  const like = useLike(eventId);

  useEffect(() => {
    if (openId === null) setPanel(null);
  }, [openId]);

  return (
    <PhotoPager
      photos={photos}
      openId={openId}
      onClose={onClose}
      onEndReached={onEndReached}
      onDoubleTap={(photo) => {
        if (!photo.likedByMe) like.mutate({ photo, liked: true });
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return true;
      }}
    >
      {(photo, { index, total }) => (
        <>
          <View className="absolute left-0 right-0 flex-row items-center justify-between px-5" style={{ top: insets.top + 8 }}>
            <View className="flex-1 pr-3">
              {photo.guestName && (
                <Text numberOfLines={1} className="text-sm font-medium text-white/90">
                  by {photo.guestName}
                </Text>
              )}
              <Text className="text-xs text-white/50">
                {index + 1} / {total}
              </Text>
            </View>
            <RoundButton icon="close" label="Close" onPress={onClose} />
          </View>

          <View
            className="absolute left-0 right-0 flex-row items-center justify-between px-6"
            style={{ bottom: insets.bottom + 20 }}
          >
            <View className="flex-row items-center gap-6">
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={photo.likedByMe ? "Unlike" : "Like"}
                className="flex-row items-center gap-2"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  like.mutate({ photo, liked: !photo.likedByMe });
                }}
              >
                <Ionicons
                  name={photo.likedByMe ? "heart" : "heart-outline"}
                  size={28}
                  color={photo.likedByMe ? colors.heart : "#fff"}
                />
                {photo.likeCount > 0 && <Text className="text-base font-medium text-white">{photo.likeCount}</Text>}
              </Pressable>
              <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel="Comments" onPress={() => setPanel("comments")}>
                <Ionicons name="chatbubble-outline" size={25} color="#fff" />
              </Pressable>
            </View>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Report this photo"
              className="flex-row items-center gap-1.5"
              onPress={() => setPanel("report")}
            >
              <Ionicons name="flag-outline" size={20} color="rgba(255,255,255,0.7)" />
              <Text className="text-sm text-white/70">Report</Text>
            </Pressable>
          </View>

          <Sheet inline visible={panel === "comments"} onClose={() => setPanel(null)} title="Comments">
            <Comments key={photo.id} photoId={photo.id} maxHeight={height * 0.45} />
          </Sheet>
          <Sheet inline visible={panel === "report"} onClose={() => setPanel(null)} title="Report this photo">
            <ReportForm key={photo.id} photoId={photo.id} onDone={() => setPanel(null)} />
          </Sheet>
        </>
      )}
    </PhotoPager>
  );
}

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
    >
      <Ionicons name={icon} size={22} color="#fff" />
    </Pressable>
  );
}

// ─── Likes (optimistic) ───────────────────────────────────────────────────────

function useLike(eventId: string) {
  const qc = useQueryClient();
  const setInCache = (photoId: string, patch: Partial<PhotoDTO>) =>
    patchFeed(qc, eventId, (items) => items.map((i) => (i.id === photoId ? { ...i, ...patch } : i)));

  return useMutation({
    mutationFn: ({ photo, liked }: { photo: PhotoDTO; liked: boolean }) => api.setLike(photo.id, liked),
    onMutate: ({ photo, liked }) => {
      setInCache(photo.id, { likedByMe: liked, likeCount: Math.max(0, photo.likeCount + (liked ? 1 : -1)) });
      return { likedByMe: photo.likedByMe, likeCount: photo.likeCount };
    },
    onError: (_e, { photo }, prev) => prev && setInCache(photo.id, prev),
    onSuccess: (res, { photo }) => setInCache(photo.id, { likedByMe: res.liked, likeCount: res.likeCount }),
  });
}

// ─── Comments ─────────────────────────────────────────────────────────────────

function Comments({ photoId, maxHeight }: { photoId: string; maxHeight: number }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const comments = useQuery({ queryKey: ["comments", photoId], queryFn: () => api.getComments(photoId) });
  const send = useMutation({
    mutationFn: (body: string) => api.addComment(photoId, body),
    onSuccess: () => {
      setText("");
      void qc.invalidateQueries({ queryKey: ["comments", photoId] });
    },
  });

  return (
    <View>
      {comments.isPending ? (
        <ActivityIndicator color={theme.accent} style={{ paddingVertical: 20 }} />
      ) : comments.isError ? (
        <Notice tone="error">{errorMessage(comments.error, "Couldn't load comments.")}</Notice>
      ) : (
        <FlatList
          data={comments.data}
          style={{ maxHeight }}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View className="py-2">
              <Text className="text-xs font-semibold text-muted dark:text-muted-dark">{item.guestName ?? "Guest"}</Text>
              <Text className="mt-0.5 text-base leading-6 text-ink dark:text-paper">{item.body}</Text>
            </View>
          )}
          ListEmptyComponent={<Text className="py-4 text-center text-muted dark:text-muted-dark">Say something nice ✨</Text>}
        />
      )}

      {send.isError && (
        <Notice tone="error" className="mt-2">
          {errorMessage(send.error, "Couldn't post your comment.")}
        </Notice>
      )}
      <View className="mt-3 flex-row items-center gap-2">
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Add a comment…"
          placeholderTextColor={theme.placeholder}
          selectionColor={colors.gold}
          maxLength={280}
          returnKeyType="send"
          onSubmitEditing={() => text.trim() && !send.isPending && send.mutate(text.trim())}
          accessibilityLabel="Add a comment"
          className="h-11 flex-1 rounded-full border border-ink/10 bg-white px-4 text-base text-ink dark:border-white/10 dark:bg-ink dark:text-paper"
        />
        <Pressable
          disabled={!text.trim() || send.isPending}
          onPress={() => send.mutate(text.trim())}
          accessibilityRole="button"
          accessibilityLabel="Send comment"
          className={`h-11 w-11 items-center justify-center rounded-full bg-ink dark:bg-paper ${!text.trim() || send.isPending ? "opacity-40" : ""}`}
        >
          <Ionicons name="arrow-up" size={20} color={colors.gold} />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Report to the host ───────────────────────────────────────────────────────

const REASONS: { value: ReportReason; title: string; detail: string }[] = [
  { value: "me", title: "I'm in this photo", detail: "and I'd like it removed" },
  { value: "inappropriate", title: "It's inappropriate", detail: "offensive, explicit or unkind" },
  { value: "other", title: "Something else", detail: "the host will take a look" },
];

function ReportForm({ photoId, onDone }: { photoId: string; onDone: () => void }) {
  const theme = useTheme();
  const report = useMutation({ mutationFn: (reason: ReportReason) => api.reportPhoto(photoId, reason) });

  if (report.isSuccess) {
    return (
      <View>
        <Notice tone="success">Thanks — the host has been told and will take a look.</Notice>
        <Button label="Done" onPress={onDone} className="mt-4" />
      </View>
    );
  }

  return (
    <View>
      {REASONS.map((r) => (
        <Pressable
          key={r.value}
          disabled={report.isPending}
          onPress={() => report.mutate(r.value)}
          accessibilityRole="button"
          accessibilityLabel={`${r.title} — ${r.detail}`}
          className="mb-2.5 flex-row items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 active:opacity-70 dark:border-white/10 dark:bg-ink"
        >
          <View className="flex-1">
            <Text className="text-base font-medium text-ink dark:text-paper">{r.title}</Text>
            <Text className="mt-0.5 text-sm text-muted dark:text-muted-dark">{r.detail}</Text>
          </View>
          {report.isPending && report.variables === r.value ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={theme.muted} />
          )}
        </Pressable>
      ))}
      {report.isError && <Notice tone="error">{errorMessage(report.error, "Couldn't send your report.")}</Notice>}
      <Text className="mt-2 text-center text-xs text-muted dark:text-muted-dark">
        Only the host sees reports. Your name isn't shared.
      </Text>
    </View>
  );
}
