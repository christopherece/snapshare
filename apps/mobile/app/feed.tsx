import Ionicons from "@expo/vector-icons/Ionicons";
import type { PhotoDTO } from "@snapshare/shared";
import { Redirect, router } from "expo-router";
import { Image } from "expo-image";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PhotoViewer } from "../src/components/PhotoViewer";
import { useEventFeed } from "../src/hooks/useEventFeed";
import { usePendingCount } from "../src/lib/upload-queue";
import { useSession } from "../src/store/session";

const GAP = 2;
const COLUMNS = 3;

export default function FeedScreen() {
  const { event, guestToken } = useSession();
  if (!event || !guestToken) return <Redirect href="/" />;
  return <Feed eventId={event.id} eventName={event.name} guestToken={guestToken} />;
}

function Feed({ eventId, eventName, guestToken }: { eventId: string; eventName: string; guestToken: string }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = (width - GAP * (COLUMNS - 1)) / COLUMNS;
  const feed = useEventFeed(eventId, guestToken);
  const pending = usePendingCount(eventId);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <View className="flex-1 bg-paper dark:bg-ink">
      <View className="flex-row items-center justify-between px-5 pb-3" style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-1">
          <Text className="text-xs font-semibold uppercase tracking-[3px] text-accent">Live gallery</Text>
          <Text numberOfLines={1} className="mt-1 text-2xl font-light text-ink dark:text-paper">
            {eventName}
          </Text>
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back to camera"
          className="h-11 w-11 items-center justify-center rounded-full bg-ink active:opacity-80 dark:bg-paper"
        >
          <Ionicons name="camera" size={20} color="#c8a97e" />
        </Pressable>
      </View>

      {pending > 0 && (
        <View className="mx-5 mb-3 flex-row items-center gap-2 rounded-xl bg-paper-dim px-4 py-2.5 dark:bg-ink-soft">
          <ActivityIndicator size="small" color="#c8a97e" />
          <Text className="text-sm text-ink/70 dark:text-paper/70">
            {pending} photo{pending === 1 ? "" : "s"} waiting to upload — they'll send automatically.
          </Text>
        </View>
      )}

      <FlatList<PhotoDTO>
        data={feed.photos}
        keyExtractor={(p) => p.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 24 }}
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} />}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => setOpenIndex(index)} style={{ width: tile, height: tile }}>
            <Image
              source={{ uri: item.thumbUrl }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={200}
              recyclingKey={item.id}
            />
            {item.likeCount > 0 && (
              <View className="absolute bottom-1.5 left-1.5 flex-row items-center gap-1 rounded-full bg-black/40 px-1.5 py-0.5">
                <Ionicons name="heart" size={10} color="#fff" />
                <Text className="text-[10px] font-medium text-white">{item.likeCount}</Text>
              </View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          feed.isLoading ? (
            <ActivityIndicator className="mt-20" color="#c8a97e" />
          ) : (
            <View className="mt-24 items-center px-10">
              <Ionicons name="sparkles-outline" size={32} color="#c8a97e" />
              <Text className="mt-4 text-center text-base text-ink/60 dark:text-paper/60">
                No photos yet. Be the first to capture the moment!
              </Text>
            </View>
          )
        }
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator className="my-6" color="#c8a97e" /> : undefined}
      />

      <PhotoViewer
        eventId={eventId}
        photos={feed.photos}
        index={openIndex}
        onClose={() => setOpenIndex(null)}
        onIndexChange={setOpenIndex}
      />
    </View>
  );
}
