import { View, Text, StyleSheet, Pressable, FlatList, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";
import { useState } from "react";

import { api, fmtINR, Transaction } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

const FILTERS = ["All", "Bank", "UPI", "Card", "Cash", "Razorpay"] as const;
type Filter = (typeof FILTERS)[number];

const CATEGORY_ICONS: Record<string, string> = {
  Food: "food",
  Groceries: "cart-outline",
  Dining: "silverware-fork-knife",
  Transport: "car-outline",
  Fuel: "gas-station",
  Cab: "taxi",
  Personal: "account-outline",
  Shopping: "shopping-outline",
  Entertainment: "movie-outline",
  Bills: "receipt",
  Utilities: "lightbulb-outline",
  Subscription: "refresh",
  Salary: "cash-plus",
  Freelance: "briefcase-outline",
  Investment: "chart-line",
  Fees: "bank-minus",
  Travel: "airplane",
  Rent: "home-city-outline",
  Education: "school-outline",
  Transfer: "bank-transfer",
  Income: "cash-plus",
  Uncategorized: "help-circle-outline",
  Housing: "home-outline",
  EMI: "credit-card-clock-outline",
  Health: "heart-outline",
};

export default function Money() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const [filter, setFilter] = useState<Filter>("All");
  const { data = [], error, refetch, isRefetching } = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => api.transactions(filter),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Sticky header */}
      <View style={{ backgroundColor: colors.surface, paddingTop: insets.top + spacing.sm }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.onSurface }]}>{t("transactions", lang)}</Text>
          <Text style={{ color: colors.muted, fontSize: font.sm }}>{data.length} {t("records", lang)}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {FILTERS.map((f) => {
            const active = f === filter;
            return (
              <Pressable
                key={f}
                testID={`filter-${f.toLowerCase()}`}
                onPress={() => setFilter(f)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.brandPrimary : colors.surfaceTertiary,
                    borderColor: active ? colors.brandPrimary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary,
                    fontWeight: "600",
                    fontSize: font.base,
                  }}
                >
                  {f === "All" ? t("filter_all", lang) : f}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={() => (
          <View style={{ padding: spacing.xxl, alignItems: "center" }}>
            <Text style={{ color: colors.muted }}>{error ? t("offline_title", lang) : t("no_transactions", lang)}</Text>
            {error ? (
              <Pressable onPress={() => refetch()} style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>{t("retry", lang)}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => <TxRow tx={item} />}
      />
    </View>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const iconName = CATEGORY_ICONS[tx.category] || "circle-outline";
  const isIn = tx.type === "received" || tx.type === "refund";
  const amountColor = isIn ? colors.success : colors.onSurface;
  const flagged = tx.control_status && tx.control_status !== "explained";
  const flagColor = tx.control_status === "exception" ? colors.error : colors.warning;
  return (
    <View style={[styles.row, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={[styles.rowIcon, { backgroundColor: colors.brandTertiary }]}>
          <Icon name={iconName as any} size={20} color={colors.brandPrimary} />
        </View>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: font.lg }} numberOfLines={1}>
            {tx.description || t("no_description", lang)}
          </Text>
          <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>
            {tx.category} · {tx.source} · {new Date(tx.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: amountColor, fontWeight: "700", fontSize: font.lg }}>
            {isIn ? "+" : "−"}
            {fmtINR(tx.amount)}
          </Text>
          {flagged ? (
            <Text testID={`tx-status-${tx.id}`} style={{ color: flagColor, fontSize: 11, fontWeight: "700", marginTop: 2, letterSpacing: 0.6 }}>
              {tx.control_status === "exception" ? t("exception_badge", lang) : t("review_badge", lang)}
            </Text>
          ) : null}
        </View>
      </View>
      {tx.category === "Uncategorized" ? <SuggestCategory tx={tx} /> : null}
    </View>
  );
}

/** Smart categorisation: ARTHA suggests a category (Claude, rules fallback) → one-tap accept. */
function SuggestCategory({ tx }: { tx: Transaction }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [state, setState] = useState<{ category: string; rationale: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function suggest() {
    setBusy(true);
    try {
      setState(await api.suggestCategory(tx.id, lang));
    } catch {
      setState(null);
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    if (!state) return;
    setBusy(true);
    try {
      await api.patchTransaction(tx.id, { category: state.category });
      qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm, gap: spacing.sm }}>
      {state ? (
        <>
          <Text style={{ color: colors.onSurfaceTertiary, fontSize: font.sm, flex: 1 }} numberOfLines={2}>
            <Text style={{ fontWeight: "700", color: colors.brandPrimary }}>{state.category}</Text> · {state.rationale}
          </Text>
          <Pressable testID={`tx-accept-${tx.id}`} onPress={accept} disabled={busy} style={[styles.miniBtn, { backgroundColor: colors.brandPrimary }]}>
            <Text style={{ color: colors.onBrandPrimary, fontWeight: "700", fontSize: font.sm }}>{t("accept", lang)}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable testID={`tx-suggest-${tx.id}`} onPress={suggest} disabled={busy} style={[styles.miniBtn, { borderColor: colors.brandPrimary, borderWidth: 1 }]}>
          {busy ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Icon name="creation" size={14} color={colors.brandPrimary} />}
          <Text style={{ color: colors.brandPrimary, fontWeight: "700", fontSize: font.sm, marginLeft: 4 }}>{t("suggest_category", lang)}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  title: { fontSize: 28, fontWeight: "800" },
  chipRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm, flexDirection: "row" },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  row: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 64,
  },
  miniBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 32, paddingHorizontal: 12, borderRadius: radius.pill },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
