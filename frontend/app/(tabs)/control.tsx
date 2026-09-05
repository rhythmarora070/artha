import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR, Finding, Resolution } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";
import { FindingSheet, SEV_TONE } from "@/src/components/finding-sheet";

export default function Control() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const { open, ts } = useLocalSearchParams<{ open?: string; ts?: string }>();
  const [selected, setSelected] = useState<string | null>(null);
  const [consumedLink, setConsumedLink] = useState<string | null>(null);
  const { data, error, refetch, isRefetching } = useQuery({ queryKey: ["control", lang], queryFn: () => api.control(lang) });
  const { data: history = [] } = useQuery({ queryKey: ["control-history", lang], queryFn: () => api.history(lang) });

  // Deep link from Home: /control?open=<findingId>&ts=<nonce> — opened once per link
  const linkKey = open ? `${open}-${ts ?? ""}` : null;
  const activeFinding = selected ?? (linkKey && linkKey !== consumedLink ? String(open) : null);
  const closeSheet = () => {
    setSelected(null);
    if (linkKey) setConsumedLink(linkKey);
  };

  const cov = data?.coverage;
  const findings = data?.findings ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
          <Text style={[styles.title, { color: colors.onSurface }]}>
            {lang === "hi" ? "वित्तीय कंट्रोल" : "Financial Control"}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 2 }}>{t("control_subtitle", lang)}</Text>
        </View>

        {/* Score card — all four numbers come from the same record-level classification */}
        <View style={[styles.scoreCard, { backgroundColor: colors.brandPrimary }]}>
          <Text style={{ color: "#FFFFFFAA", fontSize: font.sm, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase" }}>
            {t("coverage", lang)}
          </Text>
          <Text testID="control-coverage-pct" style={{ color: "#FFFFFF", fontSize: 56, fontWeight: "800", marginTop: 4 }}>
            {cov?.coverage_pct ?? 0}%
          </Text>
          <View style={{ flexDirection: "row", marginTop: spacing.md, gap: spacing.xl }}>
            <View>
              <Text style={styles.scoreSubLbl}>{t("records_analyzed", lang)}</Text>
              <Text testID="control-records" style={styles.scoreSubVal}>{cov?.records_analyzed ?? 0}</Text>
            </View>
            <View>
              <Text style={styles.scoreSubLbl}>{t("explained", lang)}</Text>
              <Text testID="control-explained" style={styles.scoreSubVal}>{cov?.explained ?? 0}</Text>
            </View>
            <View>
              <Text style={styles.scoreSubLbl}>{t("affected_records", lang)}</Text>
              <Text testID="control-exceptions" style={styles.scoreSubVal}>{cov?.affected_records ?? 0}</Text>
            </View>
          </View>
          <Text testID="control-findings-line" style={{ color: "#FFFFFF99", fontSize: font.sm, marginTop: spacing.md }}>
            {cov
              ? `${cov.explained} + ${cov.affected_records} = ${cov.records_analyzed} ${t("records", lang)} · ${cov.exception_findings} ${t("findings_count", lang)}`
              : ""}
          </Text>
        </View>

        {/* Severity strip (counts findings by severity) */}
        <View style={styles.sevRow}>
          <SevPill count={cov?.high ?? 0} tone="error" label={t("high", lang)} />
          <SevPill count={cov?.medium ?? 0} tone="warning" label={t("medium", lang)} />
          <SevPill count={cov?.low ?? 0} tone="info" label={t("low", lang)} />
        </View>

        <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{t("blind_spots", lang)}</Text>
        {error ? (
          <View style={{ padding: spacing.xxl, alignItems: "center" }}>
            <Icon name="cloud-off-outline" size={40} color={colors.muted} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>{t("offline_title", lang)}</Text>
            <Pressable onPress={() => refetch()} style={{ marginTop: spacing.md }}>
              <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>{t("retry", lang)}</Text>
            </Pressable>
          </View>
        ) : findings.length === 0 && data ? (
          <View style={{ padding: spacing.xxl, alignItems: "center" }}>
            <Icon name="shield-check" size={40} color={colors.success} />
            <Text style={{ color: colors.muted, marginTop: spacing.sm }}>{t("no_blind_spots", lang)}</Text>
          </View>
        ) : (
          findings.map((f) => <FindingCard key={f.id} f={f} onPress={() => setSelected(f.id)} />)
        )}

        {/* Exception history — what ARTHA caught and how it was fixed */}
        <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{t("resolved_history", lang)}</Text>
        {history.length === 0 ? (
          <Text testID="history-empty" style={{ color: colors.muted, paddingHorizontal: spacing.lg }}>{t("resolved_empty", lang)}</Text>
        ) : (
          history.map((h) => <HistoryRow key={h.id} h={h} />)
        )}
      </ScrollView>

      <FindingSheet findingId={activeFinding} onClose={closeSheet} />
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

function FindingCard({ f, onPress }: { f: Finding; onPress: () => void }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const tone = SEV_TONE[f.severity];
  return (
    <Pressable testID={`finding-${f.kind}`} onPress={onPress} style={[styles.spot, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <View style={[styles.spotDot, { backgroundColor: colors[tone] }]} />
        <Text style={{ color: colors[tone], fontWeight: "800", fontSize: 11, letterSpacing: 1 }}>{t(f.severity, lang)}</Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginLeft: spacing.sm }}>
          {t("confidence", lang)}: {t(`conf_${f.confidence}`, lang)}
        </Text>
        <View style={{ flex: 1 }} />
        <Icon name="chevron-right" size={18} color={colors.muted} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={{ color: colors.onSurface, fontWeight: "700", fontSize: font.lg, flex: 1, marginRight: spacing.md }}>{f.title}</Text>
        <Text style={{ color: colors.onSurface, fontWeight: "800", fontSize: font.lg }}>{fmtINR(f.amount)}</Text>
      </View>
      <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }}>
        {f.related.length} {t("related_records", lang)} · {fmtINR(f.amount)} {t("affected", lang)}
      </Text>
      <Text style={{ color: colors.onSurfaceTertiary, fontSize: font.base, marginTop: spacing.sm }}>{f.why_flagged}</Text>
    </Pressable>
  );
}

function HistoryRow({ h }: { h: Resolution }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const when = new Date(h.resolved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <View testID={`history-${h.kind}`} style={[styles.spot, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, paddingVertical: spacing.md }]}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Icon name="check-circle-outline" size={18} color={colors.success} />
        <Text style={{ color: colors.onSurface, fontWeight: "700", marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>{h.title}</Text>
        <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{fmtINR(h.amount)}</Text>
      </View>
      <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 4, marginLeft: 26 }}>
        {t(`fix_${h.fix}`, lang)}{h.fix_detail ? ` "${h.fix_detail}"` : ""} · {h.account_name} · {when}
      </Text>
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
