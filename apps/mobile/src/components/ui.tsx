import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentRef, ReactElement, ReactNode, Ref } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PRIVACY_URL, TERMS_URL } from "../lib/config";
import { colors, useTheme } from "../theme";

/** What a ref to a `Field` points at. */
export type InputRef = ComponentRef<typeof TextInput>;

export type IconName = keyof typeof Ionicons.glyphMap;

/** Open a web page in the browser, without crashing when nothing can handle it. */
export const openUrl = (url: string) =>
  Linking.openURL(url).catch(() => Alert.alert("Couldn't open the link", url));

// ─── Layout ───────────────────────────────────────────────────────────────────

export function Screen({
  children,
  scroll = false,
  padded = true,
  refreshControl,
}: {
  children: ReactNode;
  /** Wrap the content in a keyboard-friendly scroll view. */
  scroll?: boolean;
  padded?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const insets = useSafeAreaInsets();
  const px = padded ? 20 : 0;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-paper dark:bg-ink-deep"
      style={{ paddingTop: insets.top }}
    >
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: px, paddingBottom: insets.bottom + 28 }}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: px }}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

export function TopBar({
  title,
  onBack,
  backIcon = "chevron-back",
  backLabel = "Back",
  right,
}: {
  title?: string;
  onBack?: () => void;
  backIcon?: IconName;
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <View className="h-14 flex-row items-center justify-between">
      <View className="w-11">
        {onBack && <IconButton icon={backIcon} label={backLabel} onPress={onBack} />}
      </View>
      <Text numberOfLines={1} className="flex-1 px-2 text-center text-base font-medium text-ink dark:text-paper">
        {title ?? ""}
      </Text>
      <View className="min-w-[44px] items-end">{right}</View>
    </View>
  );
}

// ─── Text ─────────────────────────────────────────────────────────────────────

export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Text className={`text-xs font-semibold uppercase tracking-[2px] text-accent-deep dark:text-accent ${className}`}>
      {children}
    </Text>
  );
}

/** Display heading in the brand serif. (The custom font has one weight — never combine it with font-bold.) */
export function Heading({
  children,
  size = "lg",
  className = "",
  numberOfLines,
}: {
  children: ReactNode;
  size?: "md" | "lg" | "xl";
  className?: string;
  numberOfLines?: number;
}) {
  const sizes = { md: "text-2xl leading-8", lg: "text-4xl leading-[42px]", xl: "text-5xl leading-[54px]" };
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={numberOfLines}
      className={`font-serif text-ink dark:text-paper ${sizes[size]} ${className}`}
    >
      {children}
    </Text>
  );
}

