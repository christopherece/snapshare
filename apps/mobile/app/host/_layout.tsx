import { useQueryClient } from "@tanstack/react-query";
import { Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { useEffect } from "react";
import { HostLogin } from "../../src/components/host/HostLogin";
import { hostKeys } from "../../src/lib/host-api";
import { useHostAuth } from "../../src/store/host";
import { useTheme } from "../../src/theme";

/**
 * The host area. Every screen in here needs an account, so the sign-in screen stands in for all of
 * them until there's a token — signing in (or out) simply swaps what this layout shows.
 */
export default function HostLayout() {
  const theme = useTheme();
  const qc = useQueryClient();
  const token = useHostAuth((s) => s.token);
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ token?: string }>();

  // One account's events must never flash up for the next person who signs in on this phone.
  useEffect(() => {
    if (!token) qc.removeQueries({ queryKey: hostKeys.all });
  }, [token, qc]);

  if (!token) {
    const invite = pathname.startsWith("/host/invite") && typeof params.token === "string" ? params.token : null;
    return <HostLogin key={invite ?? "login"} inviteToken={invite} />;
  }

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}
