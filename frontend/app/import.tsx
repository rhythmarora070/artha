import { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import Icon from "@react-native-vector-icons/material-design-icons";

import { api, fmtINR, ImportPreview, ImportRow } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

async function readPickedFile(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (Platform.OS === "web" && (asset as any).file) return await ((asset as any).file as Blob).text();
  const { File } = await import("expo-file-system");
  return await new File(asset.uri).text();
}

export default function ImportStatement() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang } = useLang();
  const qc = useQueryClient();
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const accountId = pickedAccount ?? accounts[0]?.id ?? null;

  async function pickFile() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await readPickedFile(res.assets[0]);
      setCsv(text);
      setFileName(res.assets[0].name);
      setPreview(null);
      setError(null);
    } catch {
      setError(t("import_failed", lang));
    }
  }

  async function runPreview() {
    if (!accountId || !csv.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.importPreview(accountId, csv));
    } catch (e: any) {
      setPreview(null);
      setError(`${t("import_failed", lang)}${e?.message ? ` — ${String(e.message).replace(/^API \d+: /, "")}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!accountId || !preview) return;
    const rows = preview.rows
      .filter((r) => !r.error && !r.duplicate)
      .map(({ date, description, amount, type, reference, category }) => ({ date, description, amount, type, reference, category }));
    setBusy(true);
    try {
      const r = await api.importCommit(accountId, rows as any);
      setDone(r.imported);
      qc.invalidateQueries();
    } catch {
      setError(`${t("save_failed", lang)} — ${t("offline_hint", lang)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ paddingTop: insets.top + spacing.sm, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Pressable testID="import-close" onPress={() => router.back()} style={{ padding: 8 }}>
          <Icon name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", fontSize: font.lg, fontWeight: "700", color: colors.onSurface }}>{t("import_title", lang)}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        {done !== null ? (
          <View style={{ alignItems: "center", paddingVertical: spacing.xxl }}>
            <Icon name="check-decagram" size={48} color={colors.success} />
            <Text testID="import-done" style={{ color: colors.onSurface, fontSize: font.xl, fontWeight: "800", marginTop: spacing.md }}>{done}</Text>
            <Text style={{ color: colors.muted, textAlign: "center", marginTop: 4 }}>{t("imported_ok", lang)}</Text>
            <Pressable testID="import-finish" onPress={() => router.back()} style={[styles.primary, { backgroundColor: colors.brandPrimary, marginTop: spacing.xl, paddingHorizontal: spacing.xl }]}>
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "800" }}>{t("close", lang)}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={{ color: colors.muted }}>{t("import_subtitle", lang)}</Text>

            <Text style={[styles.label, { color: colors.muted }]}>{t("account_source", lang)}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerStyle={{ gap: spacing.sm }}>
              {accounts.map((a) => {
                const active = a.id === accountId;
                return (
                  <Pressable key={a.id} testID={`import-acc-${a.name}`} onPress={() => { setPickedAccount(a.id); setPreview(null); }}
                    style={[styles.chip, { backgroundColor: active ? colors.brandPrimary : colors.surfaceTertiary, borderColor: active ? colors.brandPrimary : colors.border }]}>
                    <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurfaceTertiary, fontWeight: "600" }}>{a.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.xl, gap: spacing.sm }}>
              <Pressable testID="import-pick-file" onPress={pickFile} style={[styles.outline, { borderColor: colors.brandPrimary }]}>
                <Icon name="file-upload-outline" size={18} color={colors.brandPrimary} />
                <Text style={{ color: colors.brandPrimary, fontWeight: "700", marginLeft: 6 }}>{t("pick_file", lang)}</Text>
              </Pressable>
              {fileName ? <Text style={{ color: colors.muted, fontSize: font.sm, flex: 1 }} numberOfLines={1}>{fileName}</Text> : null}
            </View>

            <TextInput
              testID="import-csv"
              value={csv}
              onChangeText={(v) => { setCsv(v); setPreview(null); }}
              placeholder={`${t("paste_csv", lang)}\nDate,Narration,Withdrawal Amt,Deposit Amt,Ref No`}
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.textarea, { color: colors.onSurface, backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            />

            {error ? <Text testID="import-error" style={{ color: colors.error, marginTop: spacing.sm }}>{error}</Text> : null}

            {preview ? (
              <View style={{ marginTop: spacing.lg }}>
                <Text style={[styles.label, { color: colors.muted, marginTop: 0 }]}>{t("detected_columns", lang)}</Text>
                <Text style={{ color: colors.onSurfaceTertiary, fontSize: font.sm }}>
                  {Object.entries(preview.columns).map(([k, v]) => `${k} → ${v}`).join(" · ")}
                </Text>
                <View testID="import-summary" style={[styles.summary, { backgroundColor: colors.brandTertiary }]}>
                  <Stat n={preview.summary.importable} label={t("importable", lang)} color={colors.brandPrimary} />
                  <Stat n={preview.summary.duplicates} label={t("duplicates", lang)} color={colors.warning} />
                  <Stat n={preview.summary.errors} label={t("errors", lang)} color={colors.error} />
                </View>
                {preview.rows.slice(0, 60).map((r) => <PreviewRow key={r.line} r={r} />)}
                {preview.rows.length > 60 ? <Text style={{ color: colors.muted, textAlign: "center", marginTop: spacing.sm }}>+{preview.rows.length - 60}</Text> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {done === null ? (
        <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.divider, paddingBottom: insets.bottom + spacing.md }]}>
          {preview && preview.summary.importable > 0 ? (
            <Pressable testID="import-commit" onPress={commit} disabled={busy} style={[styles.primary, { backgroundColor: busy ? colors.muted : colors.brandPrimary }]}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="database-import-outline" size={20} color={colors.onBrandPrimary} />}
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.lg, marginLeft: 6 }}>
                {t("import_n", lang)} {preview.summary.importable}
              </Text>
            </Pressable>
          ) : (
            <Pressable testID="import-preview" onPress={runPreview} disabled={busy || !csv.trim()} style={[styles.primary, { backgroundColor: busy || !csv.trim() ? colors.muted : colors.brandPrimary }]}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Icon name="table-search" size={20} color={colors.onBrandPrimary} />}
              <Text style={{ color: colors.onBrandPrimary, fontWeight: "800", fontSize: font.lg, marginLeft: 6 }}>{t("preview", lang)}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ color, fontSize: font.xl, fontWeight: "800" }}>{n}</Text>
      <Text style={{ color: colors.onBrandTertiary, fontSize: 11, textAlign: "center" }}>{label}</Text>
    </View>
  );
}

function PreviewRow({ r }: { r: ImportRow }) {
  const { colors } = useTheme();
  const { lang } = useLang();
  const isIn = r.type === "received" || r.type === "refund";
  const dim = !!r.error || r.duplicate;
  return (
    <View testID={`import-row-${r.line}`} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, opacity: dim ? 0.55 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.onSurface, fontWeight: "600" }} numberOfLines={1}>{r.description || t("no_description", lang)}</Text>
        <Text style={{ color: colors.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>
          {r.date ? new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—"} · {r.category}
          {r.reference ? ` · ${r.reference}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ color: isIn ? colors.success : colors.onSurface, fontWeight: "700" }}>
          {r.amount !== null ? `${isIn ? "+" : "−"}${fmtINR(r.amount)}` : "—"}
        </Text>
        {r.error ? <Text style={{ color: colors.error, fontSize: 10, fontWeight: "700" }}>{r.error}</Text> : null}
        {r.duplicate ? <Text style={{ color: colors.warning, fontSize: 10, fontWeight: "700" }}>{t("duplicate_badge", lang)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: font.sm, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.xl, marginBottom: spacing.sm },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  outline: { flexDirection: "row", alignItems: "center", height: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1 },
  textarea: { marginTop: spacing.md, minHeight: 140, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, fontSize: font.sm, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  summary: { flexDirection: "row", padding: spacing.md, borderRadius: radius.md, marginTop: spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  bar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: spacing.lg, borderTopWidth: 1 },
  primary: { height: 56, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
