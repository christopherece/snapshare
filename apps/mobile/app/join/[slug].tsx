import { useLocalSearchParams } from "expo-router";
import { JoinScreen } from "../../src/components/JoinScreen";

/**
 * Where the QR code lands: snapshare://join/<code>, or the event's https join link once the domain is
 * associated with the app (see app.config.ts). `rejoin` asks for a fresh session for the same event.
 */
export default function JoinLink() {
  const { slug, rejoin } = useLocalSearchParams<{ slug: string; rejoin?: string }>();
  return <JoinScreen key={slug} initialCode={slug} rejoin={rejoin === "1"} />;
}
