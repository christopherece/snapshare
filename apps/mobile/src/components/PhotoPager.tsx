import Ionicons from "@expo/vector-icons/Ionicons";
import type { PhotoDTO } from "@snapshare/shared";
import { Image } from "expo-image";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { colors } from "../theme";

interface Props {
  /** The live list the viewer was opened from. */
  photos: PhotoDTO[];
  /** The photo to open on; null keeps the viewer closed. */
  openId: string | null;
  onClose: () => void;
  /** Ask for the next page when the viewer gets near the end. */
  onEndReached?: () => void;
  /** Double-tap on a photo. Return true to play the heart animation. */
  onDoubleTap?: (photo: PhotoDTO) => boolean;
  /** Controls drawn over the current photo. */
  children: (photo: PhotoDTO, position: { index: number; total: number }) => ReactNode;
}

/** Full-screen, swipeable photo viewer shared by the guest feed and the host gallery. */
export function PhotoPager({ openId, onClose, ...rest }: Props) {
  return (
    <Modal
      visible={openId !== null}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {openId !== null && <Pager key={openId} openId={openId} onClose={onClose} {...rest} />}
    </Modal>
  );
}

function Pager({ photos, openId, onClose, onEndReached, onDoubleTap, children }: Props & { openId: string }) {
  const { width, height } = useWindowDimensions();

  // New photos arrive at the front of the live list while someone is looking at one. Page through the
  // order as it was when the viewer opened, so the photo on screen never jumps; later pages (older
  // photos) are still appended, and edits and removals still show.
  const [opened] = useState(() => photos.map((p) => p.id));
  const pages = useMemo(() => {
    const known = new Set(opened);
    const live = new Map(photos.map((p) => [p.id, p]));
    const kept = opened.flatMap((id) => live.get(id) ?? []);
    let lastKnown = -1;
    photos.forEach((p, i) => {
      if (known.has(p.id)) lastKnown = i;
    });
    const older = photos.slice(lastKnown + 1).filter((p) => !known.has(p.id));
    return [...kept, ...older];
  }, [photos, opened]);

  const [index, setIndex] = useState(() => Math.max(0, opened.indexOf(openId)));
  const shown = Math.min(index, pages.length - 1);
  const current = pages[shown];

  // Callers pass fresh closures every render; keep the effects below keyed on position only.
  const callbacks = useRef({ onClose, onEndReached });
  callbacks.current = { onClose, onEndReached };

  // The last photo in view was removed (hidden, deleted…): nothing left to show.
  useEffect(() => {
    if (!pages.length) callbacks.current.onClose();
  }, [pages.length]);

  useEffect(() => {
    if (pages.length && shown >= pages.length - 3) callbacks.current.onEndReached?.();
  }, [shown, pages.length]);

  // Double-tap heart
  const heart = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);
  const onTap = (photo: PhotoDTO) => {
    const now = Date.now();
    const isDouble = now - lastTap.current < 280;
    lastTap.current = isDouble ? 0 : now;
    if (!isDouble || !onDoubleTap?.(photo)) return;
    heart.setValue(0);
    Animated.sequence([
      Animated.spring(heart, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(heart, { toValue: 0, duration: 220, delay: 260, useNativeDriver: true }),
    ]).start();
  };

  return (
    <View className="flex-1 bg-black">
      <FlatList
        data={pages}
        horizontal
        pagingEnabled
        initialScrollIndex={shown > 0 ? shown : undefined}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(p) => p.id}
        showsHorizontalScrollIndicator={false}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <Pressable onPress={() => onTap(item)} accessibilityLabel={item.guestName ? `Photo by ${item.guestName}` : "Photo"}>
            <Image
              source={{ uri: item.displayUrl }}
              placeholder={{ uri: item.thumbUrl }}
              placeholderContentFit="contain"
              style={{ width, height }}
              contentFit="contain"
              transition={150}
              recyclingKey={item.id}
            />
          </Pressable>
        )}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { alignItems: "center", justifyContent: "center", opacity: heart },
          { transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] },
        ]}
      >
        <Ionicons name="heart" size={112} color={colors.heart} />
      </Animated.View>

      {current && (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {children(current, { index: shown, total: pages.length })}
        </View>
      )}
    </View>
  );
}
