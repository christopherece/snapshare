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
  Sheet,
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

  // ─── Delete account ─────────────────────────────────────────────────────
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const remove = useMutation({
    mutationFn: () => hostApi.deleteAccount(deletePassword),
    onSuccess: () => {
      setDeleting(false);
      router.replace("/");
      // Clears the stored sign-in; the host area's queries are dropped with it (see app/host/_layout.tsx).
      signOut();
      Alert.alert("Account deleted", "Your account, events and photos have been deleted.");
    },
  });
  const closeDelete = () => {
    if (remove.isPending) return;
    setDeleting(false);
    setDeletePassword("");
    remove.reset();
  };
  const confirmDelete = () =>
    Alert.alert("Delete everything?", "Your account, every event you host and all of their photos will be deleted. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate() },
    ]);

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
          detail="Permanently removes your account, events and photos."
          onPress={() => setDeleting(true)}
          danger
        />
      </Card>

      <Sheet visible={deleting} onClose={closeDelete} title="Delete your account">
        <Text className="text-base leading-6 text-muted dark:text-muted-dark">
          This deletes your account, every event you host and all of their photos, straight away. Download the photos you want to keep
          first.
        </Text>
        <Field
          className="mt-4"
          label="Your password"
          value={deletePassword}
          onChangeText={setDeletePassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
        />
        {remove.isError && (
          <Notice tone="error" className="mt-3">
            {errorMessage(remove.error, "Couldn't delete your account. Please try again.")}
          </Notice>
        )}
        <View className="mt-5 gap-2.5">
          <Button
            label={remove.isPending ? "Deleting…" : "Delete my account permanently"}
            variant="danger"
            loading={remove.isPending}
            disabled={!deletePassword}
            onPress={confirmDelete}
          />
          <Button label="Cancel" variant="ghost" size="md" disabled={remove.isPending} onPress={closeDelete} />
        </View>
      </Sheet>
      <Text className="mt-6 text-center text-xs leading-5 text-muted dark:text-muted-dark">
        Need help? Email{" "}
        <Text className="font-medium text-ink underline dark:text-paper" accessibilityRole="link" onPress={() => void openUrl(`mailto:${SUPPORT_EMAIL}`)}>
          {SUPPORT_EMAIL}
        </Text>
      </Text>

      <LegalLinks className="mt-8" />
      {version && <Text className="mt-2 text-center text-xs text-muted dark:text-muted-dark">SnapShare {version}</Text>}
    </Screen>
  );
}
