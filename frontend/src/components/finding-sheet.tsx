import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, ActivityIndicator, TextInput } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR, Finding, RelatedRecord } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

export const SEV_TONE: Record<string, "error" | "warning" | "info"> = { high: "error", medium: "warning", low: "info" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function FindingSheet({ findingId, onClose }: { findingId: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const qc = useQueryClient();
  const open = !!findingId;

  const { data: f, error, isLoading, refetch } = useQuery({
    queryKey: ["finding", findingId, lang],
    queryFn: () => api.finding(findingId!, lang),
    enabled: open,
    retry: false,
  });
  const resolved = !!error && /404/.test((error as Error).message);

  const [aiText, setAiText] = useState<{ text: string; source: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function afterChange() {
    await qc.invalidateQueries({ queryKey: ["control"] });
    await qc.invalidateQueries({ queryKey: ["dashboard"] });
    await qc.invalidateQueries({ queryKey: ["transactions"] });
    await qc.invalidateQueries({ queryKey: ["control-history"] });
    await refetch();
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await afterChange();
    } catch {
      // keep sheet open; the finding query will show the latest state
    } finally {
      setBusy(false);
    }
  }

  async function explain() {
    if (!f) return;
    setAiLoading(true);
    try {
      const r = await api.explainFinding(f.id, lang);
      setAiText({ text: r.explanation, source: r.source });
    } catch {
      setAiText({ text: `${f.what_happened} ${f.why_flagged} ${f.action}`, source: "deterministic" });
    } finally {
      setAiLoading(false);
    }
  }

  function close() {
    setAiText(null);
    onClose();
  }

  const tone = f ? colors[SEV_TONE[f.severity]] : colors.muted;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
      <Pressable testID="finding-sheet-backdrop" style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.xxl }} />
          ) : resolved ? (
            <View style={{ alignItems: "center", paddingVertical: spacing.xxl }}>
              <Icon name="check-decagram" size={44} color={colors.success} />
              <Text testID="finding-resolved" style={{ color: colors.onSurface, fontWeight: "700", marginTop: spacing.md, textAlign: "center" }}>
                {t("resolved", lang)}
              </Text>
            </View>
          ) : f ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={[styles.sevPill, { backgroundColor: tone }]}>
                  <Text style={{ color: colors.onError, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>{t(f.severity, lang)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: font.sm }}>
                  {t("confidence", lang)}: {t(`conf_${f.confidence}`, lang)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: spacing.sm }}>
                <Text testID="finding-title" style={{ color: colors.onSurface, fontSize: font.xxl, fontWeight: "800", flex: 1, marginRight: spacing.md }}>
                  {f.title}
                </Text>
                <Text style={{ color: colors.onSurface, fontSize: font.xxl, fontWeight: "800" }}>{fmtINR(f.amount)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }}>
                {f.account_name} · {f.related.length} {t("related_records", lang)}
              </Text>

              <Section label={t("what_happened", lang)} body={f.what_happened} />
              <Section label={t("why_flagged", lang)} body={f.why_flagged} />

              <SectionLabel label={t("related_transactions", lang)} />
              {f.related.map((r) => (
                <RelatedRow key={r.id} r={r} f={f} busy={busy} run={run} />
              ))}

              <Section label={t("financial_impact", lang)} body={f.impact} />
              <Section label={t("recommended_action", lang)} body={f.action} />

              {f.kind === "possible_duplicate" ? (
                <ActionButton
                  testID="action-keep-both"
                  icon="check-all"
                  label={t("keep_both", lang)}
                  disabled={busy}
                  onPress={() => run(() => Promise.all(f.related.map((r) => api.patchTransaction(r.id, { review: "not_duplicate" } as any))))}
                />
              ) : null}
              {f.kind === "unexpected_fee" || f.kind === "missing_description" ? (
                <ActionButton
                  testID="action-mark-reviewed"
                  icon="check"
                  label={t("mark_reviewed", lang)}
                  disabled={busy}
                  onPress={() => run(() => api.patchTransaction(f.related[0].id, { review: "accepted" } as any))}
                />
              ) : null}

              <SectionLabel label={t("ai_explanation", lang)} />
              {aiText ? (
                <View style={[styles.aiBox, { backgroundColor: colors.brandTertiary }]}>
                  <Text testID="ai-explanation-text" style={{ color: colors.onBrandTertiary, fontSize: font.base, lineHeight: 21 }}>{aiText.text}</Text>
                  <Text style={{ color: colors.brandSecondary, fontSize: 11, marginTop: spacing.sm }}>
                    {aiText.source === "claude" ? "Claude · ARTHA AI" : t("deterministic_note", lang)}
                  </Text>
                </View>
              ) : (
                <ActionButton testID="action-explain-ai" icon="creation" label={aiLoading ? t("thinking", lang) : t("explain_with_ai", lang)} disabled={aiLoading} onPress={explain} />
              )}
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.md }}>{t("heuristic_note", lang)}</Text>
            </>
          ) : null}
          <Pressable testID="finding-close" onPress={close} style={[styles.closeBtn, { borderColor: colors.border }]}>
            <Text style={{ color: colors.onSurface, fontWeight: "700" }}>{t("close", lang)}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionLabel({ label }: { label: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.sectionLabel, { color: colors.muted }]}>{label}</Text>;
}

