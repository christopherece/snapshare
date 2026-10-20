import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { type ComponentProps, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { ApiError, api } from "../src/lib/api";
import { useSession } from "../src/store/session";

/**
 * Zero-friction onboarding: the QR deep link pre-fills the event code,
 * the guest optionally types a name, taps once, and lands in the camera.
 */
export default function JoinScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const { hydrated, event, guestToken, deviceId, guestName, setSession } = useSession();

  const [code, setCode] = useState(params.slug ?? "");
  const [name, setName] = useState(guestName ?? "");
  const [passcode, setPasscode] = useState("");
  const slug = code.trim().toLowerCase();

  const eventQuery = useQuery({
    queryKey: ["event-preview", slug],
    queryFn: () => api.getEvent(slug),
    enabled: slug.length >= 6,
    retry: false,
  });

  const join = useMutation({
    mutationFn: () =>
      api.join(slug, { deviceId, displayName: name.trim() || null, passcode: passcode || null }),
    onSuccess: (res) => {
      setSession(res.event, res.guestToken, name.trim() || null);
      router.replace("/camera");
    },
  });

  if (!hydrated) return <View className="flex-1 bg-black" />;
  // Already in this event (or no new code scanned) → straight to the camera.
  if (event && guestToken && (!params.slug || params.slug === event.slug)) return <Redirect href="/camera" />;

  const preview = eventQuery.data;
  const error =
    join.error instanceof ApiError ? join.error.message : eventQuery.isError ? "We couldn't find that event code." : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-paper dark:bg-ink">
      <View className="flex-1 justify-center px-8">
        <Text className="text-xs font-semibold uppercase tracking-[4px] text-accent">SnapShare</Text>
        <Text className="mt-3 text-4xl font-light text-ink dark:text-paper">
          {preview ? preview.name : "Join the event"}
        </Text>
        {preview?.location && <Text className="mt-2 text-base text-ink/60 dark:text-paper/60">{preview.location}</Text>}

        <View className="mt-10 gap-3">
          {!params.slug && (
            <Field value={code} onChangeText={setCode} placeholder="Event code" autoCapitalize="none" maxLength={32} />
          )}
          <Field value={name} onChangeText={setName} placeholder="Your name (optional)" maxLength={60} />
          {preview?.requiresPasscode && (
            <Field value={passcode} onChangeText={setPasscode} placeholder="Event passcode" secureTextEntry />
          )}
        </View>

        {error && <Text className="mt-4 text-sm text-red-500">{error}</Text>}

        <Pressable
          disabled={!preview || join.isPending}
          onPress={() => join.mutate()}
          className="mt-8 h-14 items-center justify-center rounded-full bg-ink active:opacity-80 disabled:opacity-40 dark:bg-paper"
        >
          {join.isPending ? (
            <ActivityIndicator color="#888" />
          ) : (
            <Text className="text-base font-medium text-paper dark:text-ink">Start taking photos</Text>
          )}
        </Pressable>
        <Text className="mt-4 text-center text-xs text-ink/40 dark:text-paper/40">
          No account needed. Your photos are shared with the host and guests.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field(props: ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="#999"
      className="h-14 rounded-2xl bg-paper-dim px-5 text-base text-ink dark:bg-ink-soft dark:text-paper"
      {...props}
    />
  );
}
