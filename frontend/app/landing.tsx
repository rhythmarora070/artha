import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Animated, { FadeInDown, FadeInUp, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, Easing } from "react-native-reanimated";
import Icon from "@react-native-vector-icons/material-design-icons";

import { useAuth } from "@/src/auth";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

const LETTERS = ["A", "R", "T", "H", "A"];

function Letter({ ch, index }: { ch: string; index: number }) {
  const { colors } = useTheme();
  const y = useSharedValue(40);
  const o = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(index * 120, withSpring(0, { damping: 12, stiffness: 120 }));
    o.value = withDelay(index * 120, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, [index, y, o]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: o.value }));
  return (
    <Animated.Text style={[styles.letter, { color: colors.onBrandPrimary }, style]}>{ch}</Animated.Text>
  );
}

/** Landing: animated ARTHA mark, then sign-in choices. */
export default function Landing() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang, setLang } = useLang();
  const { signInGoogle, signInDemo } = useAuth();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<"google" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setReady(true), 1100);
    return () => clearTimeout(id);
  }, []);

  async function run(kind: "google" | "demo", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch {
      setError(t("auth_failed", lang));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View testID="landing" style={[styles.wrap, { backgroundColor: colors.brandPrimary, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
      <Pressable testID="landing-lang" onPress={() => setLang(lang === "en" ? "hi" : "en")} style={[styles.lang, { backgroundColor: "rgba(255,255,255,0.14)" }]}>
        <Text style={{ color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.sm }}>{t("language_toggle", lang)}</Text>
      </Pressable>

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Animated.View entering={FadeInDown.duration(600)} style={[styles.mark, { borderColor: "rgba(255,255,255,0.35)" }]}>
          <Icon name="shield-star-outline" size={44} color={colors.onBrandPrimary} />
        </Animated.View>
        <View style={{ flexDirection: "row", marginTop: spacing.lg }}>
          {LETTERS.map((ch, i) => (
            <Letter key={i} ch={ch} index={i} />
          ))}
        </View>
        <Animated.Text entering={FadeInUp.delay(700).duration(600)} style={[styles.tag, { color: "rgba(255,255,255,0.85)" }]}>
          {t("app_tag", lang)}
        </Animated.Text>
        <Animated.Text entering={FadeInUp.delay(950).duration(600)} style={[styles.line, { color: "rgba(255,255,255,0.7)" }]}>
          {t("landing_line", lang)}
        </Animated.Text>
      </View>

      {ready ? (
        <Animated.View entering={FadeInUp.duration(500)} style={{ gap: spacing.sm }}>
          <Pressable testID="landing-google" disabled={!!busy} onPress={() => run("google", signInGoogle)} style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]}>
            {busy === "google" ? <ActivityIndicator color={colors.brandPrimary} /> : <Icon name="google" size={20} color={colors.onSurface} />}
            <Text style={[styles.btnTxt, { color: colors.onSurface }]}>{t("continue_google", lang)}</Text>
          </Pressable>
          <Pressable testID="landing-email" disabled={!!busy} onPress={() => router.push("/login" as any)} style={[styles.btn, { backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" }]}>
            <Icon name="email-outline" size={20} color={colors.onBrandPrimary} />
            <Text style={[styles.btnTxt, { color: colors.onBrandPrimary }]}>{t("continue_email", lang)}</Text>
          </Pressable>
          <Pressable testID="landing-demo" disabled={!!busy} onPress={() => run("demo", signInDemo)} style={[styles.btn, { backgroundColor: "transparent" }]}>
            {busy === "demo" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="play-circle-outline" size={20} color={colors.onBrandPrimary} />}
            <Text style={[styles.btnTxt, { color: colors.onBrandPrimary }]}>{t("explore_demo", lang)}</Text>
          </Pressable>
          {error ? <Text testID="landing-error" style={{ color: "#FFD9D4", textAlign: "center" }}>{error}</Text> : null}
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, textAlign: "center", marginTop: spacing.sm }}>{t("demo_note", lang)}</Text>
        </Animated.View>
      ) : (
        <View style={{ height: 200 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: spacing.xl },
  lang: { alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  mark: { width: 92, height: 92, borderRadius: 46, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  letter: { fontSize: 56, fontWeight: "800", letterSpacing: 6 },
  tag: { fontSize: font.lg, marginTop: spacing.sm },
  line: { fontSize: font.base, marginTop: spacing.xl, textAlign: "center", paddingHorizontal: spacing.lg, lineHeight: 22 },
  btn: { height: 52, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  btnTxt: { fontWeight: "700", fontSize: font.lg, marginLeft: spacing.sm },
});
