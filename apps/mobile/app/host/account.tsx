import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  Button,
  Card,
  Divider,
  Field,
  Heading,
  type InputRef,
  Kicker,
  LegalLinks,
  Notice,
  openUrl,
  Row,
  Screen,
  SectionTitle,
  TopBar,
} from "../../src/components/ui";
import { SUPPORT_EMAIL } from "../../src/lib/config";
import { hostApi, hostKeys } from "../../src/lib/host-api";
import { errorMessage } from "../../src/lib/http";
import { useHostAuth } from "../../src/store/host";

export default function Account() {
  const me = useQuery({ queryKey: hostKeys.me, queryFn: hostApi.me });
  const setToken = useHostAuth((s) => s.setToken);
  const signOut = useHostAuth((s) => s.signOut);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const nextRef = useRef<InputRef>(null);
  const confirmRef = useRef<InputRef>(null);

  const change = useMutation({
    mutationFn: () => hostApi.changePassword(current, next),
    onSuccess: (res) => {
      // The server signs out every other device and hands this one a fresh token.
      setToken(res.token);
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });

  const submit = () => {
    change.reset();
    if (next !== confirm) return setMismatch(true);
    setMismatch(false);
    change.mutate();
  };

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You'll need your email and password to get back to your events.", [
      { text: "Cancel", style: "cancel" },
      // Signing out swaps the whole host area for the sign-in screen (see app/host/_layout.tsx).
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);

  const requestDeletion = () =>
    void openUrl(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Delete my SnapShare account")}&body=${encodeURIComponent(
        `Please delete my SnapShare account${me.data ? ` (${me.data.email})` : ""} and its events and photos.`,
      )}`,
    );

  const version = Constants.expoConfig?.version;

  return (
    <Screen scroll>
      <TopBar onBack={() => router.back()} />
      <Kicker className="mt-2">Account</Kicker>
      <Heading className="mt-1" numberOfLines={2}>
        {me.data?.name ?? " "}
      </Heading>
      {me.data && (
        <Text className="mt-1 text-sm text-muted dark:text-muted-dark">
          {me.data.email} · {me.data.role === "admin" ? "Admin" : "Host"}
        </Text>
      )}
      {me.data?.role === "admin" && (
        <Notice className="mt-4">Admin tools (accounts, invites, all events) are on the web dashboard.</Notice>
      )}

      <Card className="mt-6">
        <SectionTitle>Change password</SectionTitle>
        <View className="mt-4 gap-3">
          <Field
            label="Current password"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            onSubmitEditing={() => nextRef.current?.focus()}
          />
          <Field
            ref={nextRef}
            label="New password (8+ characters)"
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <Field
            ref={confirmRef}
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
          />
          {mismatch && <Notice tone="error">The new passwords don't match.</Notice>}
          {change.isError && <Notice tone="error">{errorMessage(change.error, "Could not change the password.")}</Notice>}
          {change.isSuccess && <Notice tone="success">Password changed. You've been signed out on your other devices.</Notice>}
          <Button
            label={change.isPending ? "Saving…" : "Change password"}
            variant="secondary"
            loading={change.isPending}
            disabled={!current || next.length < 8 || !confirm}
            onPress={submit}
          />
        </View>
      </Card>

      <Card className="mt-4 py-2">
        <Row icon="log-out-outline" title="Sign out" onPress={confirmSignOut} />
        <Divider />
        <Row
          icon="trash-outline"
          title="Delete my account"
          detail="Email us and we'll remove your account, events and photos."
          onPress={requestDeletion}
        />
      </Card>

      <LegalLinks className="mt-8" />
      {version && <Text className="mt-2 text-center text-xs text-muted dark:text-muted-dark">SnapShare {version}</Text>}
    </Screen>
  );
}
