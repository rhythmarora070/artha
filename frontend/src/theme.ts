// ARTHA design tokens - Moss green premium fintech palette
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#F7F8F7",
  onSurface: "#121413",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#121413",
  surfaceTertiary: "#EFF1F0",
  onSurfaceTertiary: "#454946",
  surfaceInverse: "#1A1D1B",
  onSurfaceInverse: "#FFFFFF",
  muted: "#6E7571",

  brand: "#2A4B3A",
  onBrand: "#FFFFFF",
  brandPrimary: "#2A4B3A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#5A7C6B",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E4EBE6",
  onBrandTertiary: "#2A4B3A",

  success: "#3E7B5B",
  onSuccess: "#FFFFFF",
  warning: "#C2935B",
  onWarning: "#FFFFFF",
  error: "#B25048",
  onError: "#FFFFFF",
  info: "#4A6C5B",
  onInfo: "#FFFFFF",

  border: "#E5E7E5",
  borderStrong: "#C8CDC9",
  divider: "#E5E7E5",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const font = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  display: 32,
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const colors = light;