function Section({ label, body }: { label: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View>
      <SectionLabel label={label} />
      <Text style={{ color: colors.onSurface, fontSize: font.base, lineHeight: 21 }}>{body}</Text>
    </View>
  );
}

function ActionButton({ icon, label, onPress, disabled, testID }: { icon: string; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={[styles.action, { backgroundColor: disabled ? colors.surfaceTertiary : colors.brandPrimary }]}>
      <Icon name={icon as any} size={18} color={disabled ? colors.muted : colors.onBrandPrimary} />
      <Text style={{ color: disabled ? colors.muted : colors.onBrandPrimary, fontWeight: "700", marginLeft: spacing.sm }}>{label}</Text>
    </Pressable>
  );
}

/** One related record with its one-tap fix (categorise / describe / remove copy). */
function RelatedRow({ r, f, busy, run }: { r: RelatedRecord; f: Finding; busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const [suggestion, setSuggestion] = useState<{ category: string; rationale: string; source: string } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [desc, setDesc] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const needsCategory = r.category === "Uncategorized";
  const needsDesc = !r.description && f.kind !== "possible_duplicate";
  const isIn = r.type === "received" || r.type === "refund";

  async function suggest() {
    setSuggesting(true);
    try {
      setSuggestion(await api.suggestCategory(r.id, lang));
    } catch {
      setSuggestion(null);
    } finally {
      setSuggesting(false);
    }
  }

  function accept() {
    const patch: any = {};
    if (suggestion) patch.category = suggestion.category;
    if (desc.trim()) patch.description = desc.trim();
    if (!Object.keys(patch).length) return;
    run(() => api.patchTransaction(r.id, patch));
  }

  return (
    <View style={[styles.related, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.onSurface, fontWeight: "600" }} numberOfLines={1}>
            {r.description || t("no_description", lang)}
          </Text>
          <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }}>
            {fmtDate(r.date)} · {r.source} · {r.category}
            {r.reference ? ` · ${r.reference}` : ""}
          </Text>
        </View>
        <Text style={{ color: isIn ? colors.success : colors.onSurface, fontWeight: "700" }}>
          {isIn ? "+" : "−"}
          {fmtINR(r.amount)}
        </Text>
      </View>

      {needsCategory || needsDesc ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {needsDesc ? (
            <TextInput
              testID={`related-desc-${r.id}`}
              value={desc}
              onChangeText={setDesc}
              placeholder={t("what_was_this_for", lang)}
              placeholderTextColor={colors.muted}
              style={[styles.input, { color: colors.onSurface, backgroundColor: colors.surfaceTertiary, borderColor: colors.border }]}
            />
          ) : null}
          {needsCategory ? (
            suggestion ? (
              <View style={[styles.suggestion, { backgroundColor: colors.brandTertiary }]}>
                <Icon name="creation" size={16} color={colors.brandPrimary} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text testID={`suggested-category-${r.id}`} style={{ color: colors.onBrandTertiary, fontWeight: "700" }}>{suggestion.category}</Text>
                  <Text style={{ color: colors.onBrandTertiary, fontSize: font.sm }} numberOfLines={2}>{suggestion.rationale}</Text>
                </View>
              </View>
            ) : (
              <Pressable testID={`suggest-cat-${r.id}`} onPress={suggest} disabled={suggesting} style={[styles.smallBtn, { borderColor: colors.brandPrimary }]}>
                {suggesting ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Icon name="creation" size={16} color={colors.brandPrimary} />}
                <Text style={{ color: colors.brandPrimary, fontWeight: "700", marginLeft: 6 }}>{t("suggest_category", lang)}</Text>
              </Pressable>
            )
          ) : null}
          {(suggestion || desc.trim()) && !busy ? (
            <Pressable testID={`accept-fix-${r.id}`} onPress={accept} style={[styles.smallBtn, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
              <Icon name="check" size={16} color={colors.onBrandPrimary} />
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "700", marginLeft: 6 }}>{t("accept", lang)}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {f.kind === "possible_duplicate" ? (
        <Pressable
          testID={`remove-copy-${r.id}`}
          disabled={busy}
          onPress={() => (confirmDelete ? run(() => api.deleteTransaction(r.id)) : setConfirmDelete(true))}
          style={[styles.smallBtn, { marginTop: spacing.md, borderColor: colors.error, backgroundColor: confirmDelete ? colors.error : "transparent" }]}
        >
          <Icon name="delete-outline" size={16} color={confirmDelete ? colors.onError : colors.error} />
          <Text style={{ color: confirmDelete ? colors.onError : colors.error, fontWeight: "700", marginLeft: 6 }}>
            {confirmDelete ? `${t("confirm_delete", lang)} ${t("remove", lang)}` : t("remove_copy", lang)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(18,20,19,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: spacing.sm },
  sevPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.xl, marginBottom: spacing.sm },
  related: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: font.base },
  suggestion: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md },
  smallBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 40, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 48, borderRadius: radius.pill, marginTop: spacing.md },
  aiBox: { padding: spacing.md, borderRadius: radius.md },
  closeBtn: { marginTop: spacing.xl, height: 48, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
