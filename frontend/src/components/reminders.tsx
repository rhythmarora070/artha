import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR, Reminder } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

/** In-app commitment reminders: due within 24h or overdue. Mark paid / snooze one day. */
export function RemindersCard({ reminders, compact }: { reminders: Reminder[]; compact?: boolean }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  if (!reminders.length) {
    if (compact) return null;
    return (
      <View style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, flexDirection: "row", alignItems: "center" }]}>
        <Icon name="bell-check-outline" size={18} color={colors.success} />
        <Text style={{ color: colors.muted, marginLeft: spacing.sm }}>{t("all_clear", lang)}</Text>
      </View>
    );
  }
  return (
    <View testID="reminders-card" style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.warning }]}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <Icon name="bell-ring-outline" size={18} color={colors.warning} />
        <Text style={{ color: colors.onSurface, fontWeight: "700", marginLeft: spacing.sm, fontSize: font.lg }}>{t("due_soon", lang)}</Text>
      </View>
      {reminders.map((r) => (
        <ReminderRow key={r.id} r={r} />
      ))}
    </View>
  );
}

function ReminderRow({ r }: { r: Reminder }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const when = r.overdue ? t("overdue", lang) : r.hours_until_due <= 12 ? t("due_today", lang) : t("due_tomorrow", lang);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["commitments"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View testID={`reminder-${r.id}`} style={[styles.row, { borderTopColor: colors.divider }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.onSurface, fontWeight: "600" }}>{r.name}</Text>
        <Text style={{ color: r.overdue ? colors.error : colors.warning, fontSize: font.sm, fontWeight: "600", marginTop: 2 }}>
          {when} · {fmtINR(r.amount)}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.brandPrimary} />
      ) : (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable testID={`snooze-${r.id}`} onPress={() => act(() => api.snoozeCommitment(r.id))} style={[styles.btn, { borderColor: colors.border }]}>
            <Icon name="alarm-snooze" size={16} color={colors.muted} />
            <Text style={{ color: colors.onSurfaceTertiary, fontSize: font.sm, fontWeight: "600", marginLeft: 4 }}>{t("snooze", lang)}</Text>
          </Pressable>
          <Pressable testID={`pay-${r.id}`} onPress={() => act(() => api.payCommitment(r.id))} style={[styles.btn, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
            <Icon name="check" size={16} color={colors.onBrandPrimary} />
            <Text style={{ color: colors.onBrandPrimary, fontSize: font.sm, fontWeight: "700", marginLeft: 4 }}>{t("mark_paid", lang)}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: 1, flexWrap: "wrap", gap: spacing.sm },
  btn: { flexDirection: "row", alignItems: "center", height: 36, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1 },
});
