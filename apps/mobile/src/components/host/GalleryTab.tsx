import Ionicons from "@expo/vector-icons/Ionicons";
import type { PhotoDTO } from "@snapshare/shared";
import { Image } from "expo-image";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHostGallery } from "../../hooks/useHostGallery";
import type { HostEvent, PhotoFilter } from "../../lib/host-api";
import { errorMessage } from "../../lib/http";
import { colors, useTheme } from "../../theme";
import { Button, Chip, EmptyState, Loading } from "../ui";
import { HostPhotoViewer } from "./HostPhotoViewer";

const GAP = 2;
const COLUMNS = 3;

/** The event's photos with live updates and moderation. */
export function GalleryTab({ event, header, onRefresh }: { event: HostEvent; header?: ReactNode; onRefresh: () => Promise<unknown> }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  // Open on whatever needs the host's attention first.
  const [filter, setFilter] = useState<PhotoFilter>(() => (event.reportedCount ? "reported" : event.pendingCount ? "pending" : "all"));
  const [reportAlert, setReportAlert] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const gallery = useHostGallery(event.id, filter, setReportAlert);

  const loadMore = () => {
    if (gallery.hasNextPage && !gallery.isFetchingNextPage) void gallery.fetchNextPage();
  };

  const chips: { key: PhotoFilter; label: string; count?: number; alert?: boolean }[] = [
    { key: "all", label: "All", count: event.photoCount },
    { key: "pending", label: "To review", count: event.pendingCount },
    { key: "favorites", label: "Favorites", count: event.favoriteCount },
    { key: "hidden", label: "Hidden", count: event.hiddenCount },
    ...(event.reportedCount || filter === "reported"
      ? [{ key: "reported" as const, label: "⚑ Reported", count: event.reportedCount, alert: true }]
      : []),
  ];

  const top = (
    <View>
      {header}
      {reportAlert && (
        <View accessibilityRole="alert" className="mx-5 mb-3 flex-row items-center gap-3 rounded-2xl bg-danger/10 py-2 pl-4 pr-2 dark:bg-danger-soft/15">
          <Text className="flex-1 text-sm leading-5 text-danger dark:text-danger-soft">⚑ {reportAlert}</Text>
          <Button
            label="Review"
            size="md"
            variant="secondary"
            onPress={() => {
              setFilter("reported");
              setReportAlert(null);
            }}
          />
          <Pressable onPress={() => setReportAlert(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss" className="p-1.5">
            <Ionicons name="close" size={18} color={theme.danger} />
          </Pressable>
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingBottom: 12, alignItems: "center" }}>
        {chips.map((c) => (
          <Chip
            key={c.key}
            label={c.label}
            count={c.count || undefined}
            selected={filter === c.key}
            alert={c.alert}
            onPress={() => setFilter(c.key)}
          />
        ))}
        <View className="ml-1 flex-row items-center gap-1.5" accessibilityLabel="Live — new photos appear automatically">
          <View className="h-2 w-2 rounded-full bg-emerald-500" />
          <Text className="text-xs font-medium text-muted dark:text-muted-dark">Live</Text>
        </View>
      </ScrollView>
    </View>
  );

  return (
    <View className="flex-1">
      <FlatList<PhotoDTO>
        data={gallery.photos}
        keyExtractor={(p) => p.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={top}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            tintColor={theme.accent}
            colors={[colors.goldDeep]}
            onRefresh={() => {
              setPulling(true);
              void Promise.allSettled([gallery.refetch(), onRefresh()]).finally(() => setPulling(false));
            }}
          />
        }
        renderItem={({ item }) => {
          const reports = item.reportCount ?? 0;
          return (
            <Pressable
              onPress={() => setOpenId(item.id)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Photo by ${item.guestName ?? "a guest"}${item.moderation === "pending" ? ", to review" : item.moderation === "hidden" ? ", hidden" : ""}${reports ? ", reported" : ""}`}
              style={{ width: tile, height: tile }}
              className="bg-ink/5 dark:bg-white/5"
            >
              <Image
                source={{ uri: item.thumbUrl }}
                style={{ width: "100%", height: "100%", opacity: item.moderation === "hidden" ? 0.45 : 1 }}
                contentFit="cover"
                transition={200}
                recyclingKey={item.id}
              />
              <View className="absolute left-1.5 top-1.5 gap-1">
                {item.moderation !== "approved" && (
                  <View className={`self-start rounded-full px-1.5 py-0.5 ${item.moderation === "pending" ? "bg-accent" : "bg-black/60"}`}>
                    <Text className={`text-[10px] font-semibold ${item.moderation === "pending" ? "text-ink" : "text-white"}`}>
                      {item.moderation === "pending" ? "To review" : "Hidden"}
                    </Text>
                  </View>
                )}
                {reports > 0 && (
                  <View className="self-start rounded-full bg-danger px-1.5 py-0.5">
                    <Text className="text-[10px] font-semibold text-white">⚑ {reports}</Text>
                  </View>
                )}
              </View>
              {item.isFavorite && (
                <View className="absolute right-1.5 top-1.5 h-5 w-5 items-center justify-center rounded-full bg-black/45">
                  <Ionicons name="star" size={12} color={colors.gold} />
                </View>
              )}
              {item.likeCount > 0 && (
                <View className="absolute bottom-1.5 left-1.5 flex-row items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5">
                  <Ionicons name="heart" size={10} color="#fff" />
                  <Text className="text-[10px] font-medium text-white">{item.likeCount}</Text>
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          gallery.isPending ? (
            <Loading />
          ) : gallery.isError ? (
            <EmptyState icon="cloud-offline-outline" title="Couldn't load the photos" body={errorMessage(gallery.error, "Please try again.")}>
              <Button label="Try again" variant="secondary" onPress={() => void gallery.refetch()} />
            </EmptyState>
          ) : (
            <EmptyState
              icon={filter === "pending" ? "checkmark-done-outline" : "images-outline"}
              title={filter === "pending" ? "All caught up" : "No photos here yet"}
              body={filter === "all" ? "Photos appear here the moment guests take them." : "Nothing in this view right now."}
            />
          )
        }
        ListFooterComponent={gallery.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.accent} /> : undefined}
      />

      <HostPhotoViewer photos={gallery.photos} openId={openId} onClose={() => setOpenId(null)} onEndReached={loadMore} act={gallery.act} />
    </View>
  );
}
