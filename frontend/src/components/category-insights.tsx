import { View, Text, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

/** Deterministic "last 30 days vs previous 30 days" spending per category. */
export function CategoryInsights() {
  const { colors } = useTheme();
  const { lang } = useLang();
  const { data } = useQuery({ queryKey: ["insights-categories"], queryFn: api.categoryInsights });
  if (!data) return null;
  const rows = data.rows.slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.current, r.previous)));

  return (
    <View testID="category-insights" style={[styles.card, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          <Text style={{ color: colors.muted, fontSize: font.sm }}>{t("last_30", lang)}</Text>
          <Text style={{ color: colors.onSurface, fontSize: font.xxl, fontWeight: "800" }}>{fmtINR(data.current_total)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.muted, fontSize: font.sm }}>{t("prev_30", lang)}</Text>
          <Text style={{ color: colors.onSurfaceTertiary, fontSize: font.lg, fontWeight: "700" }}>{fmtINR(data.previous_total)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm }}>
        <Legend color={colors.brandPrimary} label={t("last_30", lang)} />
        <Legend color={colors.borderStrong} label={t("prev_30", lang)} />
      </View>

      {rows.map((r) => {
        const up = r.change > 0;
        const changeTxt =
          r.change_pct === null ? t("new_spend", lang) : `${up ? "+" : ""}${r.change_pct}%`;
        return (
          <View key={r.category} testID={`insight-${r.category}`} style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
              <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: font.base }}>{r.category}</Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: font.base }}>{fmtINR(r.current)}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", marginLeft: spacing.sm, minWidth: 56, justifyContent: "flex-end" }}>
                  {r.change !== 0 ? (
                    <Icon name={up ? "arrow-top-right" : "arrow-bottom-right"} size={14} color={up ? colors.error : colors.success} />
                  ) : null}
                  <Text style={{ color: r.change === 0 ? colors.muted : up ? colors.error : colors.success, fontSize: font.sm, fontWeight: "700" }}>
                    {changeTxt}
                  </Text>
                </View>
              </View>
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceTertiary }]}>
              <View style={[styles.bar, { width: `${(r.current / max) * 100}%`, backgroundColor: colors.brandPrimary }]} />
            </View>
            <View style={[styles.track, { backgroundColor: colors.surfaceTertiary, marginTop: 3 }]}>
              <View style={[styles.bar, { width: `${(r.previous / max) * 100}%`, backgroundColor: colors.borderStrong }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, marginRight: 6 }} />
      <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1 },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4 },
});
