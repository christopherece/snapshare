import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type EventInput, type HostEvent, hostApi, hostKeys } from "../../lib/host-api";
import { errorMessage } from "../../lib/http";
import { Button, Card, Divider, Field, SectionTitle, ToggleRow } from "../ui";

/** Event switches: accept uploads, approve before public, and the guest passcode. */
export function SettingsTab({ event, header }: { event: HostEvent; header?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [passcode, setPasscode] = useState("");
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (savedTimer.current && clearTimeout(savedTimer.current)), []);

  const save = useMutation({
    mutationFn: (patch: EventInput) => hostApi.updateEvent(event.id, patch),
    onMutate: () => setSaved(false),
    onSuccess: (updated) => {
      // The update response doesn't carry the photo counts — keep the ones we have.
      qc.setQueryData<HostEvent>(hostKeys.event(event.id), (old) => (old ? { ...old, ...updated } : updated));
      void qc.invalidateQueries({ queryKey: hostKeys.events });
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1500);
    },
  });

  // Switches flip immediately and settle on the server's answer.
  const shown = { ...event, ...(save.isPending ? save.variables : null) };

  const removePasscode = () =>
    Alert.alert("Remove the passcode?", "Anyone with the QR code or event code will be able to join.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => save.mutate({ passcode: null }) },
    ]);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
    >
      {header}
      <View className="gap-4 px-5">
        <Card>
          <View className="flex-row items-center justify-between">
            <SectionTitle>Settings</SectionTitle>
            <Text accessibilityLiveRegion="polite" className="text-sm text-muted dark:text-muted-dark">
              {save.isPending ? "Saving…" : saved ? "Saved ✓" : ""}
            </Text>
          </View>
          {save.isError && (
            <Text accessibilityRole="alert" className="mt-2 text-sm text-danger dark:text-danger-soft">
              {errorMessage(save.error, "Save failed. Please try again.")}
            </Text>
          )}

          <View className="mt-2">
            <ToggleRow
              title="Accept uploads"
              description="Turn off after the event to stop new photos."
              value={shown.uploadsOpen ?? false}
              disabled={save.isPending}
              onValueChange={(v) => save.mutate({ uploadsOpen: v })}
            />
            <Divider />
            <ToggleRow
              title="Approve before public"
              description="New photos wait in “To review” until you approve them."
              value={shown.requireApproval ?? false}
              disabled={save.isPending}
              onValueChange={(v) => save.mutate({ requireApproval: v })}
            />
          </View>
        </Card>

        <Card>
          <View className="flex-row items-center gap-2.5">
            <SectionTitle>Guest passcode</SectionTitle>
            <View className={`rounded-full px-2.5 py-0.5 ${event.hasPasscode ? "bg-accent" : "bg-ink/10 dark:bg-white/15"}`}>
              <Text className={`text-xs font-semibold ${event.hasPasscode ? "text-ink" : "text-ink dark:text-paper"}`}>
                {event.hasPasscode ? "On" : "Off"}
              </Text>
            </View>
          </View>
          <Text className="mt-1 text-sm leading-5 text-muted dark:text-muted-dark">
            {event.hasPasscode
              ? "Guests need the passcode as well as the QR code. Setting a new one doesn't remove guests who have already joined."
              : "Add a passcode if you'd like to keep out anyone who wasn't given it."}
          </Text>
          <View className="mt-4 flex-row items-start gap-2">
            <Field
              className="flex-1"
              value={passcode}
              onChangeText={setPasscode}
              placeholder={event.hasPasscode ? "New passcode" : "Set a passcode"}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={64}
              hint="At least 4 characters."
            />
            <Button
              label="Set"
              variant="secondary"
              disabled={passcode.length < 4 || save.isPending}
              onPress={() => save.mutate({ passcode }, { onSuccess: () => setPasscode("") })}
            />
          </View>
          {event.hasPasscode && (
            <Button label="Remove passcode" variant="ghost" size="md" disabled={save.isPending} onPress={removePasscode} className="mt-2 self-start" />
          )}
        </Card>
      </View>
    </ScrollView>
  );
}
