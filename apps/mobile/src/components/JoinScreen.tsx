import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { feedKey } from "../hooks/useEventFeed";
import { ApiError, api } from "../lib/api";
import { formatEventDay } from "../lib/format";
import { errorMessage } from "../lib/http";
import { goHome } from "../lib/launch";
import { parseJoinCode } from "../lib/links";
import { retryBlocked } from "../lib/upload-queue";
import { useSession } from "../store/session";
import { useTheme } from "../theme";
import { Button, Field, Heading, type IconName, Kicker, LegalLinks, Loading, Muted, Notice, Screen, TopBar } from "./ui";

const STEPS: { icon: IconName; title: string; detail: string }[] = [
  { icon: "camera-outline", title: "Snap", detail: "Take photos with this app" },
  { icon: "cloud-upload-outline", title: "It's shared", detail: "They upload on their own" },
  { icon: "tv-outline", title: "See it live", detail: "In the gallery and on screen" },
];

/** The web guest app looks an event up once the code is this long; shorter codes are never issued. */
const MIN_CODE = 6;

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Zero-friction onboarding: the QR (or a typed code) finds the event, the guest optionally adds a
 * name, taps once, and lands in the camera. No account.
 */
export function JoinScreen({ initialCode, rejoin = false }: { initialCode?: string; rejoin?: boolean }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const { event, guestToken, deviceId, guestName, setSession } = useSession();

  const linked = initialCode ? parseJoinCode(initialCode) : null;
  const [code, setCode] = useState(linked ?? initialCode ?? "");
  const [name, setName] = useState(guestName ?? "");
  const [passcode, setPasscode] = useState("");
  const [alreadyIn] = useState(() => !rejoin && !!linked && !!guestToken && event?.slug === linked);

  // People paste whole links; keep just the code.
  const onCode = (text: string) => setCode(/[/:]/.test(text) ? (parseJoinCode(text) ?? text) : text);

  const typed = code.trim().toLowerCase();
  const slug = useDebounced(typed, linked === typed ? 0 : 350);
  const lookup = useQuery({
    queryKey: ["event-preview", slug],
    queryFn: () => api.getEvent(slug),
    enabled: slug.length >= MIN_CODE && parseJoinCode(slug) !== null,
    retry: (failures, err) => err instanceof ApiError && err.offline && failures < 2,
    staleTime: 0,
  });

  const join = useMutation({
    mutationFn: () => api.join(slug, { deviceId, displayName: name.trim() || null, passcode: passcode || null }),
    onSuccess: (res) => {
      // Photos the server refused under the old session get another go with the new one.
      retryBlocked(res.event.id, res.guestToken);
      setSession(res.event, res.guestToken, name.trim() || null);
      void qc.resetQueries({ queryKey: feedKey(res.event.id) });
      if (rejoin && router.canGoBack()) router.back();
      else router.replace("/camera");
    },
  });

  // Scanned the code of the event they're already in → straight back to the camera.
  if (alreadyIn) return <Redirect href="/camera" />;

  const preview = typed === slug ? lookup.data : undefined;
  const searching = typed.length >= MIN_CODE && (typed !== slug || lookup.isFetching) && !preview;
  const malformed = typed === slug && typed.length >= MIN_CODE && parseJoinCode(typed) === null;
  const lookupError = malformed
    ? "We couldn't find an event with that code."
    : typed === slug && lookup.isError
      ? lookup.error instanceof ApiError && lookup.error.offline
        ? lookup.error.message
        : lookup.error instanceof ApiError && lookup.error.status === 410
          ? `${lookup.error.message}.`
          : "We couldn't find an event with that code."
      : null;
  const when = formatEventDay(preview?.startsAt);
  const canJoin = !!preview && !join.isPending && (!preview.requiresPasscode || passcode.length > 0);

  return (
    <Screen scroll>
      <TopBar onBack={goHome} backIcon="close" backLabel="Close" />

      <View className="pt-4">
        <Kicker>{preview ? "You're invited to share photos" : "Join an event"}</Kicker>
        <Heading size="xl" className="mt-3">
          {preview ? preview.name : lookupError ? "Hmm, that didn't work" : "Enter your event code"}
        </Heading>
        {preview ? (
          (when || preview.location) && <Muted className="mt-2">{[when, preview.location].filter(Boolean).join("  ·  ")}</Muted>
        ) : (
          <Muted className="mt-2">It's printed under the QR code at the venue.</Muted>
        )}
      </View>

      {preview && (
        <View className="mt-7 flex-row gap-2">
          {STEPS.map((s, i) => (
            <View key={s.title} className="flex-1 rounded-2xl border border-ink/5 bg-white px-3 py-3.5 dark:border-white/10 dark:bg-ink-soft">
              <Ionicons name={s.icon} size={20} color={theme.accent} />
              <Text className="mt-2 text-sm font-semibold text-ink dark:text-paper">
                {i + 1}. {s.title}
              </Text>
              <Text className="mt-0.5 text-xs leading-4 text-muted dark:text-muted-dark">{s.detail}</Text>
            </View>
          ))}
        </View>
      )}

      <View className="mt-7 gap-3">
        {(!linked || !preview) && (
          <Field
            value={code}
            onChangeText={onCode}
            placeholder="Event code"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            autoFocus={!initialCode}
            maxLength={200}
            returnKeyType="next"
          />
        )}
        {searching && <Loading label="Finding your event…" />}
        {lookupError && <Notice tone="error">{lookupError}</Notice>}

        {preview && (
          <>
            <Field
              value={name}
              onChangeText={setName}
              placeholder="Your name (optional)"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              maxLength={60}
              returnKeyType="done"
            />
            {preview.requiresPasscode && (
              <Field
                value={passcode}
                onChangeText={setPasscode}
                placeholder="Event passcode"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={64}
                returnKeyType="go"
                onSubmitEditing={() => canJoin && join.mutate()}
              />
            )}
          </>
        )}
      </View>

      {preview && (
        <>
          <Notice className="mt-5">
            <Text className="font-semibold">Before you start. </Text>
            Your photos are shared with the host and other guests, and may appear{" "}
            <Text className="font-semibold">live on the big screen</Text>. Only take photos people are happy to share. Nothing
            offensive, and respect anyone who'd rather not be photographed.
          </Notice>

          {join.isError && (
            <Notice tone="error" className="mt-3">
              {errorMessage(join.error, "Couldn't join the event. Please try again.")}
            </Notice>
          )}

          <Button
            label={join.isPending ? "Joining…" : "Open the camera"}
            icon="camera"
            loading={join.isPending}
            disabled={!canJoin}
            onPress={() => join.mutate()}
            className="mt-5"
          />
          <LegalLinks prefix="By continuing you agree to the" className="mt-4" />
        </>
      )}
    </Screen>
  );
}
