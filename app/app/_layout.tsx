/**
 * 루트 레이아웃 — expo-router 진입(파일 기반 라우팅·딥링크). SafeAreaProvider + ThemeProvider 로 <Stack> 을 감싼다.
 * **네이티브 헤더는 끈다(headerShown:false)** — iOS 26 네이티브 헤더 버튼의 glass 배경 제거 + 화면별 커스텀 헤더 요구.
 * 뒤로가기·화면 제목/설명은 각 stack 화면이 공용 `ScreenHeader`(배경 없는 아이콘)로 직접 그린다.
 * (tabs) 는 자체 헤더(상단 ＋·탭바)를 쓴다. 색은 토큰만. 딥링크 경로 `/`·`/shipment/[id]` 유지.
 */
import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import { usePushNotifications } from "../src/lib/usePushNotifications";
import { infoStore, migrateMemosToInfo } from "../src/lib/info";
import { loadHomePref, prefsStore } from "../src/lib/prefs";
import { getLastNotificationData } from "../src/lib/push";
import { resolveInitialRoute } from "../src/lib/route";

/**
 * 콜드스타트 부트스트랩 — 부팅 1회: ① 메모→택배 정보 마이그레이션(멱등·목록/info 첫 읽기 전, 보강⑦)
 * → ② 초기 라우팅(딥링크 > 시작화면 > 택배함, 보강③·resolveInitialRoute).
 * 라우팅은 await 들 뒤에 일어나 네비게이션 트리가 마운트된 후 실행된다(replace-before-mount 회피).
 */
function useColdStartBootstrap(): void {
  useEffect(() => {
    void (async () => {
      try {
        await migrateMemosToInfo({ store: infoStore });
        const [data, homePref] = await Promise.all([
          getLastNotificationData(),
          loadHomePref({ store: prefsStore }),
        ]);
        const route = resolveInitialRoute({ lastNotificationResponse: data, homePref });
        if (route.kind === "deepLink") {
          // 알림 콜드스타트 → 상세(최우선). 기본 탭(index) 위로 push 해 뒤로가기는 택배함으로.
          router.push(route.path);
        } else if (route.home === "dashboard") {
          // 시작화면=대시보드면 탭 전환(딥링크가 없을 때만). list 는 기본 탭이라 전환 불필요.
          router.navigate("/dashboard");
        }
      } catch {
        // 부트스트랩 실패는 조용히 — 기본 택배함으로 폴백(앱은 계속 동작).
      }
    })();
  }, []);
}

export default function RootLayout() {
  usePushNotifications();
  useColdStartBootstrap();
  // device 서버 등록은 첫 운송장 등록 직전 ensureDeviceRegistered 가 보장한다(register.tsx).
  return (
    // gesture-handler: 카드 스와이프(Swipeable) 제스처를 위해 최상위를 RootView 로 감싼다(v56 요구).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="shipment/[id]" />
            <Stack.Screen name="register" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="privacy" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="trash" />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
