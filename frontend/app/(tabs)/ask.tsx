import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";
import { useState, useRef } from "react";
import { api } from "@/src/api";
import { useTheme, spacing, radius, font } from "@/src/theme";
import { useLang, t } from "@/src/i18n";

type Msg = { role: "user" | "artha"; text: string };

export default function Ask() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { lang, setLang } = useLang();
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const suggestedKeys = ["suggested_q1", "suggested_q2", "suggested_q3", "suggested_q4", "suggested_q5", "suggested_q6_hi"];

  async function send(q: string) {
    const question = q.trim();
    if (!question) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const res = await api.askOnce(question, lang);
      setMsgs((m) => [...m, { role: "artha", text: res.answer }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "artha", text: `ARTHA needs connection to think. (${e.message})` }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  // Voice: web speech recognition (best-effort)
  const [listening, setListening] = useState(false);
  function toggleMic() {
    if (Platform.OS !== "web") {
      setMsgs((m) => [
        ...m,
        { role: "artha", text: lang === "hi" ? "मोबाइल ऐप पर वॉइस के लिए ब्राउज़र प्रीव्यू का उपयोग करें।" : "Use the browser preview for voice input on this device." },
      ]);
      return;
    }
    const w: any = window;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setMsgs((m) => [...m, { role: "artha", text: "Voice not supported in this browser." }]);
      return;
    }
    const rec = new SR();
    rec.lang = lang === "hi" ? "hi-IN" : "en-IN";
    rec.continuous = false;
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setListening(false);
      send(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={[styles.title, { color: colors.onSurface }]}>{t("ask_artha", lang)}</Text>
            <Text style={{ color: colors.muted, marginTop: 2 }}>
              {lang === "hi" ? "अपने वित्तीय जीवन के बारे में पूछें" : "Ask anything about your money"}
            </Text>
          </View>
          <Pressable
            testID="ask-lang-toggle"
            onPress={() => setLang(lang === "en" ? "hi" : "en")}
            style={[styles.pill, { backgroundColor: colors.brandTertiary }]}
          >
            <Text style={{ color: colors.brandPrimary, fontWeight: "700" }}>{t("language_toggle", lang)}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
      >
        {msgs.length === 0 ? (
          <View>
            <Text style={{ color: colors.muted, fontSize: font.sm, fontWeight: "600", marginBottom: spacing.md, textTransform: "uppercase", letterSpacing: 0.8 }}>
              {t("suggested", lang)}
            </Text>
            {suggestedKeys.map((k) => (
              <Pressable
                key={k}
                testID={`suggested-${k}`}
                onPress={() => send(t(k, lang))}
                style={[styles.suggested, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              >
                <Icon name="chat-question-outline" size={18} color={colors.brandPrimary} />
                <Text style={{ color: colors.onSurface, marginLeft: spacing.md, fontSize: font.lg, flex: 1 }}>
                  {t(k, lang)}
                </Text>
                <Icon name="arrow-right" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {msgs.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.role === "user"
                ? { alignSelf: "flex-end", backgroundColor: colors.brandPrimary }
                : { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            {m.role === "artha" ? (
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                <Icon name="shield-star-outline" size={14} color={colors.brandPrimary} />
                <Text style={{ color: colors.brandPrimary, fontWeight: "700", fontSize: 11, marginLeft: 4, letterSpacing: 0.8 }}>
                  ARTHA
                </Text>
              </View>
            ) : null}
            <Text style={{ color: m.role === "user" ? colors.onBrandPrimary : colors.onSurface, fontSize: font.lg, lineHeight: 22 }}>
              {m.text}
            </Text>
          </View>
        ))}
        {loading ? (
          <View style={[styles.bubble, { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1, flexDirection: "row", alignItems: "center" }]}>
            <ActivityIndicator size="small" color={colors.brandPrimary} />
            <Text style={{ color: colors.muted, marginLeft: spacing.sm }}>{t("thinking", lang)}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.inputBar, { backgroundColor: colors.surfaceSecondary, borderTopColor: colors.divider, paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          testID="ask-input"
          value={input}
          onChangeText={setInput}
          placeholder={t("ask_placeholder", lang)}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.onSurface, backgroundColor: colors.surfaceTertiary }]}
          onSubmitEditing={() => send(input)}
          returnKeyType="send"
        />
        <Pressable
          testID="ask-mic"
          onPress={toggleMic}
          style={[styles.mic, { backgroundColor: listening ? colors.error : colors.brandTertiary }]}
        >
          <Icon name={listening ? "microphone" : "microphone-outline"} size={22} color={listening ? colors.onError : colors.brandPrimary} />
        </Pressable>
        <Pressable
          testID="ask-send"
          onPress={() => send(input)}
          style={[styles.send, { backgroundColor: colors.brandPrimary }]}
        >
          <Icon name="send" size={20} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "800" },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  suggested: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  bubble: {
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    maxWidth: "88%",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    fontSize: font.lg,
  },
  mic: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
});
