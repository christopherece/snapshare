import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";
import { type HostEvent, hostApi, hostKeys } from "../../lib/host-api";
import { errorMessage } from "../../lib/http";
import { useTheme } from "../../theme";
import { Button, Card, Chip, Muted, openUrl, SectionTitle } from "../ui";

const SLIDESHOW_STYLES = [
  ["fade", "Fade"],
  ["slide", "Slide"],
  ["zoom", "Zoom"],
  ["flip", "Flip"],
  ["kenburns", "Ken Burns"],
  ["polaroid", "Polaroids"],
  ["mosaic", "Mosaic"],
] as const;

/** "Copied ✓" for a moment after copying something. */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = async (key: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      void Haptics.selectionAsync();
      setCopied(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      // Nothing useful to say; the link is still on screen to share another way.
    }
  };
  return { copied, copy };
}

/** Everything for getting photos in and out: the QR code, the slideshow, and the download. */
export function ShareTab({ event, header }: { event: HostEvent; header?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
      {header}
      <View className="gap-4 px-5">
        <InviteCard event={event} />
        <SlideshowCard event={event} />
        <DownloadCard event={event} />
      </View>
    </ScrollView>
  );
}

// ─── QR, join link, flyer ─────────────────────────────────────────────────────

function InviteCard({ event }: { event: HostEvent }) {
  const theme = useTheme();
  const { copied, copy } = useCopied();
  const [printing, setPrinting] = useState(false);
  const qr = useQuery({ queryKey: hostKeys.qr(event.id), queryFn: () => hostApi.qrSvg(event.id), staleTime: Number.POSITIVE_INFINITY });

  const shareLink = () =>
    Share.share({ message: `Share your photos from ${event.name} — scan the QR code at the event or open ${event.joinUrl}` }).catch(() => {});

  const printFlyer = async () => {
    setPrinting(true);
    try {
      const html = await hostApi.flyerHtml(event.id);
      await Print.printAsync({ html });
    } catch (err) {
      // Closing the print dialog also rejects on iOS — only real failures are worth an alert.
      const message = errorMessage(err, "");
      if (message && !/cancel|did not complete/i.test(message)) Alert.alert("Couldn't print the flyer", message);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Invite guests</SectionTitle>
      <Muted className="mt-1 text-sm leading-5">Guests scan this code to start sharing — no app or account needed.</Muted>

      <View className="mt-4 aspect-square w-56 items-center justify-center self-center rounded-2xl bg-white p-3">
        {qr.data ? (
          <SvgXml xml={qr.data} width="100%" height="100%" accessibilityLabel="QR code guests scan to join" />
        ) : qr.isError ? (
          <Pressable onPress={() => void qr.refetch()} accessibilityRole="button" className="items-center px-4">
            <Text className="text-center text-sm text-muted">Couldn't load the QR code. Tap to retry.</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={theme.accent} />
        )}
      </View>

      <Pressable
        onPress={() => void copy("code", event.slug.toUpperCase())}
        accessibilityRole="button"
        accessibilityLabel={`Event code ${event.slug.toUpperCase()}. Tap to copy.`}
        className="mt-4 items-center"
      >
        <Text className="text-sm text-muted dark:text-muted-dark">{copied === "code" ? "Copied ✓" : "Event code"}</Text>
        <Text className="mt-0.5 text-2xl font-semibold tracking-[3px] text-ink dark:text-paper">{event.slug.toUpperCase()}</Text>
      </Pressable>

      <View className="mt-5 gap-2.5">
        <Button label="Share the join link" icon="share-outline" onPress={() => void shareLink()} />
        <Button label={printing ? "Preparing…" : "Print QR flyer"} icon="print-outline" variant="secondary" loading={printing} onPress={() => void printFlyer()} />
        <Button
          label={copied === "join" ? "Copied ✓" : "Copy join link"}
          variant="ghost"
          size="md"
          onPress={() => void copy("join", event.joinUrl)}
        />
      </View>
    </Card>
  );
}

// ─── Live slideshow ───────────────────────────────────────────────────────────

function SlideshowCard({ event }: { event: HostEvent }) {
  const { copied, copy } = useCopied();
  const [style, setStyle] = useState<(typeof SLIDESHOW_STYLES)[number][0]>("fade");
  const slideshowUrl = `${event.slideshowUrl}&style=${style}`;

  return (
    <Card>
      <SectionTitle>Live slideshow</SectionTitle>
      <Muted className="mt-1 text-sm leading-5">
        Open this link on the laptop or TV connected to your projector — new photos appear as guests take them.
      </Muted>

      <Text className="mb-2 mt-4 text-sm font-medium text-ink dark:text-paper">Slideshow style</Text>
      <View className="flex-row flex-wrap gap-2">
        {SLIDESHOW_STYLES.map(([value, label]) => (
          <Chip key={value} label={label} selected={style === value} onPress={() => setStyle(value)} />
        ))}
      </View>

      <View className="mt-5 gap-2.5">
        <Button
          label="Send link to the big screen"
          icon="share-outline"
          variant="secondary"
          onPress={() => void Share.share({ message: slideshowUrl }).catch(() => {})}
        />
        <Button label="Open live slideshow" icon="open-outline" variant="secondary" onPress={() => void openUrl(slideshowUrl)} />
        <Button
          label={copied === "slideshow" ? "Copied ✓" : "Copy slideshow link"}
          variant="ghost"
          size="md"
          onPress={() => void copy("slideshow", slideshowUrl)}
        />
      </View>
    </Card>
  );
}

// ─── Download ZIP ─────────────────────────────────────────────────────────────

function DownloadCard({ event }: { event: HostEvent }) {
  const [busy, setBusy] = useState<"all" | "favorites" | null>(null);
  const visible = Math.max(0, (event.photoCount ?? 0) - (event.hiddenCount ?? 0));
  const favorites = event.favoriteCount ?? 0;

  const download = async (filter: "all" | "favorites") => {
    setBusy(filter);
    try {
      // A short-lived signed link: the phone's browser downloads the ZIP to Files / Downloads.
      await openUrl(await hostApi.downloadUrl(event.id, filter));
    } catch (err) {
      Alert.alert("Download failed", errorMessage(err, "Please try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <SectionTitle>Download originals</SectionTitle>
      <Muted className="mt-1 text-sm leading-5">
        Full-resolution photos as a ZIP, oldest first. Hidden photos are left out. Large galleries are best downloaded on Wi-Fi.
      </Muted>
      <View className="mt-4 gap-2.5">
        <Button
          label={busy === "all" ? "Preparing…" : `Download all (${visible})`}
          icon="download-outline"
          loading={busy === "all"}
          disabled={!visible || !!busy}
          onPress={() => void download("all")}
        />
        <Button
          label={busy === "favorites" ? "Preparing…" : `Favorites only (${favorites})`}
          icon="star-outline"
          variant="secondary"
          loading={busy === "favorites"}
          disabled={!favorites || !!busy}
          onPress={() => void download("favorites")}
        />
      </View>
    </Card>
  );
}
