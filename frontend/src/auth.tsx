import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api, setSessionToken, setUnauthorizedHandler, User } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "artha_session_token";
const AUTH_HOST = "https://auth.emergentagent.com/";

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}
async function writeToken(t: string | null) {
  if (Platform.OS === "web") {
    if (typeof localStorage === "undefined") return;
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    return;
  }
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

type Ctx = {
  loading: boolean;
  user: User | null;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string, name: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (p: Partial<Pick<User, "name" | "onboarded" | "app_lock">>) => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const exchanged = useRef<Set<string>>(new Set());

  const adopt = useCallback(async (res: { session_token: string; user: User }) => {
    setSessionToken(res.session_token);
    await writeToken(res.session_token);
    setUser(res.user);
  }, []);

  const clear = useCallback(async () => {
    setSessionToken(null);
    await writeToken(null);
    setUser(null);
  }, []);

  const exchange = useCallback(
    async (sessionId: string) => {
      if (exchanged.current.has(sessionId)) return false;
      exchanged.current.add(sessionId);
      try {
        await adopt(await api.googleSession(sessionId));
        return true;
      } catch {
        return false;
      }
    },
    [adopt],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clear();
    });
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        // 1. A fresh Google redirect takes priority over any stored session.
        if (Platform.OS === "web") {
          const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
          if (sid && (await exchange(sid))) {
            const url = new URL(window.location.href);
            url.searchParams.delete("session_id");
            url.hash = url.hash.replace(/([?#&])session_id=[^&#]+&?/, "$1").replace(/[?#&]$/, "");
            window.history.replaceState(window.history.state, "", url.toString());
            return;
          }
        } else {
          sub = Linking.addEventListener("url", ({ url }) => {
            const sid = extractSessionId(url);
            if (sid) exchange(sid);
          });
          const sid = extractSessionId(await Linking.getInitialURL());
          if (sid && (await exchange(sid))) return;
        }
        // 2. Existing session
        const token = await readToken();
        if (token) {
          setSessionToken(token);
          try {
            setUser(await api.me());
          } catch {
            await clear();
          }
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => sub?.remove();
  }, [clear, exchange]);

  const value = useMemo<Ctx>(
    () => ({
      loading,
      user,
      signInEmail: async (email, password) => adopt(await api.login(email, password)),
      signUpEmail: async (email, password, name) => adopt(await api.register(email, password, name)),
      signInDemo: async () => adopt(await api.demoLogin()),
      signOut: async () => {
        try {
          await api.logout();
        } catch {}
        await clear();
      },
      updateProfile: async (p) => setUser(await api.patchMe(p)),
      signInGoogle: async () => {
        const redirect = Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
        const authUrl = `${AUTH_HOST}?redirect=${encodeURIComponent(redirect)}`;
        if (Platform.OS === "web") {
          window.location.href = authUrl;
          return;
        }
        const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
        const sid = extractSessionId(result.type === "success" ? result.url : null) || extractSessionId(await Linking.getInitialURL());
        if (sid) await exchange(sid);
      },
    }),
    [loading, user, adopt, clear, exchange],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Ctx {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
