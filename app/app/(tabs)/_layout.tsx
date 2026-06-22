/**
 * 하단 탭 네비게이션 — 대시보드(좌) · 택배함(목록) · 설정. v1.1에서 대시보드 추가(2탭→3탭, ADR-025).
 * register/shipment/onboarding/notifications/trash 는 탭이 아니라 루트 Stack 위에 push 되는 화면(app/_layout.tsx).
 * 탭은 헤더를 쓰지 않고(headerShown:false) 각 화면이 자체 헤더/세이프에어리어를 그린다.
 * 색은 토큰만(하드코딩 금지) — 활성=accent(대표 컬러)·비활성=text.secondary, 탭바 배경=bg.surface·구분선=border.
 * 라벨+아이콘을 함께 둔다(색 단독 의존 금지 — UI_GUIDE 접근성).
 * 콜드스타트 초기 탭(시작 화면 preference)은 step5 라우팅이 처리 — 여기선 탭 구성·순서만 둔다.
 */
import { Tabs } from "expo-router";
import { Gear, Grid, Package } from "../../src/components/icons";
import { useTheme } from "../../src/theme/ThemeProvider";

// 기본 탭 = 택배함(index) — 대시보드가 좌측(선언 첫째)이라도 콜드스타트 기본 landing 은 택배함(ADR-025 기본값).
// 시작 화면 preference=대시보드면 RootLayout 부트스트랩이 /dashboard 로 전환(보강③).
export const unstable_settings = { initialRouteName: "index" };

export default function TabsLayout() {
  const { tokens } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.accent,
        tabBarInactiveTintColor: tokens.text.secondary,
        tabBarStyle: {
          backgroundColor: tokens.bg.surface,
          borderTopColor: tokens.border,
        },
      }}
    >
      {/* 좌측 = 대시보드(신규). 선언 순서가 탭 순서 — 대시보드·택배함·설정. */}
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "대시보드",
          tabBarIcon: ({ focused, size }) => (
            <Grid color={focused ? tokens.accent : tokens.text.secondary} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "택배함",
          // 닫힌 상자로 통일 — 활성/비활성 동일 글리프, 색만 토큰으로 구분(사용자 요구). 열린 상자 금지.
          tabBarIcon: ({ focused, size }) => (
            <Package color={focused ? tokens.accent : tokens.text.secondary} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "설정",
          tabBarIcon: ({ focused, size }) => (
            <Gear color={focused ? tokens.accent : tokens.text.secondary} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
