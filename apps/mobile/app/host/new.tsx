import Ionicons from "@expo/vector-icons/Ionicons";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { TERMS_URL } from "../../src/lib/config";
import { defaultEndsAt, formatLongDate, startOfDay } from "../../src/lib/format";
import { hostApi, hostKeys } from "../../src/lib/host-api";
import { errorMessage } from "../../src/lib/http";
import { colors, useTheme } from "../../src/theme";
import { Button, Card, Field, Heading, Kicker, Notice, openUrl, Screen, ToggleRow, TopBar } from "../../src/components/ui";

export default function NewEvent() {
  const theme = useTheme();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState<Date | null>(null);
  const [picking, setPicking] = useState(false);
  const [location, setLocation] = useState("");
  const [passcode, setPasscode] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);

  const passcodeTooShort = passcode.length > 0 && passcode.length < 4;
  const canSubmit = name.trim().length > 0 && !passcodeTooShort;

  const create = useMutation({
    mutationFn: () => {
      const startsAt = date ? startOfDay(date) : null;
      return hostApi.createEvent({
        name: name.trim(),
        location: location.trim() || null,
        startsAt: startsAt?.toISOString() ?? null,
        endsAt: startsAt ? defaultEndsAt(startsAt).toISOString() : null,
        passcode: passcode || null,
        requireApproval,
      });
    },
    onSuccess: (event) => {
      qc.setQueryData(hostKeys.event(event.id), event);
      void qc.invalidateQueries({ queryKey: hostKeys.events });
      router.replace({ pathname: "/host/event/[id]", params: { id: event.id } });
    },
  });

  const pickDate = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: date ?? new Date(),
        mode: "date",
        onValueChange: (_event, picked) => setDate(picked),
      });
    } else {
      // iOS shows the calendar inline; opening it selects today so the field is never blank.
      setDate((d) => d ?? new Date());
      setPicking((p) => !p);
    }
  };

  return (
    <Screen scroll>
      <TopBar onBack={() => router.back()} />
      <Kicker className="mt-2">Host</Kicker>
      <Heading className="mt-1">New event</Heading>

      <View className="mt-6 gap-4">
        <Field
          label="Event name"
          value={name}
          onChangeText={setName}
          placeholder="Sarah & Mark's Wedding"
          maxLength={160}
          autoCapitalize="words"
          returnKeyType="next"
        />

        <View>
          <Text className="mb-1.5 text-sm font-medium text-ink dark:text-paper">Date</Text>
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={pickDate}
              accessibilityRole="button"
              accessibilityLabel={date ? `Date, ${formatLongDate(date.toISOString())}. Tap to change.` : "Choose a date"}
              className="h-14 flex-1 flex-row items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 dark:border-white/10 dark:bg-ink-soft"
            >
              <Ionicons name="calendar-outline" size={20} color={theme.muted} />
              <Text className={`text-base ${date ? "text-ink dark:text-paper" : "text-muted dark:text-muted-dark"}`}>
                {date ? formatLongDate(date.toISOString()) : "Optional"}
              </Text>
            </Pressable>
            {date && (
              <Pressable
                onPress={() => {
                  setDate(null);
                  setPicking(false);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear the date"
                className="h-11 w-11 items-center justify-center"
              >
                <Ionicons name="close-circle" size={22} color={theme.muted} />
              </Pressable>
            )}
          </View>
          {Platform.OS === "ios" && picking && date && (
            <View className="mt-2 overflow-hidden rounded-2xl border border-ink/10 bg-white dark:border-white/10 dark:bg-ink-soft">
              <DateTimePicker
                value={date}
                mode="date"
                display="inline"
                accentColor={colors.goldDeep}
                themeVariant={theme.dark ? "dark" : "light"}
                onValueChange={(_event, picked) => setDate(picked)}
              />
            </View>
          )}
        </View>

        <Field label="Location" value={location} onChangeText={setLocation} placeholder="Optional" maxLength={255} autoCapitalize="words" />

        <Field
          label="Guest passcode"
          value={passcode}
          onChangeText={setPasscode}
          placeholder="Optional"
          maxLength={64}
          autoCapitalize="none"
          autoCorrect={false}
          hint={passcodeTooShort ? "A passcode needs at least 4 characters." : "Guests will need this as well as the QR code."}
        />

        <Card className="py-2">
          <ToggleRow
            title="Approve photos before they go public"
            description="Otherwise photos appear instantly in the feed and slideshow."
            value={requireApproval}
            onValueChange={setRequireApproval}
          />
        </Card>

        <Text className="text-sm leading-5 text-muted dark:text-muted-dark">
          You're responsible for the photos shared at your event: keep an eye on what appears on screen and act on guest reports. By
          creating an event you agree to the{" "}
          <Text className="font-medium text-ink underline dark:text-paper" accessibilityRole="link" onPress={() => void openUrl(TERMS_URL)}>
            Guest & host terms
          </Text>
          .
        </Text>

        {create.isError && <Notice tone="error">{errorMessage(create.error, "Could not create event")}</Notice>}

        <Button
          label={create.isPending ? "Creating…" : "Create event"}
          loading={create.isPending}
          disabled={!canSubmit}
          onPress={() => create.mutate()}
        />
      </View>
    </Screen>
  );
}
