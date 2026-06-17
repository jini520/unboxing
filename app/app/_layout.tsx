/**
 * 루트 레이아웃 — expo-router 진입(파일 기반 라우팅·딥링크). SafeAreaProvider + ThemeProvider 로
 * <Stack> 을 감싼다. 개별 화면 옵션/스크린은 각 화면 step에서 추가.
 */
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import { usePushNotifications } from "../src/lib/usePushNotifications";

export default function RootLayout() {
  usePushNotifications();
  // device 서버 등록은 첫 운송장 등록 직전 ensureDeviceRegistered 가 보장한다(register.tsx).
  // 시작 시 무조건 호출은 등록 안 하는 사용자에게도 /devices·IP rate-limit 를 소모하므로 제거(CL5).
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Stack />
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
