import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Logo } from "../src/components/LogoMark";
import { Button, Divider, LegalLinks, Row, Screen } from "../src/components/ui";
import { plural } from "../src/lib/format";
import { launch } from "../src/lib/launch";
import { usePendingCount } from "../src/lib/upload-queue";
import { useHostAuth } from "../src/store/host";
import { useSession } from "../src/store/session";
import { colors, useTheme } from "../src/theme";

/** Home: join an event as a guest, or manage one as its host. */
export default function HomeScreen() {
  const theme = useTheme();
  const { event, guestToken, mode } = useSession();
  const hostToken = useHostAuth((s) => s.token);
  const pending = usePendingCount(event?.id);

  // Cold start only: pick up where the person left off.
  const [resume] = useState(() => {
    if (launch.handled) return null;
    if (mode === "guest" && event && guestToken) return "/camera" as const;
    if (mode === "host" && hostToken) return "/host" as const;
    return null;
  });
  if (resume) return <Redirect href={resume} />;

  const joined = !!event && !!guestToken;

  return (
    <Screen scroll>
      <View className="pt-6">
        <Logo />
      </View>

      <View className="flex-1 justify-center py-10">
        <Text accessibilityRole="header" className="font-serif text-5xl leading-[54px] text-ink dark:text-paper">
          Every guest's photos.{"\n"}
          <Text className="font-serif-italic text-accent-deep dark:text-accent">One live album.</Text>
        </Text>
        <Text className="mt-4 text-base leading-6 text-muted dark:text-muted-dark">
          Scan the QR code at the event, take photos, and watch them appear live — in the gallery and on the big screen.
        </Text>

        {joined && (
          <Pressable
            onPress={() => router.push("/camera")}
            accessibilityRole="button"
            accessibilityLabel={`Continue at ${event.name}`}
            className="mt-8 flex-row items-center gap-4 rounded-3xl bg-ink p-5 active:opacity-90 dark:bg-ink-soft"
          >
            <View className="h-12 w-12 items-center justify-center rounded-full bg-white/10">
              <Ionicons name="camera" size={22} color={colors.gold} />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-semibold uppercase tracking-[2px] text-accent">Continue at</Text>
              <Text numberOfLines={1} className="mt-0.5 font-serif text-2xl text-paper">
                {event.name}
              </Text>
              {pending > 0 && <Text className="mt-0.5 text-sm text-white/60">{plural(pending, "photo")} still uploading</Text>}
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </Pressable>
        )}

        <View className="mt-8 gap-3">
          <Button
            label={joined ? "Scan another event's QR" : "Scan the event QR"}
            icon="qr-code-outline"
            variant={joined ? "secondary" : "primary"}
            onPress={() => router.push("/scan")}
          />
          <Button label="Enter an event code" icon="keypad-outline" variant="secondary" onPress={() => router.push("/join")} />
        </View>
      </View>

      <View>
        <Divider />
        <Row
          icon={hostToken ? "albums-outline" : "person-circle-outline"}
          title={hostToken ? "Your events" : "Hosting an event?"}
          detail={hostToken ? "Moderate photos, share the QR, run the slideshow" : "Sign in to manage your event"}
          onPress={() => router.push("/host")}
        />
        <Divider />
        <LegalLinks className="mt-5" />
        <Text className="mt-1 text-center text-xs" style={{ color: theme.placeholder }}>
          No account needed to share photos.
        </Text>
      </View>
    </Screen>
  );
}
