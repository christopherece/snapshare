import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { formatDate, plural } from "../../src/lib/format";
import { type HostEvent, hostApi, hostKeys } from "../../src/lib/host-api";
import { errorMessage } from "../../src/lib/http";
import { goHome } from "../../src/lib/launch";
import { useSession } from "../../src/store/session";
import { colors, useTheme } from "../../src/theme";
import { Button, EmptyState, Heading, IconButton, Kicker, Loading, Notice, Screen, TopBar } from "../../src/components/ui";

export default function HostEvents() {
  const theme = useTheme();
  const setMode = useSession((s) => s.setMode);
  const [pulling, setPulling] = useState(false);
  const me = useQuery({ queryKey: hostKeys.me, queryFn: hostApi.me });
  const events = useQuery({ queryKey: hostKeys.events, queryFn: hostApi.events });

  // The app reopens on the side that was used last.
  useEffect(() => setMode("host"), [setMode]);

  const bar = (
    <TopBar
      onBack={goHome}
      backIcon="close"
      backLabel="Back to the start"
      right={<IconButton icon="person-circle-outline" label="Account" size={26} onPress={() => router.push("/host/account")} />}
    />
  );

  if (me.isPending || events.isPending) {
    return (
      <Screen>
        {bar}
        <Loading />
      </Screen>
    );
  }

  if (me.isError || events.isError) {
    return (
      <Screen>
        {bar}
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your events"
          body={errorMessage(me.error ?? events.error, "Check your connection and try again.")}
        >
          <Button label="Try again" variant="secondary" onPress={() => void Promise.all([me.refetch(), events.refetch()])} />
        </EmptyState>
      </Screen>
    );
  }

  const list = events.data;
  const { eventLimit, role } = me.data;
  const single = eventLimit === 1;
  const atLimit = eventLimit !== null && list.length >= eventLimit;

  // A one-event account has nothing to choose between — go straight to the event.
  if (single && list.length === 1 && !list[0].suspended) {
    return <Redirect href={{ pathname: "/host/event/[id]", params: { id: list[0].id } }} />;
  }

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          tintColor={theme.accent}
          colors={[colors.goldDeep]}
          onRefresh={() => {
            setPulling(true);
            void Promise.all([me.refetch(), events.refetch()]).finally(() => setPulling(false));
          }}
        />
      }
    >
      {bar}
      <View className="mt-2 flex-row items-end justify-between gap-3">
        <View className="flex-1">
          <Kicker>{role === "admin" ? "Your events" : "Welcome"}</Kicker>
          <Heading className="mt-1">{single ? "Your event" : "Events"}</Heading>
        </View>
        {!atLimit && list.length > 0 && <Button label="New event" icon="add" size="md" onPress={() => router.push("/host/new")} />}
      </View>

      {list.some((e) => e.suspended) && role !== "admin" && (
        <Notice tone="warn" className="mt-5">
          Your event has been suspended. Please contact the organiser.
        </Notice>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon="qr-code-outline"
          title={single ? "Set up your event" : "No events yet"}
          body="Create your event to get a QR code guests can scan."
        >
          <Button label="Create my event" onPress={() => router.push("/host/new")} />
        </EmptyState>
      ) : (
        <View className="mt-6 gap-3">
          {list.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function EventCard({ event }: { event: HostEvent }) {
  const when = [formatDate(event.startsAt), event.location].filter(Boolean).join(" · ") || "No date set";
  const toReview = event.pendingCount ?? 0;
  return (
    <Pressable
      disabled={event.suspended}
      onPress={() => router.push({ pathname: "/host/event/[id]", params: { id: event.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${event.name}, ${when}, ${plural(event.photoCount ?? 0, "photo")}${event.suspended ? ", suspended" : ""}`}
      accessibilityState={{ disabled: event.suspended }}
      className={`rounded-3xl border border-ink/5 bg-white p-5 active:opacity-80 dark:border-white/10 dark:bg-ink-soft ${event.suspended ? "opacity-60" : ""}`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text numberOfLines={2} className="flex-1 font-serif text-2xl leading-8 text-ink dark:text-paper">
          {event.name}
        </Text>
        {toReview > 0 && (
          <View className="mt-1 rounded-full bg-accent px-2.5 py-1">
            <Text className="text-xs font-semibold text-ink">{toReview} to review</Text>
          </View>
        )}
      </View>
      <Text className="mt-1 text-sm text-muted dark:text-muted-dark">{when}</Text>
      <View className="mt-4 flex-row flex-wrap items-center gap-x-3 gap-y-2">
        <Text className="text-sm font-medium text-ink dark:text-paper">{plural(event.photoCount ?? 0, "photo")}</Text>
        <Text className="text-sm tracking-[1.5px] text-muted dark:text-muted-dark">{event.slug.toUpperCase()}</Text>
        {event.suspended ? <Tag alert>Suspended</Tag> : !event.uploadsOpen && <Tag>Closed</Tag>}
      </View>
    </Pressable>
  );
}

function Tag({ children, alert = false }: { children: string; alert?: boolean }) {
  return (
    <View className={`rounded-full px-2.5 py-0.5 ${alert ? "bg-danger/10 dark:bg-danger-soft/15" : "bg-ink/10 dark:bg-white/15"}`}>
      <Text className={`text-xs font-medium ${alert ? "text-danger dark:text-danger-soft" : "text-ink dark:text-paper"}`}>{children}</Text>
    </View>
  );
}
