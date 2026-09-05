import { Tabs } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";
import { useTheme } from "@/src/theme";
import { useLang, t } from "@/src/i18n";
import { Platform, View } from "react-native";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { lang } = useLang();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.divider,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("home", lang),
          tabBarIcon: ({ color, size }) => <Icon name="home-variant" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="money"
        options={{
          title: t("money", lang),
          tabBarIcon: ({ color, size }) => (
            <Icon name="swap-vertical-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{
          title: t("ask", lang),
          tabBarIcon: ({ color, size }) => (
            <Icon name="message-processing-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="upcoming"
        options={{
          title: t("upcoming", lang),
          tabBarIcon: ({ color, size }) => <Icon name="calendar-clock" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="control"
        options={{
          title: t("control", lang),
          tabBarIcon: ({ color, size }) => <Icon name="shield-check-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
