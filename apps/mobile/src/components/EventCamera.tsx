import Ionicons from "@expo/vector-icons/Ionicons";
import { type CameraType, CameraView, type FlashMode, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { type ComponentRef, useCallback, useRef, useState } from "react";
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { enqueuePhoto, usePendingCount } from "../lib/upload-queue";

interface Props {
  eventId: string;
  eventName: string;
  guestToken: string;
  onOpenGallery: () => void;
}

const FLASH_CYCLE: FlashMode[] = ["off", "auto", "on"];
const FLASH_ICON: Record<FlashMode, keyof typeof Ionicons.glyphMap> = {
  off: "flash-off-outline",
  auto: "flash-outline",
  on: "flash",
  screen: "phone-portrait-outline",
};
const GALLERY_SIZE = 48;

/**
 * Guest camera: one-tap capture with flash feedback, haptics, and a thumbnail
 * that "flies" into the gallery button. Capture never waits on the network —
 * photos go straight into the persistent upload queue.
 */
export function EventCamera({ eventId, eventName, guestToken, onOpenGallery }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const galleryRef = useRef<ComponentRef<typeof View>>(null);

  const [focused, setFocused] = useState(true);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [showGrid, setShowGrid] = useState(true);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const [flyingUri, setFlyingUri] = useState<string | null>(null);
  const [frontFlash, setFrontFlash] = useState(false);
  const capturing = useRef(false);
  const pendingCount = usePendingCount(eventId);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [galleryCenter, setGalleryCenter] = useState({ x: 0, y: 0 });
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const flyProgress = useRef(new Animated.Value(0)).current;
  const shutterScale = useRef(new Animated.Value(1)).current;

  // Release the camera while another screen (the feed) is on top.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        setReady(false);
      };
    }, []),
  );

  const measureGallery = () => {
    if (!galleryRef.current || !rootRef.current) return;
    galleryRef.current.measureLayout(rootRef.current, (x, y, w, h) => setGalleryCenter({ x: x + w / 2, y: y + h / 2 }));
  };

  const playFlash = () => {
    flashOpacity.setValue(0.9);
    Animated.timing(flashOpacity, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };

  const playFly = (uri: string) => {
    setFlyingUri(uri);
    flyProgress.setValue(0);
    Animated.timing(flyProgress, {
      toValue: 1,
      duration: 520,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start(() => {
      setLastThumb(uri);
      setFlyingUri(null);
    });
  };

  const takePhoto = useCallback(async () => {
    if (!ready || capturing.current || !cameraRef.current) return;
    capturing.current = true;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(shutterScale, { toValue: 0.86, duration: 70, useNativeDriver: true }),
      Animated.spring(shutterScale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();

    try {
      // Hardware flash rarely exists on the front camera — light the face with the screen instead.
      const useScreenFlash = facing === "front" && flash === "on";
      if (useScreenFlash) {
        setFrontFlash(true);
        await new Promise((r) => setTimeout(r, 180));
      } else {
        playFlash();
      }

      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, exif: false });
      if (useScreenFlash) {
        setFrontFlash(false);
        playFlash();
      }
      if (!photo) throw new Error("No photo returned");

      playFly(photo.uri);

      // Compress + persist + queue in the background; the shutter is free immediately.
      enqueuePhoto({ uri: photo.uri, width: photo.width, height: photo.height, eventId, guestToken }).catch((err) => {
        console.warn("Failed to queue photo", err);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      });
    } catch (err) {
      console.warn("Capture failed", err);
      setFrontFlash(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      capturing.current = false;
    }
  }, [ready, facing, flash, eventId, guestToken]);

  // ─── Permission states ────────────────────────────────────────────────────

  if (!permission) return <View className="flex-1 bg-black" />;

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-10">
        <Ionicons name="camera-outline" size={44} color="#c8a97e" />
        <Text className="mt-5 text-center text-xl font-light text-white">Share the moment</Text>
        <Text className="mt-2 text-center text-base leading-6 text-white/60">
          Allow camera access to take photos that appear live at {eventName}.
        </Text>
        <Pressable
          onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
          className="mt-8 rounded-full bg-white px-8 py-3 active:opacity-80"
        >
          <Text className="text-base font-medium text-black">
            {permission.canAskAgain ? "Enable camera" : "Open settings"}
          </Text>
        </Pressable>
      </View>
    );
  }

  // ─── Fly-to-gallery transform ─────────────────────────────────────────────
  // The preview starts full-screen and shrinks onto the gallery button's center.

  const scaleEnd = viewport.w ? GALLERY_SIZE / viewport.w : 0.1;
  const flyStyle = {
    transform: [
      { translateX: flyProgress.interpolate({ inputRange: [0, 1], outputRange: [0, galleryCenter.x - viewport.w / 2] }) },
      { translateY: flyProgress.interpolate({ inputRange: [0, 1], outputRange: [0, galleryCenter.y - viewport.h / 2] }) },
      { scale: flyProgress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 0.82, scaleEnd] }) },
    ],
    opacity: flyProgress.interpolate({ inputRange: [0, 0.9, 1], outputRange: [1, 1, 0] }),
  };

  return (
    <View
      ref={rootRef}
      className="flex-1 bg-black"
      onLayout={(e) => {
        setViewport({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
        measureGallery();
      }}
    >
      {focused && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          animateShutter={false}
          onCameraReady={() => setReady(true)}
          onMountError={(e) => console.warn("Camera mount error", e.message)}
        />
      )}

      {showGrid && <GridOverlay />}

      {/* Capture flash + front "screen flash" */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashOpacity }]} />
      {frontFlash && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} />}

      {/* Top bar */}
      <View className="absolute left-0 right-0 flex-row items-center justify-between px-5" style={{ top: insets.top + 8 }}>
        <IconButton
          icon={FLASH_ICON[flash]}
          label={`Flash ${flash}`}
          onPress={() => setFlash(FLASH_CYCLE[(FLASH_CYCLE.indexOf(flash) + 1) % FLASH_CYCLE.length]!)}
          active={flash !== "off"}
        />
        <Text numberOfLines={1} className="mx-3 flex-1 text-center text-sm font-medium tracking-widest text-white/90">
          {eventName.toUpperCase()}
        </Text>
        <IconButton icon="grid-outline" label="Toggle grid" onPress={() => setShowGrid((g) => !g)} active={showGrid} />
      </View>

      {/* Bottom bar */}
      <View
        className="absolute left-0 right-0 flex-row items-center justify-between px-10"
        style={{ bottom: insets.bottom + 28 }}
      >
        <Pressable
          ref={galleryRef}
          onLayout={measureGallery}
          onPress={onOpenGallery}
          accessibilityLabel="Open event gallery"
          className="items-center justify-center overflow-hidden rounded-xl border-2 border-white/80 bg-white/10"
          style={{ width: GALLERY_SIZE, height: GALLERY_SIZE }}
        >
          {lastThumb ? (
            <Image source={{ uri: lastThumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          ) : (
            <Ionicons name="images-outline" size={22} color="#fff" />
          )}
          {pendingCount > 0 && (
            <View className="absolute -right-0.5 -top-0.5 min-w-[18px] items-center rounded-full bg-accent px-1">
              <Text className="text-[11px] font-semibold text-black">{pendingCount}</Text>
            </View>
          )}
        </Pressable>

        <Pressable onPress={takePhoto} disabled={!ready} accessibilityLabel="Take photo" hitSlop={12}>
          <Animated.View
            style={{
              width: 78,
              height: 78,
              borderRadius: 39,
              borderWidth: 4,
              borderColor: "#fff",
              alignItems: "center",
              justifyContent: "center",
              opacity: ready ? 1 : 0.5,
              transform: [{ scale: shutterScale }],
            }}
          >
            <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: "#fff" }} />
          </Animated.View>
        </Pressable>

        <IconButton
          icon="camera-reverse-outline"
          label="Flip camera"
          size={26}
          onPress={() => {
            void Haptics.selectionAsync();
            setReady(false);
            setFacing((f) => (f === "back" ? "front" : "back"));
          }}
        />
      </View>

      {/* Thumbnail flying into the gallery button */}
      {flyingUri && viewport.w > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", left: 0, top: 0, width: viewport.w, height: viewport.h, borderRadius: 24, overflow: "hidden" },
            flyStyle,
          ]}
        >
          <Image source={{ uri: flyingUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        </Animated.View>
      )}
    </View>
  );
}

function GridOverlay() {
  const line = { position: "absolute" as const, backgroundColor: "rgba(255,255,255,0.28)" };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[line, { left: "33.33%", top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
      <View style={[line, { left: "66.66%", top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
      <View style={[line, { top: "33.33%", left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
      <View style={[line, { top: "66.66%", left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
    </View>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  active = false,
  size = 22,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={10}
      className="h-11 w-11 items-center justify-center rounded-full bg-black/30 active:bg-black/50"
    >
      <Ionicons name={icon} size={size} color={active ? "#c8a97e" : "#fff"} />
    </Pressable>
  );
}
