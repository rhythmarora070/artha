import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR, BlindSpot } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

const SEV_TONE: Record<string, "error" | "warning" | "info"> = {
  high: "error",
  medium: "warning",
  low: "info",
};

export default function Control() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const { data } = useQuery({ queryKey: ["control"], queryFn: api.control });

  const cov = data?.coverage;
  const spots = data?.blind_spots ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxxl }}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
          <Text style={[styles.title, { color: colors.onSurface }]}>
            {lang === "hi" ? "वित्तीय कंट्रोल" : "Financial Control"}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>
            {lang === "hi" ? "आपकी वित्तीय स्थिति का स्वास्थ्य" : "How well ARTHA can explain your money"}
          </Text>
        </View>

        {/* Score card */}
        <View style={[styles.scoreCard, { backgroundColor: colors.brandPrimary }]}>
          <Text style={{ color: "#FFFFFFAA", fontSize: font.sm, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>
            {t("coverage", lang)}
          </Text>
          <Text style={{ color: "#FFFFFF", fontSize: 56, fontWeight: "800", marginTop: 4 }}>
            {cov?.coverage_pct ?? 0}%
          </Text>
          <View style={{ flexDirection: "row", marginTop: spacing.md, gap: spacing.xl }}>
            <View>
              <Text style={styles.scoreSubLbl}>{t("records_analyzed", lang)}</Text>
              <Text style={styles.scoreSubVal}>{cov?.records_analyzed ?? 0}</Text>
            </View>
            <View>
              <Text style={styles.scoreSubLbl}>{lang === "hi" ? "समझाया गया" : "Explained"}</Text>
              <Text style={styles.scoreSubVal}>{cov?.explained ?? 0}</Text>
            </View>
            <View>
              <Text style={styles.scoreSubLbl}>{t("exceptions", lang)}</Text>
              <Text style={styles.scoreSubVal}>{cov?.exceptions ?? 0}</Text>
            </View>
          </View>
        </View>

        {/* Severity strip */}
        <View style={styles.sevRow}>
          <SevPill count={cov?.high ?? 0} tone="error" label={t("high", lang)} />
          <SevPill count={cov?.medium ?? 0} tone="warning" label={t("medium", lang)} />
          <SevPill count={cov?.low ?? 0} tone="info" label={t("low", lang)} />
        </View>

        {/* Blind spots */}
        <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{t("blind_spots", lang)}</Text>
        {spots.length === 0 ? (
          <View style={{ padding: spacing.xxl, alignItems: "center" }}>
            <Icon name="shield-check" size={40} color={colors.success} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>
              {lang === "hi" ? "कोई ब्लाइंड स्पॉट नहीं" : "No blind spots detected"}
            </Text>
          </View>
        ) : (
          spots.map((s) => <SpotCard key={s.id} s={s} />)
        )}
      </ScrollView>
    </View>
  );
}

function SevPill({ count, tone, label }: { count: number; tone: "error" | "warning" | "info"; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sevPill, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <View style={[styles.sevDot, { backgroundColor: colors[tone] }]} />
      <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: font.xl }}>{count}</Text>
      <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function SpotCard({ s }: { s: BlindSpot }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const tone = SEV_TONE[s.severity];
  return (
    <View style={[styles.spot, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <View style={[styles.spotDot, { backgroundColor: colors[tone] }]} />
        <Text style={{ color: colors[tone], fontWeight: "800", fontSize: 11, letterSpacing: 1 }}>
          {t(s.severity, lang)}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginLeft: spacing.sm }}>
          {Math.round(s.confidence * 100)}% {lang === "hi" ? "आत्मविश्वास" : "confidence"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: font.lg, flex: 1, marginRight: spacing.md }}>
          {s.title}
        </Text>
        <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: font.lg }}>{fmtINR(s.amount)}</Text>
      </View>
      <Text style={{ color: colors.muted, fontSize: font.base, marginTop: 4 }}>{s.reason}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "800" },
  scoreCard: {
    marginHorizontal: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
  },
  scoreSubLbl: { color: "#FFFFFF99", fontSize: 11, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" },
  scoreSubVal: { color: "#FFFFFF", fontSize: font.xl, fontWeight: "700", marginTop: 2 },
  sevRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  sevPill: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
  },
  sevDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 6 },
  sectionTitle: {
    fontSize: font.xl,
    fontWeight: "700",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  spot: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  spotDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
});
