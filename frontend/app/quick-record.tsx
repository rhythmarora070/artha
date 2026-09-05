import { View, Text, Pressable, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";
import { useState } from "react";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

const DEFAULT_CATEGORIES = ["Food", "Groceries", "Transport", "Travel", "Rent", "Shopping", "Subscription", "Utilities", "Education", "Entertainment", "Transfer", "Salary", "Fees", "Investment", "Health", "Personal", "Uncategorized"];

export default function QuickRecord() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"paid" | "received">("paid");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Personal");
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const { data: categories = DEFAULT_CATEGORIES } = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const accountId = pickedAccount ?? accounts[0]?.id ?? null;

  async function save() {
    const amt = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(`${t("invalid_amount", lang)} — ${t("invalid_amount_body", lang)}`);
      return;
    }
    if (!accountId) return;
    const acc = accounts.find((a) => a.id === accountId);
    setSaving(true);
    setError(null);
    try {
      await api.createTransaction({
        account_id: accountId,
        amount: Math.round(amt * 100) / 100,
        type,
        category,
        description: description.trim(),
        source: acc?.type || "Bank",
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      qc.invalidateQueries();
      router.back();
    } catch {
      setError(`${t("save_failed", lang)} — ${t("offline_hint", lang)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingTop: insets.top + spacing.sm, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Pressable testID="qr-close" onPress={() => router.back()} style={{ padding: 8 }}>
          <Icon name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", fontSize: font.lg, fontWeight: "700", color: colors.onSurface }}>
          {t("record_money", lang)}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }} keyboardShouldPersistTaps="handled">
        {/* Paid/Received */}
        <View style={[styles.toggle, { backgroundColor: colors.surfaceTertiary }]}>
          {(["paid", "received"] as const).map((k) => (
            <Pressable
              key={k}
              testID={`qr-type-${k}`}
              onPress={() => setType(k)}
              style={[
                styles.toggleBtn,
                {
                  backgroundColor: type === k ? colors.surfaceSecondary : "transparent",
                },
              ]}
            >
              <Text style={{ color: type === k ? colors.onSurface : colors.muted, fontWeight: "700" }}>
                {t(k, lang)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Amount */}
        <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
          <Text style={{ color: colors.muted, fontSize: font.sm, textTransform: "uppercase", letterSpacing: 0.8 }}>
            {t("amount", lang)}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
            <Text style={{ fontSize: 44, fontWeight: "300", color: colors.muted }}>₹</Text>
            <TextInput
              testID="qr-amount"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.muted}
              style={{ fontSize: 48, fontWeight: "700", color: colors.onSurface, minWidth: 120, textAlign: "center" }}
              autoFocus
            />
          </View>
          {error ? (
            <Text testID="qr-error" style={{ color: colors.error, marginTop: spacing.sm, fontSize: font.sm, textAlign: "center" }}>
              {error}
            </Text>
          ) : null}
        </View>

        {/* Description */}
        <Text style={styles.label(colors)}>{t("what_was_this_for", lang)}</Text>
        <TextInput
          testID="qr-description"
          value={description}
          onChangeText={setDescription}
          placeholder={lang === "hi" ? "जैसे: राहुल के साथ डिनर" : "e.g. Dinner with Rahul"}
          placeholderTextColor={colors.muted}
          style={styles.input(colors)}
        />

        {/* Category */}
        <Text style={styles.label(colors)}>{t("category", lang)}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerStyle={{ gap: spacing.sm }}>
          {categories.map((c) => {
            const active = c === category;
            return (
              <Pressable
                key={c}
                testID={`qr-cat-${c}`}
                onPress={() => setCategory(c)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.brandPrimary : colors.surfaceTertiary,
                    borderColor: active ? colors.brandPrimary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary, fontWeight: "600" }}>{c}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Account */}
        <Text style={styles.label(colors)}>{t("account_source", lang)}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerStyle={{ gap: spacing.sm }}>
          {accounts.map((a) => {
            const active = a.id === accountId;
            return (
              <Pressable
                key={a.id}
                testID={`qr-acc-${a.name}`}
                onPress={() => setPickedAccount(a.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.brandPrimary : colors.surfaceTertiary,
                    borderColor: active ? colors.brandPrimary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary, fontWeight: "600" }}>
                  {a.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Reference */}
        <Text style={styles.label(colors)}>{t("reference", lang)}</Text>
        <TextInput
          testID="qr-reference"
          value={reference}
          onChangeText={setReference}
          placeholder="—"
          placeholderTextColor={colors.muted}
          style={styles.input(colors)}
        />

        {/* Note */}
        <Text style={styles.label(colors)}>{t("note", lang)}</Text>
        <TextInput
          testID="qr-note"
          value={note}
          onChangeText={setNote}
          placeholder="—"
          placeholderTextColor={colors.muted}
          style={styles.input(colors)}
        />
      </ScrollView>

      <View style={[styles.saveBar, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.divider }]}>
        <Pressable
          testID="qr-save"
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: saving ? colors.muted : colors.brandPrimary }]}
        >
          <Icon name="check" size={24} color={colors.onBrandPrimary} />
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.lg, marginLeft: 6 }}>
            {t("save", lang)}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles: any = {
  toggle: {
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.pill,
  },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.pill, alignItems: "center" },
  label: (c: any) => ({
    color: c.muted,
    fontSize: font.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  }),
  input: (c: any) => ({
    backgroundColor: c.surfaceSecondary,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: font.lg,
    color: c.onSurface,
  }),
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  saveBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    borderTopWidth: 1,
  },
  saveBtn: {
    height: 56,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
};
