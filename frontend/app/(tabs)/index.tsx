import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { router } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";
import { useState } from "react";

const HERO_BG =
  "https://images.unsplash.com/photo-1711107754300-67d5d87c75e7?crop=entropy&cs=srgb&fm=jpg&w=1200&q=80";

export default function Home() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang, setLang } = useLang();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const seedAndRefresh = async () => {
    try {
      await api.seed();
      qc.invalidateQueries();
    } catch (e: any) {
      Alert.alert("Seed failed", e.message);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        testID="home-scroll"
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.brand, { color: colors.onSurface }]}>ARTHA</Text>
            <Text style={[styles.tag, { color: colors.muted }]}>{t("app_tag", lang)}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable
              testID="lang-toggle"
              onPress={() => setLang(lang === "en" ? "hi" : "en")}
              style={[styles.pill, { backgroundColor: colors.surfaceTertiary }]}
            >
              <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "600", fontSize: font.sm }}>
                {t("language_toggle", lang)}
              </Text>
            </Pressable>
            <Pressable
              testID="reset-demo-btn"
              onPress={seedAndRefresh}
              style={[styles.pill, { backgroundColor: colors.brandTertiary }]}
            >
              <Icon name="refresh" size={16} color={colors.brandPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Hero card */}
        <View style={[styles.hero, { backgroundColor: colors.surfaceInverse }]}>
          <Image source={HERO_BG} style={StyleSheet.absoluteFillObject as any} contentFit="cover" />
          <LinearGradient
            colors={["rgba(26,29,27,0.35)", "rgba(26,29,27,0.85)"]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.heroInner}>
            <Text style={styles.heroLabel}>{t("current_balance", lang)}</Text>
            <Text testID="current-balance" style={styles.heroValue}>
              {fmtINR(data?.balances.current_balance ?? 0)}
            </Text>
            <View style={styles.heroRow}>
              <View>
                <Text style={styles.heroSubLabel}>{t("expected_balance", lang)}</Text>
                <Text testID="expected-balance" style={styles.heroSubValue}>
                  {fmtINR(data?.balances.expected_balance ?? 0)}
                </Text>
              </View>
              <View style={styles.divider} />
              <View>
                <Text style={styles.heroSubLabel}>{t("coverage", lang)}</Text>
                <Text testID="coverage-pct" style={styles.heroSubValue}>
                  {data?.coverage.coverage_pct ?? 0}%
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Metric grid */}
        <View style={styles.grid}>
          <MetricCard
            testID="metric-money-in"
            icon="arrow-down-thin-circle-outline"
            label={t("money_in", lang)}
            value={fmtINR(data?.balances.money_in ?? 0, { compact: true })}
            tone="success"
          />
          <MetricCard
            testID="metric-money-out"
            icon="arrow-up-thin-circle-outline"
            label={t("money_out", lang)}
            value={fmtINR(data?.balances.money_out ?? 0, { compact: true })}
            tone="error"
          />
          <MetricCard
            testID="metric-blind-spot"
            icon="alert-circle-outline"
            label={t("potential_blind_spot", lang)}
            value={data?.top_blind_spot ? fmtINR(data.top_blind_spot.amount) : "—"}
            tone="warning"
          />
          <MetricCard
            testID="metric-upcoming"
            icon="calendar-clock"
            label={t("upcoming", lang)}
            value={fmtINR(data?.upcoming_week_total ?? 0)}
            tone="info"
          />
        </View>

        {/* Insights */}
        {data?.insights?.length ? (
          <View style={[styles.insightCard, { backgroundColor: colors.brandTertiary }]}>
            <Icon name="lightbulb-on-outline" size={18} color={colors.brandPrimary} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              {data.insights.map((i, idx) => (
                <Text key={idx} style={{ color: colors.onBrandTertiary, fontSize: font.base, marginBottom: 4 }}>
                  {i}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {/* Upcoming preview */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{t("upcoming", lang)}</Text>
          <Pressable testID="see-all-upcoming" onPress={() => router.push("/upcoming" as any)}>
            <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>See all</Text>
          </Pressable>
        </View>
        {(data?.upcoming_preview ?? []).map((c) => (
          <View
            key={c.id}
            style={[styles.upcomingRow, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "600", color: colors.onSurface, fontSize: font.lg }}>{c.name}</Text>
              <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }}>
                {t("due", lang)} {new Date(c.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                {" · "}
                {c.frequency}
              </Text>
            </View>
            <Text style={{ fontWeight: "700", color: colors.onSurface, fontSize: font.lg }}>{fmtINR(c.amount)}</Text>
          </View>
        ))}

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>

      {/* CTAs */}
      <View style={[styles.ctaRow, { bottom: insets.bottom + spacing.lg }]}>
        <Pressable
          testID="ask-artha-cta"
          style={[styles.ctaSecondary, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          onPress={() => router.push("/ask" as any)}
        >
          <Icon name="microphone-outline" size={22} color={colors.brandPrimary} />
          <Text style={{ color: colors.onSurface, marginLeft: 6, fontWeight: "600" }}>{t("ask_artha", lang)}</Text>
        </Pressable>
        <Pressable
          testID="record-money-fab"
          style={[styles.ctaPrimary, { backgroundColor: colors.brandPrimary }]}
          onPress={() => router.push("/quick-record" as any)}
        >
          <Icon name="plus" size={24} color={colors.onBrandPrimary} />
          <Text style={{ color: colors.onBrandPrimary, marginLeft: 6, fontWeight: "700" }}>{t("record_money", lang)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
  testID,
}: {
  icon: string;
  label: string;
  value: string;
  tone: "success" | "error" | "warning" | "info";
  testID?: string;
}) {
  const { colors } = useTheme();
  const toneColor = colors[tone];
  return (
    <View testID={testID} style={[styles.metric, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: colors.brandTertiary }]}>
        <Icon name={icon as any} size={18} color={toneColor} />
      </View>
      <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: spacing.sm }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: font.xl, fontWeight: "700", marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brand: { fontSize: 28, fontWeight: "800", letterSpacing: 1 },
  tag: { fontSize: 13, marginTop: 2 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 40,
  },
  hero: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    overflow: "hidden",
    height: 200,
    marginTop: spacing.sm,
  },
  heroInner: { flex: 1, padding: spacing.xl, justifyContent: "space-between" },
  heroLabel: { color: "#FFFFFFCC", fontSize: font.base, fontWeight: "500" },
  heroValue: { color: "#FFFFFF", fontSize: 38, fontWeight: "800", marginTop: 4 },
  heroRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  heroSubLabel: { color: "#FFFFFFAA", fontSize: font.sm },
  heroSubValue: { color: "#FFFFFF", fontSize: font.lg, fontWeight: "700", marginTop: 2 },
  divider: { width: 1, height: 32, backgroundColor: "#FFFFFF33", marginHorizontal: spacing.lg },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  metric: {
    width: "47%",
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
  },
  metricIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  insightCard: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: font.xl, fontWeight: "700" },
  upcomingRow: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  ctaRow: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
  },
  ctaSecondary: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPrimary: {
    flex: 1.4,
    height: 52,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
});
