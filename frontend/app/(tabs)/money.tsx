import { View, Text, StyleSheet, Pressable, FlatList, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
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
  "Bank Fee": "bank-minus",
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
  const { data = [], isLoading } = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => api.transactions(filter),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Sticky header */}
      <View style={{ backgroundColor: colors.surface, paddingTop: insets.top + spacing.sm }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.onSurface }]}>{t("transactions", lang)}</Text>
          <Text style={{ color: colors.muted, fontSize: font.sm }}>{data.length} records</Text>
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
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={() => (
          <View style={{ padding: spacing.xxl, alignItems: "center" }}>
            <Text style={{ color: colors.muted }}>{t("no_transactions", lang)}</Text>
          </View>
        )}
        renderItem={({ item }) => <TxRow tx={item} />}
      />
    </View>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const { colors } = useTheme();
  const iconName = CATEGORY_ICONS[tx.category] || "circle-outline";
  const isIn = tx.type === "received" || tx.type === "refund";
  const amountColor = isIn ? colors.success : colors.onSurface;
  return (
    <View style={[styles.row, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.brandTertiary }]}>
        <Icon name={iconName as any} size={20} color={colors.brandPrimary} />
      </View>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={{ color: colors.onSurface, fontWeight: "600", fontSize: font.lg }} numberOfLines={1}>
          {tx.description || "(no description)"}
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
        {tx.status !== "cleared" ? (
          <Text style={{ color: colors.warning, fontSize: 11, fontWeight: "600", marginTop: 2 }}>
            {tx.status.toUpperCase()}
          </Text>
        ) : null}
      </View>
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
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 64,
  },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
