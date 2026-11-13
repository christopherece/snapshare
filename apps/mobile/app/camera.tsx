import { Redirect, router } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { EventCamera } from "../src/components/EventCamera";
import { goHome } from "../src/lib/launch";
import { useSession } from "../src/store/session";

export default function CameraScreen() {
  const { event, guestToken, guestName, leaveEvent, setMode } = useSession();
  const leaving = useRef(false);

  // The app reopens on whichever side was used last.
  useEffect(() => setMode("guest"), [setMode]);

  if (!event || !guestToken) return leaving.current ? <View className="flex-1 bg-black" /> : <Redirect href="/" />;

  return (
    <EventCamera
      eventId={event.id}
      eventName={event.name}
      guestName={guestName}
      guestToken={guestToken}
      onOpenGallery={() => router.push("/feed")}
      onHome={goHome}
      onLeave={() => {
        leaving.current = true;
        leaveEvent();
        goHome();
      }}
      onRejoin={() => router.push({ pathname: "/join/[slug]", params: { slug: event.slug, rejoin: "1" } })}
    />
  );
}
