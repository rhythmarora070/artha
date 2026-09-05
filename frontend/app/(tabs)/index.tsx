import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, useWindowDimensions, Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { router } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR, StoryWeek } from "@/src/api";
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
  const [banner, setBanner] = useState<string | null>(null);
  const { data, error, refetch } = useQuery({
    queryKey: ["dashboard", lang],
    queryFn: () => api.dashboard(lang),
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
      setBanner(null);
    } catch {
      setBanner(t("demo_reset_failed", lang));
    }
  };

  const openTopFinding = () => {
    if (data?.top_finding) router.push({ pathname: "/control", params: { open: data.top_finding.id } } as any);
    else router.push("/control" as any);
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

        {error && !data ? (
          <View style={[styles.insightCard, { backgroundColor: colors.surfaceTertiary }]}>
            <Icon name="cloud-off-outline" size={18} color={colors.muted} />
            <Text style={{ color: colors.onSurfaceTertiary, marginLeft: spacing.sm, flex: 1 }}>{t("offline_title", lang)} · {t("offline_hint", lang)}</Text>
            <Pressable onPress={() => refetch()}>
              <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>{t("retry", lang)}</Text>
            </Pressable>
          </View>
        ) : null}
        {banner ? (
          <View style={[styles.insightCard, { backgroundColor: colors.surfaceTertiary }]}>
            <Text style={{ color: colors.error, flex: 1 }}>{banner}</Text>
          </View>
        ) : null}

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
              {fmtINR(data?.balances.recorded_balance ?? 0)}
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

        <Text testID="data-context" style={[styles.context, { color: colors.muted }]}>{t("data_context", lang)}</Text>

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
            value={data?.top_finding ? fmtINR(data.top_finding.amount) : "—"}
            tone="warning"
            hint={data?.top_finding ? t("investigate", lang) : undefined}
            onPress={openTopFinding}
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

        {/* Weekly story — swipeable recap */}
        {data?.story?.length ? <Story weeks={data.story} /> : null}

        {/* Upcoming preview */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{t("upcoming", lang)}</Text>
          <Pressable testID="see-all-upcoming" onPress={() => router.push("/upcoming" as any)}>
            <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>{t("see_all", lang)}</Text>
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
  hint,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  tone: "success" | "error" | "warning" | "info";
  testID?: string;
  hint?: string;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const toneColor = colors[tone];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.metric, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={[styles.metricIcon, { backgroundColor: colors.brandTertiary }]}>
          <Icon name={icon as any} size={18} color={toneColor} />
        </View>
        {hint ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: colors.brandPrimary, fontSize: 11, fontWeight: "700" }}>{hint}</Text>
            <Icon name="chevron-right" size={14} color={colors.brandPrimary} />
          </View>
        ) : null}
      </View>
      <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: spacing.sm }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: font.xl, fontWeight: "700", marginTop: 2 }}>{value}</Text>
    </Pressable>
  );
}

function Story({ weeks }: { weeks: StoryWeek[] }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const { width } = useWindowDimensions();
  const cardW = width - spacing.lg * 2;
  const [page, setPage] = useState(0);
  return (
    <View style={{ marginTop: spacing.xl }}>
      <View style={[styles.sectionHeader, { marginTop: 0 }]}>
        <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{t("weekly_story", lang)}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {weeks.map((_, i) => (
            <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === page ? colors.brandPrimary : colors.border }} />
          ))}
        </View>
      </View>
      <ScrollView
        testID="story-scroll"
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardW + spacing.sm}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardW + spacing.sm)))}
      >
        {weeks.map((w, i) => (
          <View key={i} testID={`story-week-${i}`} style={[styles.storyCard, { width: cardW, backgroundColor: colors.surfaceInverse }]}>
            <Text style={{ color: "#FFFFFFAA", fontSize: font.sm, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>{w.label}</Text>
            <Text style={{ color: "#FFFFFF", fontSize: font.lg, lineHeight: 24, marginTop: spacing.sm }}>{w.narrative}</Text>
            <View style={{ flexDirection: "row", gap: spacing.xl, marginTop: spacing.md }}>
              <View>
                <Text style={{ color: "#FFFFFF99", fontSize: 11 }}>{t("money_out", lang)}</Text>
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{fmtINR(w.money_out)}</Text>
              </View>
              <View>
                <Text style={{ color: "#FFFFFF99", fontSize: 11 }}>{t("money_in", lang)}</Text>
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{fmtINR(w.money_in)}</Text>
              </View>
              <View>
                <Text style={{ color: "#FFFFFF99", fontSize: 11 }}>{t("records", lang)}</Text>
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{w.records}</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
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
  context: { fontSize: 11, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  storyCard: { borderRadius: radius.lg, padding: spacing.lg, minHeight: 150 },
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
    ...Platform.select({
      web: { boxShadow: "0px 8px 16px rgba(0,0,0,0.18)" } as any,
      default: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 6 },
    }),
  },
});
