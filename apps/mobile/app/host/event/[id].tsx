import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GalleryTab } from "../../../src/components/host/GalleryTab";
import { SettingsTab } from "../../../src/components/host/SettingsTab";
import { ShareTab } from "../../../src/components/host/ShareTab";
import { Button, EmptyState, Heading, IconButton, Loading, Notice, TopBar } from "../../../src/components/ui";
import { daysUntil, formatDate, formatLongDate, plural } from "../../../src/lib/format";
import { type HostEvent, hostApi, hostKeys, type Me } from "../../../src/lib/host-api";
import { ApiError, errorMessage } from "../../../src/lib/http";

const TABS = [
  ["photos", "Photos"],
  ["share", "Share"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function HostEventScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("photos");
  const me = useQuery({ queryKey: hostKeys.me, queryFn: hostApi.me });
  const event = useQuery({ queryKey: hostKeys.event(id), queryFn: () => hostApi.event(id) });

  // A one-event account never sees the list (it redirects here), so "back" leaves the host area.
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(me.data?.eventLimit === 1 ? "/" : "/host");
  };

  const bar = (
    <View className="px-3">
      <TopBar
        onBack={back}
        backLabel={me.data?.eventLimit === 1 ? "Back" : "All events"}
        right={<IconButton icon="person-circle-outline" label="Account" size={26} onPress={() => router.push("/host/account")} />}
      />
    </View>
  );

  const data = event.data;
  if (!data) {
    const missing = event.error instanceof ApiError && (event.error.status === 404 || event.error.status === 403);
    return (
      <View className="flex-1 bg-paper dark:bg-ink-deep" style={{ paddingTop: insets.top }}>
        {bar}
        {event.isError ? (
          <EmptyState
            icon={missing ? "help-circle-outline" : "cloud-offline-outline"}
            title={missing ? "This event isn't available" : "Couldn't load the event"}
            body={missing ? "It may have been removed, or it belongs to another account." : errorMessage(event.error, "Please try again.")}
          >
            {missing ? (
              <Button label="All events" variant="secondary" onPress={() => router.replace("/host")} />
            ) : (
              <Button label="Try again" variant="secondary" onPress={() => void event.refetch()} />
            )}
          </EmptyState>
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  const header = (
    <View className="px-5 pb-4">
      <Heading numberOfLines={3}>{data.name}</Heading>
      <Text className="mt-1 text-sm text-muted dark:text-muted-dark">
        {[formatDate(data.startsAt), data.location].filter(Boolean).join(" · ") || "No date set"}
        {"  ·  "}
        {plural(data.photoCount ?? 0, "photo")}
      </Text>
      <Notices event={data} me={me.data} />
      <View accessibilityRole="tablist" className="mt-4 flex-row rounded-2xl bg-ink/5 p-1 dark:bg-white/10">
        {TABS.map(([key, label]) => {
          const selected = tab === key;
          const attention = key === "photos" && !selected && (data.pendingCount ?? 0) + (data.reportedCount ?? 0) > 0;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              className={`h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl ${selected ? "bg-white dark:bg-ink-soft" : ""}`}
            >
              <Text className={`text-sm font-semibold ${selected ? "text-ink dark:text-paper" : "text-muted dark:text-muted-dark"}`}>{label}</Text>
              {attention && <View className="h-2 w-2 rounded-full bg-accent" />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View className="flex-1 bg-paper dark:bg-ink-deep" style={{ paddingTop: insets.top }}>
      {bar}
      {tab === "photos" ? (
        <GalleryTab event={data} header={header} onRefresh={() => event.refetch()} />
      ) : tab === "share" ? (
        <ShareTab event={data} header={header} />
      ) : (
        <SettingsTab event={data} header={header} />
      )}
    </View>
  );
}

function Notices({ event, me }: { event: HostEvent; me: Me | undefined }) {
  const bold = "font-semibold";
  const days = event.keepUntil ? daysUntil(event.keepUntil) : null;
  const until = formatLongDate(event.keepUntil);
  const managing = me?.role === "admin" && event.owner && event.owner.id !== me.id ? event.owner : null;

  if (!managing && !event.suspended && days === null) return null;
  return (
    <View className="mt-4 gap-2">
      {managing && (
        <Notice>
          You're managing <Text className={bold}>{managing.name}</Text>'s event ({managing.email}) as admin.
        </Notice>
      )}
      {event.suspended && (
        <Notice tone="error">
          This event is <Text className={bold}>suspended</Text>: guests, the slideshow and the customer can't access it. Restore it from
          Admin → Events on the web.
        </Notice>
      )}
      {days !== null &&
        (days <= 14 ? (
          <Notice tone="warn">
            {days > 0 ? (
              <>
                Your gallery period ends on <Text className={bold}>{until}</Text> (in {plural(days, "day")}).
              </>
            ) : (
              <>
                Your gallery period <Text className={bold}>ended on {until}</Text>.
              </>
            )}{" "}
            After that the gallery can be deleted. Download your photos now, or ask us to keep it longer.
          </Notice>
        ) : (
          <Notice>
            Your gallery is kept until <Text className={bold}>{until}</Text>. Download your photos before then to keep them.
          </Notice>
        ))}
    </View>
  );
}
