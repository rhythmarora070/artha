import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, AppState, Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import Icon from "@react-native-vector-icons/material-design-icons";

import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

const RELOCK_AFTER_MS = 60_000;

export async function biometricsAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/**
 * Biometric app lock (Face ID / fingerprint). Locks on launch and when the app returns
 * from background after 60s. Web has no biometrics, so the lock is simply not enforced.
 */
export function AppLock({ enabled, children, lockSignal }: { enabled: boolean; children: React.ReactNode; lockSignal: number }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const [locked, setLocked] = useState(enabled && Platform.OS !== "web");
  const [error, setError] = useState<string | null>(null);
  const bg = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setError(null);
    try {
      if (!(await biometricsAvailable())) {
        setLocked(false);
        return;
      }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("unlock", lang), cancelLabel: t("cancel", lang), disableDeviceFallback: false });
      if (r.success) setLocked(false);
    } catch {
      setError(t("biometrics_unavailable", lang));
      setLocked(false);
    }
  }, [lang]);

  useEffect(() => {
    if (!enabled || Platform.OS === "web") {
      setLocked(false);
      return;
    }
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background" || s === "inactive") bg.current = Date.now();
      else if (s === "active" && bg.current && Date.now() - bg.current > RELOCK_AFTER_MS) setLocked(true);
    });
    return () => sub.remove();
  }, [enabled]);

  useEffect(() => {
    if (lockSignal > 0 && enabled && Platform.OS !== "web") setLocked(true);
  }, [lockSignal, enabled]);

  useEffect(() => {
    if (locked) unlock();
  }, [locked, unlock]);

  if (!locked) return <>{children}</>;
  return (
    <View testID="app-lock" style={[styles.wrap, { backgroundColor: colors.surface }]}>
      <View style={[styles.badge, { backgroundColor: colors.brandTertiary }]}>
        <Icon name="shield-lock-outline" size={40} color={colors.brandPrimary} />
      </View>
      <Text style={{ color: colors.onSurface, fontSize: 28, fontWeight: "800", letterSpacing: 2, marginTop: spacing.lg }}>ARTHA</Text>
      <Text style={{ color: colors.muted, marginTop: spacing.sm }}>{t("locked_msg", lang)}</Text>
      {error ? <Text style={{ color: colors.error, marginTop: spacing.sm, textAlign: "center", paddingHorizontal: spacing.xl }}>{error}</Text> : null}
      <Pressable testID="app-unlock" onPress={unlock} style={[styles.btn, { backgroundColor: colors.brandPrimary }]}>
        <Icon name="fingerprint" size={22} color={colors.onBrandPrimary} />
        <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.lg, marginLeft: spacing.sm }}>{t("unlock", lang)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  badge: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  btn: { flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: spacing.xl, borderRadius: radius.pill, marginTop: spacing.xxl },
});
