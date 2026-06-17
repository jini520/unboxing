/**
 * 루트 레이아웃 — expo-router 진입(파일 기반 라우팅·딥링크). SafeAreaProvider + ThemeProvider 로
 * <Stack> 을 감싼다.
 * - (tabs): 하단 탭(택배함·설정) — 자체 헤더를 쓰므로 루트 Stack 헤더는 숨김.
 * - 그 외(shipment/[id]·register·onboarding): Stack 화면. 헤더는 **title 없음 + 아이콘만 뒤로가기**.
 *   (헤더 텍스트/기타 스타일 금지 — 요구사항. headerTitle:()=>null·headerBackVisible:false·headerLeft=ChevronLeft.)
 * 색은 토큰만(하드코딩 금지). 딥링크 경로 `/`·`/shipment/[id]` 는 그룹과 무관하게 유지된다.
 */
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ChevronLeft } from "../src/components/icons";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { usePushNotifications } from "../src/lib/usePushNotifications";

export default function RootLayout() {
  usePushNotifications();
  // device 서버 등록은 첫 운송장 등록 직전 ensureDeviceRegistered 가 보장한다(register.tsx).
  // 시작 시 무조건 호출은 등록 안 하는 사용자에게도 /devices·IP rate-limit 를 소모하므로 제거(CL5).
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootStack />
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** 뒤로가기 — 아이콘만(텍스트·배경 없음). 부모 Pressable 이 a11y 라벨 제공. */
function HeaderBack() {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="뒤로"
    >
      <ChevronLeft size={24} color={tokens.text.primary} />
    </Pressable>
  );
}

function RootStack() {
  const { tokens } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: tokens.bg.page },
        headerTintColor: tokens.text.primary,
        // 헤더 title 전체 삭제 + 기본 chevron/텍스트 숨김 → 아이콘만 뒤로가기.
        headerTitle: () => null,
        headerBackVisible: false,
        headerLeft: () => <HeaderBack />,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="shipment/[id]" />
      <Stack.Screen name="register" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}
