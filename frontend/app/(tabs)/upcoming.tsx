import { View, Text, StyleSheet, Pressable, ScrollView, FlatList } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";
import { useState, useMemo } from "react";

import { api, fmtINR, Commitment } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

const SEGMENTS = [
  { key: "upcoming", labelKey: "upcoming" },
  { key: "recurring", labelKey: "recurring" },
  { key: "loan", labelKey: "loans" },
  { key: "owed_by_me", labelKey: "owed_by_me" },
  { key: "owed_to_me", labelKey: "owed_to_me" },
] as const;

export default function Upcoming() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const [seg, setSeg] = useState<string>("upcoming");
  const { data = [] } = useQuery({
    queryKey: ["commitments"],
    queryFn: () => api.commitments(),
  });

  const filtered = useMemo(() => data.filter((c) => c.kind === seg), [data, seg]);
  const total = useMemo(() => filtered.reduce((s, c) => s + c.amount, 0), [filtered]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface }}>
        <Text style={[styles.title, { color: colors.onSurface }]}>{t("upcoming", lang)}</Text>
        <Text style={{ color: colors.muted, marginTop: 2 }}>
          {lang === "hi" ? "आगामी वित्तीय प्रतिबद्धताएँ" : "Your upcoming financial commitments"}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 56 }} contentContainerStyle={styles.segRow}>
        {SEGMENTS.map((s) => {
          const active = s.key === seg;
          return (
            <Pressable
              key={s.key}
              testID={`seg-${s.key}`}
              onPress={() => setSeg(s.key)}
              style={[styles.chip, {
                backgroundColor: active ? colors.brandPrimary : colors.surfaceTertiary,
                borderColor: active ? colors.brandPrimary : colors.border,
              }]}
            >
              <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary, fontWeight: "600" }}>
                {t(s.labelKey, lang)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.totalCard, { backgroundColor: colors.brandTertiary }]}>
        <Text style={{ color: colors.onBrandTertiary, fontSize: font.sm, fontWeight: "600" }}>
          {lang === "hi" ? "कुल" : "Total"}
        </Text>
        <Text style={{ color: colors.brandPrimary, fontSize: 28, fontWeight: "800", marginTop: 2 }}>
          {fmtINR(total)}
        </Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={() => (
          <View style={{ padding: spacing.xxl, alignItems: "center" }}>
            <Icon name="calendar-blank-outline" size={40} color={colors.muted} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>
              {lang === "hi" ? "कोई प्रतिबद्धता नहीं" : "Nothing here"}
            </Text>
          </View>
        )}
        renderItem={({ item }) => <ComRow c={item} />}
      />
    </View>
  );
}

function ComRow({ c }: { c: Commitment }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const days = Math.ceil((new Date(c.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const imminent = days <= 3;
  return (
    <View style={[styles.row, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: imminent ? "#FDE9DC" : colors.brandTertiary }]}>
        <Icon name={imminent ? "alert-circle-outline" : "calendar-outline"} size={20} color={imminent ? colors.warning : colors.brandPrimary} />
      </View>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: font.lg }}>{c.name}</Text>
        <Text style={{ color: imminent ? colors.warning : colors.muted, fontSize: font.sm, marginTop: 2, fontWeight: imminent ? "600" : "400" }}>
          {t("due", lang)} {new Date(c.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          {" · "}
          {c.frequency}
          {imminent ? ` · ${days <= 0 ? "today" : `${days}d`}` : ""}
        </Text>
      </View>
      <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: font.lg }}>{fmtINR(c.amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "800" },
  segRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.sm },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  totalCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 64,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
