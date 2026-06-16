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
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Stack />
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
