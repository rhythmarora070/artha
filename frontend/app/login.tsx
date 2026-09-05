import { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { useAuth } from "@/src/auth";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const { signInEmail, signUpEmail } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = /\S+@\S+\.\S+/.test(email) && password.length >= 8;

  async function submit() {
    if (!valid) {
      setError(`${t("email")} / ${t("password_hint", lang)}`.replace("undefined", t("email", lang)));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "in") await signInEmail(email.trim(), password);
      else await signUpEmail(email.trim(), password, name.trim());
    } catch (e: any) {
      const msg = String(e?.message || "");
      setError(msg.includes("409") ? msg.replace(/^API \d+: /, "") : t("auth_failed", lang));
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { color: colors.onSurface, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + spacing.sm, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md }}>
        <Pressable testID="login-back" onPress={() => router.back()} style={{ padding: 8 }}>
          <Icon name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.onSurface, fontSize: 30, fontWeight: "800" }}>{mode === "in" ? t("sign_in", lang) : t("sign_up", lang)}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>{t("app_tag", lang)}</Text>

        {mode === "up" ? (
          <>
            <Text style={[styles.label, { color: colors.muted }]}>{t("your_name", lang)}</Text>
            <TextInput testID="login-name" value={name} onChangeText={setName} placeholder="Priya" placeholderTextColor={colors.muted} style={input} />
          </>
        ) : null}
        <Text style={[styles.label, { color: colors.muted }]}>{t("email", lang)}</Text>
        <TextInput testID="login-email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" placeholderTextColor={colors.muted} style={input} />
        <Text style={[styles.label, { color: colors.muted }]}>{t("password", lang)}</Text>
        <TextInput testID="login-password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder={t("password_hint", lang)} placeholderTextColor={colors.muted} style={input} onSubmitEditing={submit} returnKeyType="go" />

        {error ? <Text testID="login-error" style={{ color: colors.error, marginTop: spacing.md }}>{error}</Text> : null}

        <Pressable testID="login-submit" onPress={submit} disabled={busy} style={[styles.btn, { backgroundColor: busy ? colors.muted : colors.brandPrimary }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.lg }}>{mode === "in" ? t("sign_in", lang) : t("sign_up", lang)}</Text>}
        </Pressable>
        <Pressable testID="login-switch" onPress={() => { setMode(mode === "in" ? "up" : "in"); setError(null); }} style={{ marginTop: spacing.lg, alignItems: "center" }}>
          <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>{mode === "in" ? t("no_account", lang) : t("have_account", lang)}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: font.sm, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.xl, marginBottom: spacing.sm },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 14, fontSize: font.lg },
  btn: { height: 54, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginTop: spacing.xl },
});
