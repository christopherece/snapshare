import Ionicons from "@expo/vector-icons/Ionicons";
import { type CameraOrientation, type CameraType, CameraView, type FlashMode, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ComponentProps, type ComponentRef, useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Linking,
  type NativeTouchEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { photoCorrection, watchHeldOrientation } from "../lib/orientation";
import { enqueuePhoto, usePendingCount } from "../lib/upload-queue";
import { colors } from "../theme";
import { UploadStatus } from "./UploadStatus";
import { Divider, Row, Sheet } from "./ui";

interface Props {
  eventId: string;
  eventName: string;
  guestName: string | null;
  guestToken: string;
  onOpenGallery: () => void;
  /** Back to the app's home screen; the guest stays joined. */
  onHome: () => void;
  /** Forget this event on this phone. */
  onLeave: () => void;
  /** Go through the join screen again for a fresh session. */
  onRejoin: () => void;
}

const FLASH_CYCLE: FlashMode[] = ["off", "auto", "on"];
const FLASH_ICON: Record<FlashMode, keyof typeof Ionicons.glyphMap> = {
  off: "flash-off-outline",
  auto: "flash-outline",
  on: "flash",
  screen: "phone-portrait-outline",
};
const GALLERY_SIZE = 48;
/** Most a guest can add from their library in one go. */
const LIBRARY_LIMIT = 20;

/** Icon rotation that keeps controls upright while the UI stays portrait (landscapeRight = turned clockwise). */
const ICON_ROTATION: Record<CameraOrientation, number> = {
  portrait: 0,
  landscapeRight: -90,
  landscapeLeft: 90,
  portraitUpsideDown: 180,
};

const touchDistance = (touches: readonly NativeTouchEvent[]) =>
  Math.hypot(touches[0]!.pageX - touches[1]!.pageX, touches[0]!.pageY - touches[1]!.pageY);

/**
 * Guest camera: one-tap capture with flash feedback, haptics, and a thumbnail
 * that "flies" into the gallery button. Capture never waits on the network —
 * photos go straight into the persistent upload queue.
 */
export function EventCamera({ eventId, eventName, guestName, guestToken, onOpenGallery, onHome, onLeave, onRejoin }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const galleryRef = useRef<ComponentRef<typeof View>>(null);

  const [focused, setFocused] = useState(true);
  const [ready, setReady] = useState(false);
  const [mountError, setMountError] = useState(false);
  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(0);
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

  // The layout stays portrait like the system camera; only the icons turn to face the user.
  const iconAngle = useRef(new Animated.Value(0)).current;
  const iconSpin = { transform: [{ rotate: iconAngle.interpolate({ inputRange: [-180, 180], outputRange: ["-180deg", "180deg"] }) }] };
  const onOrientation = useCallback(
    ({ orientation }: { orientation: CameraOrientation }) => {
      Animated.timing(iconAngle, {
        toValue: ICON_ROTATION[orientation] ?? 0,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    },
    [iconAngle],
  );

  // Release the camera while another screen (the feed) is on top.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const stopWatching = watchHeldOrientation(); // Android: landscape shots come out landscape
      return () => {
        stopWatching();
        setFocused(false);
        setReady(false);
      };
    }, []),
  );

  // ─── Pinch to zoom ────────────────────────────────────────────────────────
  // CameraView's zoom runs 0–1 across the lens's range; a pinch moves along it logarithmically so it
  // feels the same at any zoom level.

  const zoomRef = useRef(0);
  const pinch = useRef({ distance: 0, zoom: 0 });
  const applyZoom = useCallback((value: number) => {
    const next = Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
    if (next === zoomRef.current) return;
    zoomRef.current = next;
    setZoom(next);
  }, []);
  const pinchResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
        onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
        onPanResponderGrant: (e) => {
          const { touches } = e.nativeEvent;
          pinch.current = { distance: touches.length === 2 ? touchDistance(touches) : 0, zoom: zoomRef.current };
        },
        onPanResponderMove: (e) => {
          const { touches } = e.nativeEvent;
          if (touches.length !== 2) return;
          const distance = touchDistance(touches);
          if (!pinch.current.distance) {
            pinch.current = { distance, zoom: zoomRef.current };
            return;
          }
          applyZoom(pinch.current.zoom + Math.log2(distance / pinch.current.distance) * 0.3);
        },
        onPanResponderRelease: () => {
          pinch.current.distance = 0;
        },
        onPanResponderTerminate: () => {
          pinch.current.distance = 0;
        },
      }),
    [applyZoom],
  );

  // ─── Capture ──────────────────────────────────────────────────────────────

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
      const rotate = photoCorrection(photo.width, photo.height);
      enqueuePhoto({ uri: photo.uri, width: photo.width, height: photo.height, rotate, eventId, guestToken }).catch((err) => {
        console.warn("Failed to queue photo", err);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("That photo couldn't be saved", "Your phone may be out of storage. Free up some space and try again.");
      });
    } catch (err) {
      console.warn("Capture failed", err);
      setFrontFlash(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      capturing.current = false;
    }
    // Animated values and play* helpers are stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, facing, flash, eventId, guestToken]);

  // ─── Add from the photo library ───────────────────────────────────────────
  // Uses the system photo picker, which needs no library permission: the guest hands over only
  // the photos they choose.

  const addFromLibrary = useCallback(async () => {
    setMenuOpen(false);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: LIBRARY_LIMIT,
        orderedSelection: true,
        quality: 1,
        exif: false,
      });
      if (picked.canceled || !picked.assets.length) return;

      let failed = 0;
      setImporting(picked.assets.length);
      for (const [i, asset] of picked.assets.entries()) {
        try {
          const local = await enqueuePhoto({
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            eventId,
            guestToken,
            // The picker hands us a copy in our cache — tidy it up; never touch anything else.
            deleteSource: !!FileSystem.cacheDirectory && asset.uri.startsWith(FileSystem.cacheDirectory),
          });
          setLastThumb(local);
        } catch (err) {
          console.warn("Failed to queue library photo", err);
          failed++;
        }
        setImporting(picked.assets.length - i - 1);
      }
      if (failed) {
        Alert.alert(
          failed === picked.assets.length ? "Those photos couldn't be added" : `${failed} of your photos couldn't be added`,
          "They may be in a format this phone can't convert, or your storage is full.",
        );
      } else {
        void Haptics.selectionAsync();
      }
    } catch (err) {
      console.warn("Photo picker failed", err);
      Alert.alert("Couldn't open your photos", "Please try again.");
    } finally {
      setImporting(0);
    }
  }, [eventId, guestToken]);

  const confirmLeave = () => {
    setMenuOpen(false);
    Alert.alert(
      `Leave ${eventName}?`,
      pendingCount > 0
        ? "Photos still waiting to upload will keep uploading. You can rejoin any time with the event code."
        : "You can rejoin any time with the event code.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave event", style: "destructive", onPress: onLeave },
      ],
    );
  };

  // ─── Permission states ────────────────────────────────────────────────────

  if (!permission) return <View className="flex-1 bg-black" />;

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-10">
        <StatusBar style="light" />
        <Ionicons name="camera-outline" size={44} color={colors.gold} />
        <Text className="mt-5 text-center font-serif text-3xl text-white">Share the moment</Text>
        <Text className="mt-2 text-center text-base leading-6 text-white/60">
          Allow camera access to take photos that appear live at {eventName}.
        </Text>
        <Pressable
          onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
          accessibilityRole="button"
          className="mt-8 rounded-full bg-white px-8 py-3 active:opacity-80"
        >
          <Text className="text-base font-medium text-black">{permission.canAskAgain ? "Enable camera" : "Open settings"}</Text>
        </Pressable>
        <Pressable onPress={addFromLibrary} accessibilityRole="button" hitSlop={8} className="mt-5 py-2">
          <Text className="text-base text-white/80 underline">Add photos from your library instead</Text>
        </Pressable>
        <Pressable onPress={onHome} accessibilityRole="button" hitSlop={8} className="mt-1 py-2">
          <Text className="text-sm text-white/50">Back to home</Text>
        </Pressable>
        <View className="absolute left-0 right-0" style={{ bottom: insets.bottom + 32 }}>
          <UploadStatus eventId={eventId} onRejoin={onRejoin} importing={importing} />
        </View>
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
      {focused && <StatusBar style="light" />}
      {focused && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          zoom={zoom}
          animateShutter={false}
          // iOS: save landscape photos when the phone is turned, even though the UI is locked to portrait.
          responsiveOrientationWhenOrientationLocked
          onResponsiveOrientationChanged={onOrientation}
          onCameraReady={() => {
            setReady(true);
            setMountError(false);
          }}
          onMountError={(e) => {
            console.warn("Camera mount error", e.message);
            setMountError(true);
          }}
        />
      )}

      {/* Two-finger pinch anywhere on the preview zooms; the controls sit above this layer. */}
      <View style={StyleSheet.absoluteFill} {...pinchResponder.panHandlers} />

      {showGrid && <GridOverlay />}

      {mountError && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill} className="items-center justify-center px-10">
          <Ionicons name="videocam-off-outline" size={36} color="#fff" />
          <Text className="mt-3 text-center text-base text-white/80">
            The camera couldn't start. Close other camera apps and come back, or add photos from your library.
          </Text>
        </View>
      )}

      {/* Capture flash + front "screen flash" */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", opacity: flashOpacity }]} />
      {frontFlash && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#fff" }]} />}

      {/* Top bar */}
      <View
        pointerEvents="box-none"
        className="absolute left-0 right-0 flex-row items-center justify-between px-4"
        style={{ top: insets.top + 8 }}
      >
        <View className="flex-row gap-2">
          <IconButton icon="ellipsis-horizontal" label="Event menu" onPress={() => setMenuOpen(true)} spin={iconSpin} />
          <IconButton
            icon={FLASH_ICON[flash]}
            label={`Flash ${flash}`}
            onPress={() => setFlash(FLASH_CYCLE[(FLASH_CYCLE.indexOf(flash) + 1) % FLASH_CYCLE.length]!)}
            active={flash !== "off"}
            spin={iconSpin}
          />
        </View>
        <Text numberOfLines={1} className="mx-2 flex-1 text-center text-[13px] font-medium tracking-widest text-white/90">
          {eventName.toUpperCase()}
        </Text>
        <View className="flex-row gap-2">
          <IconButton icon="grid-outline" label="Toggle grid" onPress={() => setShowGrid((g) => !g)} active={showGrid} spin={iconSpin} />
          <IconButton icon="add" label="Add photos from your library" size={26} onPress={addFromLibrary} spin={iconSpin} />
        </View>
      </View>

      {/* Status + zoom, just above the controls */}
      <View pointerEvents="box-none" className="absolute left-0 right-0 items-center gap-3" style={{ bottom: insets.bottom + 128 }}>
        {zoom > 0 && (
          <Pressable
            onPress={() => applyZoom(0)}
            accessibilityRole="button"
            accessibilityLabel="Reset zoom"
            className="flex-row items-center gap-1.5 rounded-full bg-black/55 px-3.5 py-1.5"
          >
            <Ionicons name="search" size={14} color={colors.gold} />
            <Text className="text-[13px] font-medium text-white">Zoomed · tap to reset</Text>
          </Pressable>
        )}
        <UploadStatus eventId={eventId} onRejoin={onRejoin} importing={importing} />
      </View>

      {/* Bottom bar */}
      <View
        pointerEvents="box-none"
        className="absolute left-0 right-0 flex-row items-center justify-between px-10"
        style={{ bottom: insets.bottom + 28 }}
      >
        <Pressable
          ref={galleryRef}
          onLayout={measureGallery}
          onPress={onOpenGallery}
          accessibilityRole="button"
          accessibilityLabel="Open event gallery"
          className="items-center justify-center overflow-hidden rounded-xl border-2 border-white/80 bg-white/10"
          style={{ width: GALLERY_SIZE, height: GALLERY_SIZE }}
        >
          <Animated.View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }, iconSpin]}>
            {lastThumb ? (
              <Image source={{ uri: lastThumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
            ) : (
              <Ionicons name="images-outline" size={22} color="#fff" />
            )}
          </Animated.View>
          {pendingCount > 0 && (
            <View className="absolute -right-0.5 -top-0.5 min-w-[18px] items-center rounded-full bg-accent px-1">
              <Text className="text-[11px] font-semibold text-black">{pendingCount}</Text>
            </View>
          )}
        </Pressable>

        <Pressable onPress={takePhoto} disabled={!ready} accessibilityRole="button" accessibilityLabel="Take photo" hitSlop={12}>
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
          spin={iconSpin}
          onPress={() => {
            void Haptics.selectionAsync();
            setReady(false);
            applyZoom(0);
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

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={eventName}>
        <Text className="-mt-2 mb-2 text-sm text-muted dark:text-muted-dark">
          {guestName ? `Sharing as ${guestName}` : "Sharing as a guest"}
        </Text>
        <Row
          icon="images-outline"
          title="Event gallery"
          detail="See everyone's photos, live"
          onPress={() => {
            setMenuOpen(false);
            onOpenGallery();
          }}
        />
        <Divider />
        <Row icon="add-circle-outline" title="Add photos from your library" onPress={addFromLibrary} />
        <Divider />
        <Row
          icon="home-outline"
          title="Back to home"
          detail="You stay joined to this event"
          onPress={() => {
            setMenuOpen(false);
            onHome();
          }}
        />
        <Divider />
        <Row icon="exit-outline" title="Leave this event" danger onPress={confirmLeave} />
      </Sheet>
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
  spin,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  size?: number;
  spin?: ComponentProps<typeof Animated.View>["style"];
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-full bg-black/30 active:bg-black/50"
    >
      <Animated.View style={spin}>
        <Ionicons name={icon} size={size} color={active ? colors.gold : "#fff"} />
      </Animated.View>
    </Pressable>
  );
}
