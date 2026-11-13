import Ionicons from "@expo/vector-icons/Ionicons";
import type { EventPublicDTO, PhotoDTO } from "@snapshare/shared";
import { Image } from "expo-image";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PhotoViewer } from "../src/components/PhotoViewer";
import { Button, EmptyState, Heading, Kicker, Loading, Notice } from "../src/components/ui";
import { isSessionEnded, useEventFeed } from "../src/hooks/useEventFeed";
import { plural } from "../src/lib/format";
import { errorMessage } from "../src/lib/http";
import { useBlockedCount, usePendingCount, useUploadQueue } from "../src/lib/upload-queue";
import { useSession } from "../src/store/session";
import { colors, useTheme } from "../src/theme";

const GAP = 2;
const COLUMNS = 3;

export default function FeedScreen() {
  const { event, guestToken } = useSession();
  if (!event || !guestToken) return <Redirect href="/" />;
  return <Feed event={event} guestToken={guestToken} />;
}

function Feed({ event, guestToken }: { event: EventPublicDTO; guestToken: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  const feed = useEventFeed(event.id, guestToken);
  const pending = usePendingCount(event.id);
  const blocked = useBlockedCount(event.id);
  const online = useUploadQueue((s) => s.online);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const loadMore = () => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  };
  const rejoin = () => router.push({ pathname: "/join/[slug]", params: { slug: event.slug, rejoin: "1" } });
  const ended = feed.isError && isSessionEnded(feed.error);

  return (
    <View className="flex-1 bg-paper dark:bg-ink-deep">
      <View className="flex-row items-center justify-between px-5 pb-3" style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-1 pr-3">
          <Kicker>Live gallery</Kicker>
          <Heading size="md" numberOfLines={1} className="mt-0.5">
            {event.name}
          </Heading>
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to camera"
          className="h-12 w-12 items-center justify-center rounded-full bg-ink active:opacity-80 dark:bg-paper"
        >
          <Ionicons name="camera" size={21} color={theme.dark ? colors.goldDeep : colors.gold} />
        </Pressable>
      </View>

      {blocked > 0 ? (
        <Pressable onPress={rejoin} accessibilityRole="button" className="mx-5 mb-3">
          <Notice tone="warn">
            {plural(blocked, "photo")} couldn't upload. <Text className="font-semibold underline">Rejoin the event</Text> to send{" "}
            {blocked === 1 ? "it" : "them"}.
          </Notice>
        </Pressable>
      ) : (
        pending > 0 && (
          <View className="mx-5 mb-3 flex-row items-center gap-2.5 rounded-2xl bg-ink/5 px-4 py-3 dark:bg-white/10">
            {online ? <ActivityIndicator size="small" color={theme.accent} /> : <Ionicons name="cloud-offline-outline" size={18} color={theme.fg} />}
            <Text className="flex-1 text-sm leading-5 text-ink dark:text-paper">
              {online
                ? `Uploading ${plural(pending, "photo")}…`
                : `You're offline. ${plural(pending, "photo")} saved — ${pending === 1 ? "it'll" : "they'll"} upload automatically.`}
            </Text>
          </View>
        )
      )}

      {ended ? (
        <EmptyState
          icon="time-outline"
          title="Your place here has ended"
          body="The event may have closed, or your session expired. If it's still running you can join again."
        >
          <Button label="Rejoin the event" onPress={rejoin} />
        </EmptyState>
      ) : feed.isPending ? (
        <Loading label="Loading the gallery…" />
      ) : feed.isError && !feed.photos.length ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn't load the gallery" body={errorMessage(feed.error, "Please try again.")}>
          <Button label="Try again" variant="secondary" onPress={() => void feed.refetch()} />
        </EmptyState>
      ) : (
        <FlatList<PhotoDTO>
          data={feed.photos}
          keyExtractor={(p) => p.id}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              tintColor={theme.accent}
              colors={[colors.goldDeep]}
              onRefresh={() => {
                setPulling(true);
                void feed.refetch().finally(() => setPulling(false));
              }}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setOpenId(item.id)}
              accessibilityRole="imagebutton"
              accessibilityLabel={item.guestName ? `Photo by ${item.guestName}` : "Photo"}
              style={{ width: tile, height: tile }}
              className="bg-ink/5 dark:bg-white/5"
            >
              <Image
                source={{ uri: item.thumbUrl }}
                style={{ width: "100%", height: "100%" }}
                contentFit="cover"
                transition={200}
                recyclingKey={item.id}
              />
              {item.likeCount > 0 && (
                <View className="absolute bottom-1.5 left-1.5 flex-row items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5">
                  <Ionicons name="heart" size={10} color={item.likedByMe ? colors.heart : "#fff"} />
                  <Text className="text-[10px] font-medium text-white">{item.likeCount}</Text>
                </View>
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState icon="sparkles-outline" title="No photos yet" body="Be the first to capture the moment — your photos appear here as soon as they upload.">
              <Button label="Open the camera" icon="camera" onPress={() => router.back()} />
            </EmptyState>
          }
          ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.accent} /> : undefined}
        />
      )}

      <PhotoViewer eventId={event.id} photos={feed.photos} openId={openId} onClose={() => setOpenId(null)} onEndReached={loadMore} />
    </View>
  );
}
