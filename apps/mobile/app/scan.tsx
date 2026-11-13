import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { goHome } from "../src/lib/launch";
import { parseInviteToken, parseJoinCode } from "../src/lib/links";
import { colors } from "../src/theme";

const FRAME = 248;

/** Point the phone at the event's QR code — the same one the phone's own camera would open in a browser. */
export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(true);
  const [torch, setTorch] = useState(false);
  const [hint, setHint] = useState(false);
  const done = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ask straight away: opening the scanner is the request.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useFocusEffect(
    useCallback(() => {
      done.current = false;
      setFocused(true);
      return () => {
        setFocused(false);
        setTorch(false);
      };
    }, []),
  );
  useEffect(() => () => void (hintTimer.current && clearTimeout(hintTimer.current)), []);

  const onScanned = ({ data }: { data: string }) => {
    if (done.current) return;

    const code = parseJoinCode(data);
    // A bare word isn't enough to go on — QR codes for events always carry the join link.
    if (code && /[/:]/.test(data)) {
      done.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: "/join/[slug]", params: { slug: code } });
      return;
    }

    const invite = /invite\//.test(data) ? parseInviteToken(data) : null;
    if (invite) {
      done.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: "/host/invite/[token]", params: { token: invite } });
      return;
    }

    if (!hintTimer.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else clearTimeout(hintTimer.current);
    setHint(true);
    hintTimer.current = setTimeout(() => {
      hintTimer.current = null;
      setHint(false);
    }, 2500);
  };

  const granted = !!permission?.granted;

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />

      {granted && focused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />
      )}

      {granted ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill} className="items-center justify-center">
          <View style={{ width: FRAME, height: FRAME }}>
            <Corner style={{ top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 28 }} />
            <Corner style={{ top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 28 }} />
            <Corner style={{ bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 28 }} />
            <Corner style={{ bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 28 }} />
          </View>
          <View className="mt-8 h-12 items-center px-10">
            {hint ? (
              <View className="rounded-full bg-accent px-4 py-2">
                <Text className="text-[13px] font-medium text-ink">That isn't a SnapShare event code</Text>
              </View>
            ) : (
              <Text className="text-center text-base text-white/85">Point at the QR code at the event</Text>
            )}
          </View>
        </View>
      ) : (
        permission && (
          <View style={StyleSheet.absoluteFill} className="items-center justify-center px-10">
            <Ionicons name="qr-code-outline" size={44} color={colors.gold} />
            <Text className="mt-5 text-center font-serif text-3xl text-white">Scan the event QR</Text>
            <Text className="mt-2 text-center text-base leading-6 text-white/60">
              Allow camera access to scan the code — or type the event code printed underneath it.
            </Text>
            <Pressable
              onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
              accessibilityRole="button"
              className="mt-8 rounded-full bg-white px-8 py-3 active:opacity-80"
            >
              <Text className="text-base font-medium text-black">{permission.canAskAgain ? "Enable camera" : "Open settings"}</Text>
            </Pressable>
          </View>
        )
      )}

      <View className="absolute left-0 right-0 flex-row items-center justify-between px-4" style={{ top: insets.top + 8 }}>
        <RoundButton icon="close" label="Close" onPress={goHome} />
        {granted && (
          <RoundButton icon={torch ? "flashlight" : "flashlight-outline"} label="Toggle light" active={torch} onPress={() => setTorch((t) => !t)} />
        )}
      </View>

      <View className="absolute left-0 right-0 items-center" style={{ bottom: insets.bottom + 28 }}>
        <Pressable
          onPress={() => router.replace("/join")}
          accessibilityRole="button"
          className="flex-row items-center gap-2 rounded-full bg-white/15 px-6 py-3.5 active:bg-white/25"
        >
          <Ionicons name="keypad-outline" size={18} color="#fff" />
          <Text className="text-base font-medium text-white">Enter the code instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Corner({ style }: { style: object }) {
  return <View style={[{ position: "absolute", width: 44, height: 44, borderColor: "#fff" }, style]} />;
}

function RoundButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-full bg-black/40 active:bg-black/60"
    >
      <Ionicons name={icon} size={22} color={active ? colors.gold : "#fff"} />
    </Pressable>
  );
}
