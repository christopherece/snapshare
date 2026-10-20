import Ionicons from "@expo/vector-icons/Ionicons";
import type { PageResponse, PhotoDTO } from "@snapshare/shared";
import { type InfiniteData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { feedKey } from "../hooks/useEventFeed";
import { api } from "../lib/api";

interface Props {
  eventId: string;
  photos: PhotoDTO[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

export function PhotoViewer({ eventId, photos, index, onClose, onIndexChange }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [showComments, setShowComments] = useState(false);
  const current = index !== null ? photos[index] : undefined;

  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black">
        {index !== null && (
          <FlatList
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => onIndexChange(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <DoubleTapLike photo={item} eventId={eventId}>
                <Image
                  source={{ uri: item.displayUrl }}
                  placeholder={{ uri: item.thumbUrl }}
                  style={{ width, height }}
                  contentFit="contain"
                  transition={150}
                />
              </DoubleTapLike>
            )}
          />
        )}

        <View className="absolute left-0 right-0 flex-row items-center justify-between px-5" style={{ top: insets.top + 8 }}>
          <Text className="text-sm text-white/80">{current?.guestName ? `by ${current.guestName}` : ""}</Text>
          <Pressable onPress={onClose} hitSlop={12} className="h-10 w-10 items-center justify-center rounded-full bg-white/15">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>

        {current && (
          <View className="absolute left-0 right-0 flex-row items-center gap-6 px-6" style={{ bottom: insets.bottom + 20 }}>
            <LikeButton photo={current} eventId={eventId} />
            <Pressable onPress={() => setShowComments(true)} className="flex-row items-center gap-2" hitSlop={8}>
              <Ionicons name="chatbubble-outline" size={24} color="#fff" />
            </Pressable>
          </View>
        )}

        {current && showComments && (
          <CommentsSheet photoId={current.id} onClose={() => setShowComments(false)} maxHeight={height * 0.6} />
        )}
      </View>
    </Modal>
  );
}

// ─── Likes (optimistic) ───────────────────────────────────────────────────────

function useLike(photo: PhotoDTO, eventId: string) {
  const qc = useQueryClient();
  const setInCache = (patch: Partial<PhotoDTO>) =>
    qc.setQueryData<InfiniteData<PageResponse<PhotoDTO>>>(feedKey(eventId), (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === photo.id ? { ...i, ...patch } : i)) })),
          }
        : data,
    );

  return useMutation({
    mutationFn: (liked: boolean) => api.setLike(photo.id, liked),
    onMutate: (liked) => {
      const prev = { likedByMe: photo.likedByMe, likeCount: photo.likeCount };
      setInCache({ likedByMe: liked, likeCount: Math.max(0, photo.likeCount + (liked ? 1 : -1)) });
      return prev;
    },
    onError: (_e, _v, prev) => prev && setInCache(prev),
    onSuccess: (res) => setInCache({ likedByMe: res.liked, likeCount: res.likeCount }),
  });
}

function LikeButton({ photo, eventId }: { photo: PhotoDTO; eventId: string }) {
  const like = useLike(photo, eventId);
  return (
    <Pressable
      hitSlop={8}
      className="flex-row items-center gap-2"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        like.mutate(!photo.likedByMe);
      }}
    >
      <Ionicons name={photo.likedByMe ? "heart" : "heart-outline"} size={26} color={photo.likedByMe ? "#ff4d6d" : "#fff"} />
      {photo.likeCount > 0 && <Text className="text-base font-medium text-white">{photo.likeCount}</Text>}
    </Pressable>
  );
}

function DoubleTapLike({ photo, eventId, children }: { photo: PhotoDTO; eventId: string; children: ReactNode }) {
  const like = useLike(photo, eventId);
  const lastTap = useRef(0);
  return (
    <Pressable
      onPress={() => {
        const now = Date.now();
        if (now - lastTap.current < 280 && !photo.likedByMe) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          like.mutate(true);
        }
        lastTap.current = now;
      }}
    >
      {children}
    </Pressable>
  );
}

// ─── Comments ─────────────────────────────────────────────────────────────────

function CommentsSheet({ photoId, onClose, maxHeight }: { photoId: string; onClose: () => void; maxHeight: number }) {
  const insets = useSafeAreaInsets();
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

  useEffect(() => setText(""), [photoId]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="absolute bottom-0 left-0 right-0"
    >
      <Pressable className="absolute -top-[2000px] bottom-0 left-0 right-0" onPress={onClose} />
      <View className="rounded-t-3xl bg-paper px-5 pt-4 dark:bg-ink-soft" style={{ maxHeight, paddingBottom: insets.bottom + 12 }}>
        <View className="mb-3 h-1 w-10 self-center rounded-full bg-black/15 dark:bg-white/20" />
        <FlatList
          data={comments.data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <View className="py-2">
              <Text className="text-xs font-semibold text-ink/60 dark:text-paper/60">{item.guestName ?? "Guest"}</Text>
              <Text className="mt-0.5 text-base text-ink dark:text-paper">{item.body}</Text>
            </View>
          )}
          ListEmptyComponent={<Text className="py-4 text-center text-ink/50 dark:text-paper/50">Say something nice ✨</Text>}
        />
        <View className="mt-2 flex-row items-center gap-2">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Add a comment…"
            placeholderTextColor="#999"
            maxLength={280}
            className="h-11 flex-1 rounded-full bg-paper-dim px-4 text-ink dark:bg-ink dark:text-paper"
          />
          <Pressable
            disabled={!text.trim() || send.isPending}
            onPress={() => send.mutate(text.trim())}
            className="h-11 w-11 items-center justify-center rounded-full bg-ink disabled:opacity-40 dark:bg-paper"
          >
            <Ionicons name="arrow-up" size={20} color="#c8a97e" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
