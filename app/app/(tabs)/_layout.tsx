/**
 * 하단 탭 네비게이션 — 택배함(목록) · 설정. 두 탭만(MVP). register/shipment/onboarding 은
 * 탭이 아니라 루트 Stack 위에 push 되는 화면(app/_layout.tsx).
 * 탭은 헤더를 쓰지 않고(headerShown:false) 각 화면이 자체 헤더/세이프에어리어를 그린다.
 * 색은 토큰만(하드코딩 금지) — 활성=text.primary·비활성=text.secondary, 탭바 배경=bg.surface·구분선=border.
 * 라벨+아이콘을 함께 둔다(색 단독 의존 금지 — UI_GUIDE 접근성).
 */
import { Tabs } from "expo-router";
import { Gear, Package } from "../../src/components/icons";
import { useTheme } from "../../src/theme/ThemeProvider";

export default function TabsLayout() {
  const { tokens } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.text.primary,
        tabBarInactiveTintColor: tokens.text.secondary,
        tabBarStyle: {
          backgroundColor: tokens.bg.surface,
          borderTopColor: tokens.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "택배함",
          // 아이콘 색은 토큰을 직접 주입(ColorValue→string 캐스트 회피). 라벨 색은 active/inactive tint.
          tabBarIcon: ({ focused, size }) => (
            <Package color={focused ? tokens.text.primary : tokens.text.secondary} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "설정",
          tabBarIcon: ({ focused, size }) => (
            <Gear color={focused ? tokens.text.primary : tokens.text.secondary} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
