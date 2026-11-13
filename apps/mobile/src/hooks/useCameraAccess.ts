import { useCameraPermissions } from "expo-camera";
import { useEffect } from "react";
import { AppState } from "react-native";

/**
 * Camera permission that stays current. expo-camera reads the permission once, so someone who turns
 * the camera on in the phone's Settings and comes back would still see "camera is off" — re-read it
 * whenever the app returns to the front.
 */
export function useCameraAccess() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  return [permission, requestPermission] as const;
}