export function Muted({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Text className={`text-base leading-6 text-muted dark:text-muted-dark ${className}`}>{children}</Text>;
}

// ─── Controls ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";

const BUTTON_BOX: Record<ButtonVariant, string> = {
  primary: "bg-ink dark:bg-paper",
  accent: "bg-accent",
  secondary: "border border-ink/15 bg-white dark:border-white/15 dark:bg-ink-soft",
  ghost: "",
  danger: "border border-danger/30 dark:border-danger-soft/40",
};
const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: "text-paper dark:text-ink",
  accent: "text-ink",
  secondary: "text-ink dark:text-paper",
  ghost: "text-ink dark:text-paper",
  danger: "text-danger dark:text-danger-soft",
};

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  loading = false,
  disabled = false,
  className = "",
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: "md" | "lg";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const theme = useTheme();
  const tint =
    variant === "primary"
      ? theme.dark
        ? colors.ink
        : colors.paper
      : variant === "accent"
        ? colors.ink
        : variant === "danger"
          ? theme.danger
          : theme.fg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      className={`flex-row items-center justify-center gap-2 rounded-2xl px-5 active:opacity-80 ${size === "lg" ? "h-14" : "h-11"} ${BUTTON_BOX[variant]} ${disabled || loading ? "opacity-50" : ""} ${className}`}
    >
      {loading ? <ActivityIndicator color={tint} /> : icon && <Ionicons name={icon} size={size === "lg" ? 20 : 18} color={tint} />}
      <Text className={`font-semibold ${size === "lg" ? "text-base" : "text-sm"} ${BUTTON_TEXT[variant]}`}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  size = 22,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  badge?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-11 w-11 items-center justify-center rounded-full active:bg-black/5 dark:active:bg-white/10"
    >
      <Ionicons name={icon} size={size} color={theme.fg} />
      {badge && <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-accent" />}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  className = "",
  ref,
  ...input
}: TextInputProps & { label?: string; hint?: string; className?: string; ref?: Ref<InputRef> }) {
  const theme = useTheme();
  return (
    <View className={className}>
      {label && <Text className="mb-1.5 text-sm font-medium text-ink dark:text-paper">{label}</Text>}
      <TextInput
        ref={ref}
        accessibilityLabel={label ?? input.placeholder}
        placeholderTextColor={theme.placeholder}
        selectionColor={colors.gold}
        {...input}
        className={`h-14 rounded-2xl border border-ink/10 bg-white px-4 text-base text-ink dark:border-white/10 dark:bg-ink-soft dark:text-paper ${input.editable === false ? "opacity-60" : ""}`}
      />
      {hint && <Text className="mt-1.5 text-xs text-muted dark:text-muted-dark">{hint}</Text>}
    </View>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <View className={`rounded-3xl border border-ink/5 bg-white p-5 dark:border-white/10 dark:bg-ink-soft ${className}`}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Text className={`text-lg font-semibold text-ink dark:text-paper ${className}`}>{children}</Text>;
}

type Tone = "info" | "warn" | "error" | "success";
const NOTICE: Record<Tone, { box: string; text: string; icon: IconName }> = {
  info: { box: "bg-ink/5 dark:bg-white/10", text: "text-ink dark:text-paper", icon: "information-circle-outline" },
  warn: { box: "bg-accent/20 dark:bg-accent/15", text: "text-ink dark:text-paper", icon: "alert-circle-outline" },
  error: { box: "bg-danger/10 dark:bg-danger-soft/15", text: "text-danger dark:text-danger-soft", icon: "warning-outline" },
  success: { box: "bg-emerald-600/10 dark:bg-emerald-400/15", text: "text-emerald-800 dark:text-emerald-300", icon: "checkmark-circle-outline" },
};

export function Notice({ tone = "info", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  const theme = useTheme();
  const n = NOTICE[tone];
  const tint = tone === "error" ? theme.danger : tone === "success" ? (theme.dark ? "#6ee7b7" : "#065f46") : theme.fg;
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      className={`flex-row gap-2.5 rounded-2xl px-4 py-3 ${n.box} ${className}`}
    >
      <Ionicons name={n.icon} size={18} color={tint} style={{ marginTop: 1 }} />
      <Text className={`flex-1 text-sm leading-5 ${n.text}`}>{children}</Text>
    </View>
  );
}

export function Chip({
  label,
  count,
  selected,
  onPress,
  alert = false,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
  /** Draw attention (e.g. open reports). */
  alert?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 ${
        selected
          ? "border-ink bg-ink dark:border-paper dark:bg-paper"
          : alert
            ? "border-danger/40 bg-danger/10 dark:border-danger-soft/40 dark:bg-danger-soft/15"
            : "border-ink/10 bg-white dark:border-white/10 dark:bg-ink-soft"
      }`}
    >
      <Text className={`text-sm font-medium ${selected ? "text-paper dark:text-ink" : "text-ink dark:text-paper"}`}>{label}</Text>
      {count !== undefined && (
        <Text className={`text-xs ${selected ? "text-paper/70 dark:text-ink/60" : "text-muted dark:text-muted-dark"}`}>{count}</Text>
      )}
    </Pressable>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-4 py-3">
      <View className="flex-1">
        <Text className="text-base font-medium text-ink dark:text-paper">{title}</Text>
        {description && <Text className="mt-0.5 text-sm leading-5 text-muted dark:text-muted-dark">{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ false: "#c9c3ba", true: colors.goldDeep }}
        thumbColor={Platform.OS === "android" ? "#ffffff" : undefined}
        ios_backgroundColor="#c9c3ba"
      />
    </View>
  );
}

/** A tappable settings-style row. */
export function Row({
  icon,
  title,
  detail,
  onPress,
  danger = false,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const theme = useTheme();
  const tint = danger ? theme.danger : theme.fg;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="min-h-[52px] flex-row items-center gap-3.5 py-2.5 active:opacity-60"
    >
      <Ionicons name={icon} size={21} color={tint} />
      <View className="flex-1">
        <Text className={`text-base ${danger ? "text-danger dark:text-danger-soft" : "text-ink dark:text-paper"}`}>{title}</Text>
        {detail && <Text className="mt-0.5 text-sm text-muted dark:text-muted-dark">{detail}</Text>}
      </View>
      {!danger && <Ionicons name="chevron-forward" size={18} color={theme.muted} />}
    </Pressable>
  );
}

export function Divider() {
  return <View className="h-px bg-ink/10 dark:bg-white/10" />;
}

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View className="items-center px-8 py-14">
      <Ionicons name={icon} size={40} color={theme.accent} />
      <Text className="mt-4 text-center font-serif text-2xl text-ink dark:text-paper">{title}</Text>
      {body && <Text className="mt-2 text-center text-base leading-6 text-muted dark:text-muted-dark">{body}</Text>}
      {children && <View className="mt-6 self-stretch">{children}</View>}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View className="flex-1 items-center justify-center py-16" accessibilityLabel={label ?? "Loading"}>
      <ActivityIndicator color={theme.accent} />
      {label && <Text className="mt-3 text-sm text-muted dark:text-muted-dark">{label}</Text>}
    </View>
  );
}

// ─── Bottom sheet ─────────────────────────────────────────────────────────────

/**
 * A simple bottom sheet. By default it's its own modal; pass `inline` when it's shown from inside
 * another modal (the photo viewer) — stacking native modals is unreliable.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  inline = false,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  inline?: boolean;
}) {
  const insets = useSafeAreaInsets();
  if (inline && !visible) return null;

  const body = (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={StyleSheet.absoluteFill}>
      <Pressable accessibilityLabel="Close" onPress={onClose} className="flex-1 bg-black/50" />
      <View
        className="rounded-t-[28px] bg-paper px-5 pt-3 dark:bg-ink-soft"
        style={{ paddingBottom: insets.bottom + 16, marginTop: -28 }}
      >
        <View className="mb-4 h-1 w-10 self-center rounded-full bg-ink/15 dark:bg-white/20" />
        {title && <Text className="mb-3 font-serif text-2xl text-ink dark:text-paper">{title}</Text>}
        {children}
      </View>
    </KeyboardAvoidingView>
  );

  if (inline) return <View style={StyleSheet.absoluteFill}>{body}</View>;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {body}
    </Modal>
  );
}

// ─── Legal ────────────────────────────────────────────────────────────────────

export function LegalLinks({ prefix, className = "" }: { prefix?: string; className?: string }) {
  const link = "font-medium text-ink underline dark:text-paper";
  return (
    <Text className={`text-center text-xs leading-5 text-muted dark:text-muted-dark ${className}`}>
      {prefix ? `${prefix} ` : ""}
      <Text className={link} onPress={() => openUrl(TERMS_URL)} accessibilityRole="link">
        Terms
      </Text>
      {prefix ? " and " : "  ·  "}
      <Text className={link} onPress={() => openUrl(PRIVACY_URL)} accessibilityRole="link">
        Privacy notice
      </Text>
      {prefix ? "." : ""}
    </Text>
  );
}
