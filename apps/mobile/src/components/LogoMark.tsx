import { Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

/** The SnapShare mark — the same geometry as packages/brand/scripts/generate.ts. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" accessibilityLabel="SnapShare">
      <Defs>
        <LinearGradient id="logo-bg" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0" stopColor="#2a2825" />
          <Stop offset="1" stopColor="#151413" />
        </LinearGradient>
        <RadialGradient id="logo-dot" cx="38%" cy="32%" r="75%">
          <Stop offset="0" stopColor="#e2c79c" />
          <Stop offset="1" stopColor="#b8925e" />
        </RadialGradient>
      </Defs>
      <Rect width="512" height="512" rx="116" fill="url(#logo-bg)" />
      <Rect x="134" y="134" width="244" height="244" rx="68" fill="none" stroke="#f4efe7" strokeWidth="30" />
      <Circle cx="256" cy="256" r="58" fill="url(#logo-dot)" />
    </Svg>
  );
}

/** Mark + wordmark, as on the website. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <LogoMark size={size} />
      <Text className="font-serif text-ink dark:text-paper" style={{ fontSize: size * 0.76 }}>
        SnapShare
      </Text>
    </View>
  );
}
