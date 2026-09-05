import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { LogBox, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, useCallback } from "react";
import * as SplashScreen from "expo-splash-screen";
import { Image } from "expo-image";
import { Asset } from "expo-asset";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { LangContext, Lang } from "@/src/i18n";
import { storage } from "@/src/utils/storage";

LogBox.ignoreAllLogs(true);

// Icon asset prewarming (preserve as instructed)
try {
  SplashScreen.preventAutoHideAsync?.();
} catch {}

async function prewarmIcons() {
  try {
    if (Platform.OS === "android") {
      const iconModule = require("../assets/images/icon.png");
      const adaptiveModule = require("../assets/images/adaptive-icon.png");
      await Asset.fromModule(iconModule).downloadAsync();
      await Asset.fromModule(adaptiveModule).downloadAsync();
      await Image.prefetch([
        Asset.fromModule(iconModule).uri,
        Asset.fromModule(adaptiveModule).uri,
      ]);
    }
  } catch {}
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>("artha_lang", "en");
      if (saved === "en" || saved === "hi") setLangState(saved);
      await prewarmIcons();
      setReady(true);
      try {
        await SplashScreen.hideAsync();
      } catch {}
    })();
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    storage.setItem("artha_lang", l);
  }, []);

  if (!ready) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <LangContext.Provider value={{ lang, setLang }}>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="quick-record"
                  options={{
                    presentation: "modal",
                    animation: "slide_from_bottom",
                  }}
                />
              </Stack>
            </LangContext.Provider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
