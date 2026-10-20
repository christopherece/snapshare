import { Redirect, router } from "expo-router";
import { EventCamera } from "../src/components/EventCamera";
import { useSession } from "../src/store/session";

export default function CameraScreen() {
  const { event, guestToken } = useSession();
  if (!event || !guestToken) return <Redirect href="/" />;

  return (
    <EventCamera
      eventId={event.id}
      eventName={event.name}
      guestToken={guestToken}
      onOpenGallery={() => router.push("/feed")}
    />
  );
}
