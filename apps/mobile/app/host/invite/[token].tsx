import { Redirect } from "expo-router";

/**
 * An invite link opened by someone who is already signed in: there's nothing to accept, so go to
 * their events. (Signed out, the host layout shows the create-account form for this invite instead.)
 */
export default function InviteRoute() {
  return <Redirect href="/host" />;
}
