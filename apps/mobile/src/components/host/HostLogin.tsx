import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { hostApi } from "../../lib/host-api";
import { errorMessage } from "../../lib/http";
import { goHome } from "../../lib/launch";
import { parseInviteToken } from "../../lib/links";
import { useHostAuth } from "../../store/host";
import { Logo } from "../LogoMark";
import { Button, Field, Heading, type InputRef, Kicker, LegalLinks, Muted, Notice, Screen, TopBar } from "../ui";

/** Sign in — or, with an invite (or on a brand-new install, or when registration is open), create the host account. */
export function HostLogin({ inviteToken = null }: { inviteToken?: string | null }) {
  const setToken = useHostAuth((s) => s.setToken);

  const configQuery = useQuery({ queryKey: ["auth-config"], queryFn: hostApi.authConfig, staleTime: 0 });
  // If the server can't be reached the form still works for signing in; the error shows on submit.
  const config = configQuery.data ?? (configQuery.isError ? ({ registration: "invite", setupRequired: false } as const) : null);

  const inviteQuery = useQuery({
    queryKey: ["invite", inviteToken],
    queryFn: () => hostApi.inviteInfo(inviteToken!),
    enabled: !!inviteToken,
    retry: false,
    staleTime: 0,
  });
  const invite = inviteQuery.data ?? null;
  const inviteError = inviteQuery.isError ? errorMessage(inviteQuery.error, "This invite link didn't work") : null;

  const [mode, setMode] = useState<"login" | "register">(inviteToken ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteLinkError, setInviteLinkError] = useState(false);
  const emailRef = useRef<InputRef>(null);
  const passwordRef = useRef<InputRef>(null);

  useEffect(() => {
    if (config?.setupRequired) setMode("register");
  }, [config?.setupRequired]);

  // Invite links: greet the customer and pre-fill (and lock) the email the invite was made for.
  useEffect(() => {
    if (!invite) return;
    if (invite.email) setEmail(invite.email);
    if (invite.note) setName((n) => n || invite.note!);
  }, [invite]);
  useEffect(() => {
    if (inviteError) setMode("login");
  }, [inviteError]);

  const usableInvite = !!inviteToken && !inviteError;
  const canRegister = usableInvite || !!config?.setupRequired || config?.registration === "open";
  const registering = mode === "register";

  const submit = useMutation({
    mutationFn: () =>
      registering
        ? hostApi.register(name.trim(), email.trim(), password, usableInvite ? inviteToken : null)
        : hostApi.login(email.trim(), password),
    // Signing in swaps this screen for the host area (see app/host/_layout.tsx).
    onSuccess: (res) => setToken(res.token),
  });

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const valid = emailOk && password.length >= (registering ? 8 : 1) && (!registering || name.trim().length > 0);
  const send = () => valid && config && !submit.isPending && submit.mutate();

  const openInvite = () => {
    const token = parseInviteToken(inviteLink);
    if (!token) return setInviteLinkError(true);
    router.replace({ pathname: "/host/invite/[token]", params: { token } });
  };

  const title = !registering
    ? "Welcome back"
    : config?.setupRequired
      ? "Create the admin account"
      : usableInvite
        ? "You're invited"
        : "Create your account";

  return (
    <Screen scroll>
      <TopBar onBack={goHome} backIcon="close" backLabel="Close" />
      <View className="pt-2">
        <Logo size={30} />
        <Kicker className="mt-8">{registering ? "Get started" : "Host dashboard"}</Kicker>
        <Heading size="xl" className="mt-2">
          {title}
        </Heading>
        <Muted className="mt-2">
          {config?.setupRequired && registering
            ? "This is a new install — the first account manages who else can host events."
            : usableInvite && registering
              ? "Create your account to set up your event. Guests will scan a QR code to share their photos live."
              : "Collect every guest's photos, live, in one place."}
        </Muted>
      </View>

      {inviteError && (
        <Notice tone="warn" className="mt-5">
          {inviteError.replace(/\.$/, "")}. Ask the organiser for a new link, or sign in below.
        </Notice>
      )}

      <View className="mt-6 gap-4">
        {registering && (
          <Field
            label="Your name"
            value={name}
            onChangeText={setName}
            maxLength={120}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
        )}
        <Field
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={setEmail}
          editable={!(registering && !!invite?.email)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <Field
          ref={passwordRef}
          label={registering ? "Choose a password (8+ characters)" : "Password"}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={registering ? "new-password" : "current-password"}
          textContentType={registering ? "newPassword" : "password"}
          returnKeyType="go"
          onSubmitEditing={send}
        />
      </View>

      {submit.isError && (
        <Notice tone="error" className="mt-4">
          {errorMessage(submit.error, "Something went wrong. Please try again.")}
        </Notice>
      )}

      <Button
        label={submit.isPending ? "Please wait…" : registering ? "Create account" : "Sign in"}
        loading={submit.isPending}
        disabled={!valid || !config}
        onPress={send}
        className="mt-6"
      />

      {canRegister ? (
        <Button
          variant="ghost"
          size="md"
          label={registering ? "Already have an account? Sign in" : "New here? Create an account"}
          onPress={() => {
            setMode(registering ? "login" : "register");
            submit.reset();
          }}
          className="mt-2"
        />
      ) : (
        config && (
          <View className="mt-8">
            <Text className="text-center text-sm leading-5 text-muted dark:text-muted-dark">
              Hosting is by invitation. Ask the organiser for an invite link.
            </Text>
            <View className="mt-4 flex-row items-start gap-2">
              <Field
                className="flex-1"
                value={inviteLink}
                onChangeText={(t) => {
                  setInviteLink(t);
                  setInviteLinkError(false);
                }}
                placeholder="Paste your invite link"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={openInvite}
                hint={inviteLinkError ? "That doesn't look like an invite link." : undefined}
              />
              <Button label="Use" variant="secondary" disabled={!inviteLink.trim()} onPress={openInvite} />
            </View>
          </View>
        )
      )}

      {registering && <LegalLinks prefix="By creating an account you agree to the" className="mt-5" />}
    </Screen>
  );
}
